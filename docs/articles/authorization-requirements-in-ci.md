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

> **Unreleased.** `buildProtectionReport` and `diffProtectionReports` are on `main` only and are not in the published 0.4.0 package. `checkPolicyRequirements` below is available in 0.4.0.

## Review protection changes against a baseline

Requirements fail on what you declared as mandatory. A protection report adds a different signal for reviewers: what changed. `buildProtectionReport(app.inspectRoutes())` returns deterministic JSON (method, full route template, and for each policy its name, layer, phase, scope and whether it `always`, `conditional`ly or `never` applies). It runs no handler, evaluator or scope predicate, and it omits declaration order, priority and indexes, so reordering policies does not change it. Regular expressions, predicates and path-dependent scopes appear as `conditional`; a listed policy is a declaration, not proof of correct authorization.

```ts
import { buildProtectionReport, diffProtectionReports, formatProtectionDiffMarkdown } from "orvaxis/testing"

const current = buildProtectionReport(app.inspectRoutes())
const diff = diffProtectionReports(baseline, current, { failOn: ["policy-removed"] })
console.log(formatProtectionDiffMarkdown(diff))
if (!diff.passed) process.exitCode = 1
```

The diff lists added and removed routes and policies, and policies whose phase, scope or applicability changed. Additions and strengthened protections are never violations. By default nothing fails; only the kinds named in `failOn` become violations: `policy-removed` (a policy that applied is gone) and `policy-weakened` (it now applies less often, for example `always` → `conditional`). Commit the baseline JSON next to the code and update it deliberately when a protection change is intended; a baseline with another `schemaVersion` is rejected.

`examples/protection-report.ts` wires this for the tenant demo: `pnpm check:protection` compares against `examples/fixtures/tenant-tasks-protection.json`, writes `protection-report/` (report and diff, JSON and Markdown), and `pnpm update:protection-baseline` refreshes the baseline. In GitHub Actions, upload that directory as an artifact so reviewers can read it:

```yaml
- name: Compare route protections with the committed baseline
  run: pnpm check:protection
- name: Upload route protection report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: route-protection-report
    path: protection-report/
```

## Keep behavior tests alongside the static check

Run `pnpm check:tenant-demo` for the executable [multi-tenant task example](../guide/multi-tenant-demo.md). It checks the static requirements, then runs a permission matrix for anonymous, owner, same-tenant non-owner, cross-tenant member, and admin cases. Each dynamic case asserts status, terminal policy, and handler reachability.

The repository CI runs this command on every pull request. Add a static requirement when adding a protected route, and add matrix cases when its behavior changes. The two checks catch different regressions: a missing policy declaration and an incorrect decision by a policy that is present.
