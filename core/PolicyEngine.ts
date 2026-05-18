import type { OrvaxisContext, Policy, PolicyResult, PolicyScope } from "../types"
import { HttpError } from "./HttpError"
import { mergeSafe } from "./utils"

export class PolicyEngine {
  private policies: Policy[] = []

  register(policy: Policy) {
    this.policies.push(policy)
  }

  async evaluate(ctx: OrvaxisContext) {
    const sorted = [...this.policies].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    for (const policy of sorted) {
      if (!this.matchesScope(policy.scope, ctx)) continue

      const result: PolicyResult = await policy.evaluate(ctx)

      if (!result.allow) {
        throw new HttpError(result.status ?? 403, result.reason ?? `Blocked by ${policy.name}`)
      }

      if (result.modify) {
        mergeSafe(ctx.meta, result.modify)
      }
    }
  }

  private matchesScope(scope: PolicyScope | undefined, ctx: OrvaxisContext): boolean {
    if (!scope) return true

    if (scope.method && ctx.req.method.toUpperCase() !== scope.method) {
      return false
    }

    if (scope.path) {
      const p = scope.path
      if (typeof p === "function") return p(ctx.req.path)
      if (p instanceof RegExp) return p.test(ctx.req.path)
      // string: prefix match — "/api" matches "/api" and "/api/v1/users" but not "/apiv2"
      const prefix = p.endsWith("/") ? p : `${p}/`
      return ctx.req.path === p || ctx.req.path.startsWith(prefix)
    }

    return true
  }
}
