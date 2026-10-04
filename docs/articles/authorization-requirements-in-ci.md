# Check route authorization requirements in CI

Authorization tests often cover requests that developers remember to write. A static route inventory can add a different guardrail: fail when a protected route is declared without the required policy. Keep both checks, because declared configuration does not prove the evaluator makes the right decision.

## Check the route inventory

`checkPolicyRequirements()` inspects `app.inspectRoutes()` without executing policy predicates or handlers:

```ts
import { Orvaxis } from "orvaxis"
import { checkPolicyRequirements } from "orvaxis/testing"

const app = new Orvaxis()
// Register route groups and policies here.

const report = checkPolicyRequirements(app.inspectRoutes(), [
  {
    name: "tenant task access requires authentication, tenant, and ownership checks",
    paths: ["/api/tenants/:tenantId/tasks/:taskId"],
    requirePolicies: ["authenticate", "tenant-access", "task-owner-or-admin"],
  },
])

if (!report.passed) process.exitCode = 1
```

Exact route templates and path globs select routes. A selector matching no routes fails, so a renamed route cannot silently escape the check. Every declared exception needs a reason. Conditional scopes are reported as unverifiable because static inspection does not call regular expressions or predicates; opt into `failOnUnverifiable` when those need to block CI.

## Keep behavior tests alongside the static check

Run `pnpm check:tenant-demo` for the executable [multi-tenant task example](../guide/multi-tenant-demo.md). It checks the static requirements, then runs a permission matrix for anonymous, owner, same-tenant non-owner, cross-tenant member, and admin cases. Each dynamic case asserts status, terminal policy, and handler reachability.

The repository CI runs this command on every pull request. Add a static requirement when adding a protected route, and add matrix cases when its behavior changes. The two checks catch different regressions: a missing policy declaration and an incorrect decision by a policy that is present.
