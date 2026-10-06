# Testing

Run requests through the full lifecycle without a server, test permission matrices, inspect routes and check required policies in CI.

`testRequest` runs the full execution cycle — policies, pipeline, middleware, handler — against an `Orvaxis` instance, with no HTTP server required.

```ts
import { Orvaxis } from "orvaxis"
import { testRequest } from "orvaxis/testing"

const app = new Orvaxis()

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/users/:id",
      handler: async (ctx) => {
        ctx.res.json({ id: ctx.meta.route?.params.id })
      },
    },
  ],
})

// successful request
const res = await testRequest(app, { path: "/api/users/42" })
// res.status  → 200
// res.body    → { id: "42" }
// res.ctx     → full OrvaxisContext
// res.error   → undefined

// with query params
const search = await testRequest(app, { path: "/api/users/42", query: { expand: "profile" } })
// search.ctx.req.query → { expand: "profile" }

// route not found
const notFound = await testRequest(app, { path: "/api/missing" })
// notFound.status  → 404
// notFound.error   → Error("Not Found: /api/missing")  (path included outside production)

// streaming handler
const streamed = await testRequest(app, { path: "/api/stream" })
// streamed.chunks  → ["chunk1", "chunk2"]   (written via ctx.res.write)
// streamed.ended   → true                   (ctx.res.end was called)
```

`TestRequestInit` accepts `path`, `method` (defaults to `"GET"`), `headers`, `query`, `id`, and any additional field (e.g. `body`) which is forwarded directly onto `req`. `query` is typed as `Record<string, string | string[]>` and maps directly to `ctx.req.query` inside the handler: `testRequest` never throws — errors thrown during execution are captured in `result.error`, the request context remains available in `result.ctx`, and the error's `.status` property (if present) is reflected in `result.status`. Failed traces are finalized before `onError`, and `trace.events` contains bounded policy decisions according to the configured `policyTrace` mode. The error remains the original thrown error; `testRequest` does not build the HTTP `ErrorResponse` envelope produced by adapters. For streaming handlers, `result.chunks` holds all values passed to `ctx.res.write` and `ctx.res.end`, and `result.ended` is `true` when `ctx.res.end` was called.

All testing utilities are available from the `orvaxis/testing` sub-path and are excluded from the production bundle:

```ts
import { testRequest, createMockResponse, type TestRequestInit, type TestResponse, type MockResponse } from "orvaxis/testing"
```

## Permission matrices

Use `testPolicyMatrix` to run role, identity, tenant, and ownership cases against real policy execution. Each scenario executes once through `testRequest`; the helper compares the HTTP status, terminal policy name, and whether the handler ran using the finalized request trace. It returns mismatches instead of throwing, so the complete report remains available on failure:

```ts
import { expect, it } from "vitest"
import { formatPolicyMatrixReport, testPolicyMatrix } from "orvaxis/testing"

it("enforces document permissions", async () => {
  const report = await testPolicyMatrix(app, [
    {
      name: "anonymous request",
      request: { path: "/api/documents/42" },
      expected: { status: 401, policy: "authenticate", handlerExecuted: false },
    },
    {
      name: "document owner",
      request: { path: "/api/documents/42", headers: { "x-user": "alice" } },
      expected: { status: 200, policy: null, handlerExecuted: true },
    },
  ])

  expect(report.passed, formatPolicyMatrixReport(report)).toBe(true)
})
```

For a complete anonymous/owner/other-user/other-tenant/admin example, run `pnpm exec tsx examples/policy-matrix.ts`. The report contains scenario names, status, policy, and handler reachability; it omits request headers and values. `ctx.meta.trace.handlerExecuted` records whether the runtime invoked the route handler, including when that handler throws.

## Static policy requirements for CI

`checkPolicyRequirements` checks an inspected route inventory without executing policy predicates, evaluators, or handlers. Selectors use exact route templates or path globs: `*` matches one segment, and `**` matches zero or more trailing segments. Method filters and exceptions keep public endpoints explicit; every exception requires a reason. A selector matching no routes fails so a typo cannot pass vacuously.

```ts
import { expect, it } from "vitest"
import { checkPolicyRequirements, formatPolicyRequirementReport } from "orvaxis/testing"

it("keeps authentication on private endpoints", () => {
  const report = checkPolicyRequirements(app.inspectRoutes(), [
    {
      name: "private API authentication",
      paths: ["/api/private/**"],
      methods: ["GET", "POST"],
      requirePolicies: ["authenticate"],
      exceptions: [
        { path: "/api/private/health", methods: ["GET"], reason: "Public health probe" },
      ],
    },
  ])

  expect(report.passed, formatPolicyRequirementReport(report)).toBe(true)
})
```

Each selected route is reported as `PASS`, `FAIL`, `UNVERIFIABLE`, or `EXCLUDED`. A required policy whose scope is conditional—such as a regex or predicate—is `UNVERIFIABLE` by default and does not fail the report; pass `{ failOnUnverifiable: true }` to make that strict in CI. Missing policies and selectors that match no routes always fail. The static check only verifies declared policy configuration; it cannot prove what an arbitrary `evaluate()` function does. Keep runtime permission cases in a separate `testPolicyMatrix` assertion. Run `pnpm exec tsx examples/policy-ci-check.ts` for both checks together.

## Route introspection

`app.routes()` returns the flat list of all registered routes as `RouteInfo[]`, useful for OpenAPI generation and admin tooling:

```ts
import { Orvaxis } from "orvaxis"
import type { RouteInfo } from "orvaxis"

const app = new Orvaxis()

app.group({
  prefix: "/api",
  routes: [
    { method: "GET",  path: "/users",     handler: async () => {} },
    { method: "POST", path: "/users",     handler: async () => {} },
    { method: "GET",  path: "/users/:id", handler: async () => {} },
  ],
})

const routes: RouteInfo[] = app.routes()
// [
//   { method: "GET",  path: "/api/users",     prefix: "/api" },
//   { method: "POST", path: "/api/users",     prefix: "/api" },
//   { method: "GET",  path: "/api/users/:id", prefix: "/api" },
// ]
```

For policy configuration, `app.inspectRoutes()` returns one static description per route with its inherited global, group, and route policies:

```ts
const inspected = app.inspectRoutes()
const users = inspected.find((route) => route.path === "/api/users/:id")

users?.policies.map(({ id, name, layer, phase, priority, order, applicability }) => ({
  id,
  name,
  layer,
  phase,
  priority,
  order,
  applicability,
}))
```

Policies are listed in runtime order: pre-validation global → group → route, then post-validation global → group → route. `id` distinguishes declarations even when names repeat; `nameAmbiguous` flags duplicate names across the endpoint's effective policy set. `applicability.status` is `always`, `never`, or `conditional`: string scopes are compared conservatively with the route template and method, while regexes, predicates, paths crossing route parameters or wildcards, and implicit GET-to-HEAD fallback stay conditional. The inspector never calls policy evaluators, handlers, or scope predicates. This is configuration metadata, not a prediction of the policy result or a security guarantee based on policy names. The existing `app.routes()` API and its `RouteInfo[]` result are unchanged.

---
