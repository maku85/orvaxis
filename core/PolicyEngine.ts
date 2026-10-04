import type { OrvaxisContext, Policy, PolicyPhase, PolicyResult, PolicyScope } from "../types"
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

export class PolicyEngine {
  private policies: Policy[] = []

  register(policy: Policy) {
    this.policies.push(policy)
  }

  async evaluate(
    ctx: OrvaxisContext,
    phase: PolicyPhase = "preValidation",
    beforeEvaluate?: (policy: Policy) => void
  ) {
    const sorted = sortPolicies(this.policies)

    for (const policy of sorted) {
      if ((policy.phase ?? "preValidation") !== phase) continue
      if (!matchesPolicyScope(policy.scope, ctx)) continue
      beforeEvaluate?.(policy)

      const result: PolicyResult = await policy.evaluate(ctx)

      if (!result.allow) {
        throw new HttpError(result.status ?? 403, result.reason ?? `Blocked by ${policy.name}`)
      }

      if (result.modify) {
        mergeSafe(ctx.meta, result.modify)
      }
    }
  }
}
