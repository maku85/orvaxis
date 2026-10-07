import type {
  OrvaxisContext,
  Policy,
  PolicyPhase,
  PolicyResult,
  PolicyScope,
  PolicyTraceOptions,
} from "../types/index.js"
import { HttpError } from "./HttpError.js"
import { mergeSafe } from "./utils.js"

/**
 * Deterministic identity of a policy declaration: the layer plus its zero-based position in that
 * layer's declaration array, regardless of phase, priority or scope. The route inspector and the
 * runtime trace use the same value, so it is unique within one route's policy chain but not across
 * routes: `group:0` names different policies in different groups. A policy object reused in several
 * layers or groups has one ID per declaration, and a name never contributes to the ID.
 */
export function policyDeclarationId(layer: PolicyLayer, declarationIndex: number): string {
  return `${layer}:${declarationIndex}`
}

export function sortPolicies(policies: Policy[]): Policy[] {
  return sortPoliciesWithIndex(policies).map(({ policy }) => policy)
}

function sortPoliciesWithIndex(policies: Policy[]): { policy: Policy; index: number }[] {
  return policies
    .map((policy, index) => ({ policy, index }))
    .sort((a, b) => (b.policy.priority ?? 0) - (a.policy.priority ?? 0) || a.index - b.index)
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
  /** Declaration identity shared with the route inspector (`PolicyInspection.id`). */
  policyId: string
  /** Zero-based position in the layer's declaration array; `order` is the evaluation position. */
  declarationIndex: number
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

type TraceState = {
  count: number
  truncated: boolean
  dropped: number
  limit: number
  mode: PolicyTraceMode | undefined
}
type PolicyTraceMode = "summary" | "detailed" | "off"
const traceStates = new WeakMap<OrvaxisContext, TraceState>()

export type PolicyTraceInfo = {
  /** Collection mode for the request; `undefined` when the runtime did not announce it. */
  mode: PolicyTraceMode | undefined
  /** True when at least one non-terminal decision was not recorded because of `maxEvents`. */
  truncated: boolean
  /** Number of decisions not recorded. Skipped-by-scope policies that were recorded are not counted. */
  droppedDecisions: number
  /** Effective limit applied to non-terminal decisions, when collection was active. */
  maxEvents: number | undefined
}

/** Called by the runtime when a request starts so reports can tell "off" from "nothing happened". */
export function initPolicyTrace(ctx: OrvaxisContext, options: PolicyTraceOptions): void {
  traceStates.set(ctx, {
    count: 0,
    truncated: false,
    dropped: 0,
    limit: options.mode === "off" ? 0 : (options.maxEvents ?? 100),
    mode: options.mode ?? "summary",
  })
}

export function getPolicyTraceInfo(ctx: OrvaxisContext): PolicyTraceInfo {
  const state = traceStates.get(ctx)
  return {
    mode: state?.mode,
    truncated: state?.truncated ?? false,
    droppedDecisions: state?.dropped ?? 0,
    maxEvents: state?.mode === "off" ? undefined : state?.limit,
  }
}

export function recordPolicyDecision(
  ctx: OrvaxisContext,
  options: PolicyTraceOptions | undefined,
  decision: PolicyDecision
): void {
  if (!options || options.mode === "off") return
  const state = traceStates.get(ctx) ?? {
    count: 0,
    truncated: false,
    dropped: 0,
    limit: 0,
    mode: options.mode ?? "summary",
  }
  traceStates.set(ctx, state)
  const requestedLimit = options.maxEvents ?? 100
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(1000, Math.max(1, Math.floor(requestedLimit)))
    : 100
  state.limit = limit
  // The decision that stopped the request is always kept, even beyond the limit. A request
  // stops at its first terminal decision, so this adds at most one event.
  if (state.count >= limit && decision.terminal !== true) {
    state.dropped++
    if (!state.truncated) {
      state.truncated = true
      ctx.meta.tracer?.event("POLICY_TRACE_LIMIT", { maxEvents: limit })
    }
    return
  }
  state.count++

  const meta: Record<string, unknown> = { ...decision }
  delete meta.reason
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
  for (const { policy, index: declarationIndex } of sortPoliciesWithIndex(policies)) {
    if ((policy.phase ?? "preValidation") !== phase) continue
    const currentOrder = tracing ? ++order : 0
    const started = tracing ? performance.now() : 0
    const base = tracing
      ? {
          policy: policy.name,
          policyId: policyDeclarationId(options.layer, declarationIndex),
          declarationIndex,
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

  list(): readonly Policy[] {
    return [...this.policies]
  }

  async evaluate(
    ctx: OrvaxisContext,
    phase: PolicyPhase = "preValidation",
    options: PolicyEvaluationOptions = { layer: "global" }
  ) {
    await evaluatePolicies(this.policies, ctx, phase, options)
  }
}
