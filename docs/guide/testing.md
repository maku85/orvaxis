# Testing

Orvaxis tests run the real runtime without a server. This page covers the tools and, as importantly, which question each one answers: running requests, checking permissions case by case, checking that required policies are attached, and inspecting what is declared.

| Tool | Question it answers | Executes policies and handlers? |
|---|---|---|
| `testRequest` | What does the whole lifecycle do for this request? | yes |
| `testPolicyMatrix` | Does each identity get the status, terminal policy and handler reachability I expect? | yes |
| `checkPolicyRequirements` | Is every route I care about declared with the policies it must have? | **no** |
| `app.inspectRoutes()` | What is declared on each route? | **no** |
| `buildProtectionReport` / `diffProtectionReports` | What did this change add to or remove from the declarations? | **no** (main only; see the [CI article](/articles/authorization-requirements-in-ci)) |

All of them come from `orvaxis/testing`, which is not part of what your server imports. The tests on this page are real: they live in [`examples/testing/`](https://github.com/maku85/orvaxis/tree/main/examples/testing), run with `pnpm exec vitest run examples/testing` (and with the repository's `pnpm test`), and are shown exactly as written.

## The application under test

[`examples/testing/app.ts`](https://github.com/maku85/orvaxis/blob/main/examples/testing/app.ts) is an ordinary app: a global `authenticate` policy, an `owner-or-admin` route policy, a body schema, a middleware that marks the request state, a handler that throws, and a handler that streams. The tests import it with `createApp()`:

<!-- snippet: examples/testing/app.test.ts#imports -->
```ts
import { describe, expect, it } from "vitest"
import {
  checkPolicyRequirements,
  formatPolicyMatrixReport,
  formatPolicyRequirementReport,
  testPolicyMatrix,
  testRequest,
} from "orvaxis/testing"
import { createApp } from "./app"
```

## `testRequest`: the full lifecycle, no server

`testRequest(app, init)` runs one request through policies, middleware, validation, the handler and the hooks, and returns what happened. `init` takes `path`, `method` (default `GET`), `headers`, `query`, `id`, and any other field (such as `body`), which is forwarded onto the request. It never throws: an error raised during execution is captured.

| Field | Contents |
|---|---|
| `status` | the status sent; for a failure with no response sent, the error's `status` if it has one, else `500` |
| `body`, `headers` | what the handler sent |
| `chunks`, `ended` | streamed chunks and whether `end` was called |
| `ctx` | the full request context, including `ctx.meta.trace`, `ctx.state` and `ctx.meta.route` |
| `error` | the original error, **not** an HTTP error envelope (that is built by the adapters) |

**A successful request**, including whether the handler really ran:

<!-- snippet: examples/testing/app.test.ts#success -->
```ts
it("answers a permitted request", async () => {
  const result = await testRequest(app, { path: "/api/users/alice", headers: alice })
  expect(result.status).toBe(200)
  expect(result.body).toEqual({ id: "alice" })
  expect(result.error).toBeUndefined()
  expect(result.ctx?.meta.trace?.handlerExecuted).toBe(true)
})
```

**Invalid input** stops before the handler. The error carries the validation message and the trace says the handler never ran:

<!-- snippet: examples/testing/app.test.ts#invalid-input -->
```ts
it("rejects invalid input before the handler", async () => {
  const result = await testRequest(app, {
    method: "POST",
    path: "/api/users",
    headers: alice,
    body: { name: "" },
  })
  expect(result.status).toBe(422)
  expect(result.error?.message).toBe("Validation failed: body")
  expect(result.ctx?.meta.trace?.handlerExecuted).toBe(false)
})
```

**Middleware** is visible through the context it leaves behind:

<!-- snippet: examples/testing/app.test.ts#middleware -->
```ts
it("shows what middleware did to the request", async () => {
  const result = await testRequest(app, { path: "/api/users/alice", headers: alice })
  expect(result.ctx?.state.audited).toBe(true)
})
```

**A handler error** is captured, with the original error and a trace finalized as `error`:

<!-- snippet: examples/testing/app.test.ts#handler-error -->
```ts
it("captures an error thrown by the handler instead of throwing", async () => {
  const result = await testRequest(app, { path: "/api/report", headers: alice })
  expect(result.status).toBe(500)
  expect(result.error?.message).toBe("report failed") // the original error, not an HTTP envelope
  expect(result.ctx?.meta.trace?.outcome).toBe("error")
})
```

**A streaming handler** shows its chunks without a socket. A handler that only pipes a stream does not end the response itself, so `ended` stays `false`:

<!-- snippet: examples/testing/app.test.ts#streaming -->
```ts
it("collects streamed chunks", async () => {
  const result = await testRequest(app, { path: "/api/stream", headers: alice })
  expect(result.chunks).toEqual(["chunk1", "chunk2"])
  expect(result.ended).toBe(true)
})
```

Failed traces are finalized before `onError`, and `trace.events` holds the bounded policy decisions according to the configured `policyTrace` mode. When a test fails, [`formatExecutionSummary(result.ctx)`](/guide/diagnose-403) says which policy decided. For what a test cannot see (socket behavior, timeouts, shutdown), see [HTTP adapters](/guide/http-adapters) and [Timeouts and graceful shutdown](/guide/timeouts-and-shutdown).

## Permission matrices: behavior, case by case

`testPolicyMatrix(app, scenarios)` runs each scenario once through `testRequest` and compares the status, the terminal policy's name and whether the handler ran, using the finalized trace. It returns mismatches instead of throwing, so the complete report is available when something fails; `formatPolicyMatrixReport` prints it without request headers or values.

<!-- snippet: examples/testing/app.test.ts#matrix -->
```ts
const scenarios = [
  {
    name: "anonymous request",
    request: { path: "/api/users/alice" },
    expected: { status: 401, policy: "authenticate", handlerExecuted: false },
  },
  {
    name: "the owner",
    request: { path: "/api/users/alice", headers: alice },
    expected: { status: 200, policy: null, handlerExecuted: true },
  },
  {
    name: "another user",
    request: { path: "/api/users/alice", headers: { "x-user": "bob" } },
    expected: { status: 403, policy: "owner-or-admin", handlerExecuted: false },
  },
]

it("enforces who may read a profile", async () => {
  const report = await testPolicyMatrix(app, scenarios)
  expect(report.passed, formatPolicyMatrixReport(report)).toBe(true)
})
```

The matrix executes real policy code, so it is the tool that proves what a policy does for a given identity. It only covers the cases you list. `pnpm exec tsx examples/policy-matrix.ts` runs a larger anonymous/owner/other-user/other-tenant/admin matrix.

## Static requirements: declarations, across all routes

`checkPolicyRequirements(app.inspectRoutes(), requirements)` checks that selected routes declare the policies they must, without executing anything. Selectors are exact route templates or globs (`*` is one segment, `**` zero or more trailing segments); `methods` narrows them; every exception needs a reason; a selector that matches no route fails, so a typo cannot pass vacuously.

<!-- snippet: examples/testing/app.test.ts#requirements -->
```ts
const requirements = [
  {
    name: "profiles require authentication and an ownership check",
    paths: ["/api/users/:id"],
    requirePolicies: ["authenticate", "owner-or-admin"],
  },
]

it("keeps the required policies attached", () => {
  const report = checkPolicyRequirements(app.inspectRoutes(), requirements)
  expect(report.passed, formatPolicyRequirementReport(report)).toBe(true)
})
```

Each selected route is reported as `PASS`, `FAIL`, `UNVERIFIABLE` or `EXCLUDED`. A required policy whose scope is conditional (a regular expression or a predicate) is `UNVERIFIABLE` and does not fail the report unless you pass `{ failOnUnverifiable: true }`; missing policies and selectors that match nothing always fail. `pnpm exec tsx examples/policy-ci-check.ts` runs both kinds of check together.

## Why you want both

The inspector reads **declarations**. It can tell that a policy named `authenticate` is attached to a route; it cannot tell what `authenticate`'s `evaluate` function does. A policy that is attached but wrong passes the static check and fails the matrix:

<!-- snippet: examples/testing/app.test.ts#broken -->
```ts
it("catches a policy that is attached but wrong, which the static check cannot", async () => {
  const broken = createApp({ brokenAuthentication: true })

  // The declarations are intact, so the static check still passes...
  expect(checkPolicyRequirements(broken.inspectRoutes(), requirements).passed).toBe(true)

  // ...but the permission test fails: anonymous requests are no longer stopped.
  const report = await testPolicyMatrix(broken, scenarios)
  expect(report.passed).toBe(false)
  expect(report.scenarios.find((s) => s.name === "anonymous request")?.mismatches).toEqual([
    "status expected 401, received 403",
    "policy expected authenticate, received owner-or-admin",
  ])
})
```

The matrix cannot notice a route that was added without any policy, because nobody wrote a scenario for it; the static check can. Use the static check for coverage of declarations (every private route is protected), the matrix for correctness of decisions (the protection does what it says), and run both in CI.

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
