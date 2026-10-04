import type {
  OrvaxisContext,
  Policy,
  PolicyPhase,
  PolicyResult,
  PolicyScope,
  PolicyTraceOptions,
} from "../types"
import { HttpError } from "./HttpError"
import { mergeSafe } from "./utils"

export function sortPolicies(policies: Policy[]): Policy[] {
  return policies
    .map((policy, index) => ({ policy, index }))
    .sort((a, b) => (b.policy.priority ?? 0) - (a.policy.priority ?? 0) || a.index - b.index)
    .map(({ policy }) => policy)
}

export function matchesPolicyScope(scope: PolicyScope | undefined, ctx: OrvaxisContext): boolean {
  if (!scope) return true

  if (scope.method && ctx.req.method.toUpperCase() !== scope.method.toUpperCase()) {
    return false
  }

  if (scope.path) {
    const path = scope.path
    if (typeof path === "function") return path(ctx.req.path)
    if (path instanceof RegExp) {
      path.lastIndex = 0
      try {
        return path.test(ctx.req.path)
      } finally {
        path.lastIndex = 0
      }
    }
    // string: prefix match — "/api" matches "/api" and "/api/v1/users" but not "/apiv2"
    const prefix = path.endsWith("/") ? path : `${path}/`
    return ctx.req.path === path || ctx.req.path.startsWith(prefix)
  }

  return true
}

export type PolicyLayer = "global" | "group" | "route"
export type PolicyOutcome = "allow" | "deny" | "skipped" | "error"

export type PolicyDecision = {
  policy: string
  layer: PolicyLayer
  phase: PolicyPhase
  order: number
  priority: number
  durationMs: number
  outcome: PolicyOutcome
  allowed?: boolean
  terminal?: boolean
  status?: number
  reason?: string
  errorName?: string
  scope?: { path?: string; method?: string }
}

type TraceState = { count: number; truncated: boolean }
const traceStates = new WeakMap<OrvaxisContext, TraceState>()

export function recordPolicyDecision(
  ctx: OrvaxisContext,
  options: PolicyTraceOptions | undefined,
  decision: PolicyDecision
): void {
  if (!options || options.mode === "off") return
  const state = traceStates.get(ctx) ?? { count: 0, truncated: false }
  traceStates.set(ctx, state)
  const requestedLimit = options.maxEvents ?? 100
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(1000, Math.max(1, Math.floor(requestedLimit)))
    : 100
  if (state.count >= limit) {
    if (!state.truncated) {
      state.truncated = true
      ctx.meta.tracer?.event("POLICY_TRACE_LIMIT", { maxEvents: limit })
    }
    return
  }
  state.count++

  const meta: Record<string, unknown> = { ...decision }
  if (options.mode === "detailed") {
    if (decision.scope) meta.scope = decision.scope
    if (decision.reason !== undefined) {
      try {
        meta.reason = options.redact(decision.reason, decision.policy)
      } catch {
        // A diagnostic redactor must not alter request behavior; omit the reason on failure.
      }
    }
  } else {
    delete meta.scope
    delete meta.reason
  }
  ctx.meta.tracer?.event("POLICY_DECISION", meta)
}

function describeScope(scope: PolicyScope | undefined): PolicyDecision["scope"] {
  if (!scope) return undefined
  const path = scope.path
  return {
    ...(path !== undefined
      ? {
          path:
            typeof path === "function"
              ? "predicate"
              : path instanceof RegExp
                ? path.toString()
                : path,
        }
      : {}),
    ...(scope.method ? { method: scope.method } : {}),
  }
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "NonErrorThrown"
}

export type PolicyEvaluationOptions = {
  layer: PolicyLayer
  trace?: PolicyTraceOptions
  beforeEvaluate?: (policy: Policy) => void
}

export async function evaluatePolicies(
  policies: Policy[],
  ctx: OrvaxisContext,
  phase: PolicyPhase,
  options: PolicyEvaluationOptions
): Promise<void> {
  let order = 0
  const tracing = options.trace?.mode !== "off" && options.trace !== undefined
  for (const policy of sortPolicies(policies)) {
    if ((policy.phase ?? "preValidation") !== phase) continue
    const currentOrder = tracing ? ++order : 0
    const started = tracing ? performance.now() : 0
    const base = tracing
      ? {
          policy: policy.name,
          layer: options.layer,
          phase,
          order: currentOrder,
          priority: policy.priority ?? 0,
          ...(options.trace?.mode === "detailed" ? { scope: describeScope(policy.scope) } : {}),
        }
      : undefined

    let inScope: boolean
    try {
      inScope = matchesPolicyScope(policy.scope, ctx)
    } catch (err) {
      if (base) {
        recordPolicyDecision(ctx, options.trace, {
          ...base,
          durationMs: performance.now() - started,
          outcome: "error",
          terminal: true,
          errorName: errorName(err),
        })
      }
      throw err
    }
    if (!inScope) {
      if (base) {
        recordPolicyDecision(ctx, options.trace, {
          ...base,
          durationMs: performance.now() - started,
          outcome: "skipped",
        })
      }
      continue
    }

    let result: PolicyResult
    try {
      options.beforeEvaluate?.(policy)
      result = await policy.evaluate(ctx)
    } catch (err) {
      if (base) {
        recordPolicyDecision(ctx, options.trace, {
          ...base,
          durationMs: performance.now() - started,
          outcome: "error",
          terminal: true,
          errorName: errorName(err),
        })
      }
      throw err
    }

    const allowed = result.allow
    if (base) {
      recordPolicyDecision(ctx, options.trace, {
        ...base,
        durationMs: performance.now() - started,
        outcome: allowed ? "allow" : "deny",
        allowed,
        ...(!allowed
          ? { terminal: true, status: result.status ?? 403, reason: result.reason }
          : {}),
      })
    }
    if (!allowed) {
      throw new HttpError(result.status ?? 403, result.reason ?? `Blocked by ${policy.name}`, {
        policyName: policy.name,
      })
    }
    if (result.modify) mergeSafe(ctx.meta, result.modify)
  }
}

export class PolicyEngine {
  private policies: Policy[] = []

  register(policy: Policy) {
    this.policies.push(policy)
  }

  async evaluate(
    ctx: OrvaxisContext,
    phase: PolicyPhase = "preValidation",
    options: PolicyEvaluationOptions = { layer: "global" }
  ) {
    await evaluatePolicies(this.policies, ctx, phase, options)
  }
}
