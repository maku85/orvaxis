<p align="center">
  <img src="https://raw.githubusercontent.com/maku85/orvaxis/main/assets/orvaxis-banner.webp" width="800" alt="Orvaxis structures Node.js API execution with routing, policies, middleware, hooks, typed contracts, tracing, and testing"/>
</p>

<h1 align="center">Orvaxis</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/orvaxis"><img src="https://img.shields.io/npm/v/orvaxis" alt="npm version"/></a>
  <a href="https://github.com/maku85/orvaxis/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/maku85/orvaxis/ci.yml?label=CI" alt="CI"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/orvaxis" alt="license"/></a>
  <a href="https://www.npmjs.com/package/orvaxis"><img src="https://img.shields.io/node/v/orvaxis" alt="node version"/></a>
</p>

<p align="center">
  Structured, observable, and testable execution for Node.js APIs.
</p>

<p align="center"><a href="https://maku85.github.io/orvaxis/">Read the documentation →</a></p>

---

Orvaxis makes the authorization of a Node.js API something you can **see, test and diff**. Declare policies per route, and Orvaxis tells you which routes each policy protects, which policy stopped a request and which stages never ran, and whether a pull request weakened a protection, all without starting a server.

## What you get

| Question | How Orvaxis answers it |
|---|---|
| **Which routes are protected, and by what?** | `app.inspectRoutes()` lists every route with its policies, layer, phase and whether each always, sometimes or never applies. `checkPolicyRequirements()` fails CI when a route lacks a required policy. |
| **Did a change weaken a protection?** | `buildProtectionReport()` produces deterministic JSON; `diffProtectionReports()` compares it with a committed baseline and can fail on `policy-removed` or `policy-weakened`. |
| **Why was this request denied?** | Every request carries a trace. `formatExecutionSummary(ctx)` names the terminal policy and the stages that never ran; `buildRequestReport(ctx)` gives the same as JSON that excludes request values. |
| **Does it behave as intended?** | `testRequest()` runs the full lifecycle without a server, and `testPolicyMatrix()` checks identities against routes. |

Two ways to adopt it:

- **Guard an existing Express route.** Keep your handlers in Express and add `createExpressPolicyGuard()` in front of the ones you want protected. It evaluates pre-validation policies only; see below.
- **Run the full runtime.** Declare routes and handlers in Orvaxis, with middleware, typed input validation, response contracts, OpenAPI export, OpenTelemetry and streaming, served through Express or Fastify.

## Quickstart

Start with a small full-runtime API: declare a route and its policies, then serve it through Express. This example demonstrates an allowed request and a denied request whose handler never runs. Validation, plugins and streaming can be added as needed. It needs Node.js 22.13 or later.

Create a project and install Orvaxis, Express (the HTTP transport; Fastify works too) and a TypeScript runner and the type declarations Express does not bundle:

```bash
mkdir orvaxis-quickstart && cd orvaxis-quickstart
npm init -y
npm install orvaxis express
npm install -D tsx typescript @types/node @types/express
```

Save this as `server.ts`. Authentication is registered globally, ownership on the route that needs it:

<!-- snippet: examples/quickstart.ts#imports,app,serve -->
```ts
import { createExpressServer } from "orvaxis/express"
import { Orvaxis, type Policy } from "orvaxis"

const authenticate: Policy = {
  name: "authenticate-user",
  evaluate(ctx) {
    const userId = ctx.req.headers["x-user-id"]
    return typeof userId === "string"
      ? { allow: true, modify: { userId } }
      : { allow: false, status: 401, reason: "X-User-ID header required" }
  },
}

const ownerOnly: Policy = {
  name: "report-owner",
  evaluate(ctx) {
    return ctx.meta.userId === ctx.params.ownerId
      ? { allow: true }
      : { allow: false, status: 403, reason: "Only the report owner can view it" }
  },
}

const app = new Orvaxis()
app.policy(authenticate)
app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/reports/:ownerId",
      policies: [ownerOnly],
      handler: (ctx) => ctx.res.json({ ownerId: ctx.params.ownerId, report: "quarterly" }),
    },
  ],
})

createExpressServer(app).listen(3000)
```

Start it with `npx tsx server.ts`, then try the allowed and denied requests:

```bash
curl -i -H 'x-user-id: bob' http://localhost:3000/api/reports/alice  # 403: policy denied
curl -i -H 'x-user-id: alice' http://localhost:3000/api/reports/alice # 200: handler ran
curl -i http://localhost:3000/api/reports/alice                      # 401: no identity
```

The same code is the [working example](examples/quickstart.ts) in the repository (`pnpm exec tsx examples/quickstart.ts` from a checkout); a script runs this exact snippet in a clean project against the packed package, so the commands above stay accurate.

The `x-user-id` header is a demo identity input, not authentication. In an application, use the identity established by trusted authentication middleware or token verification.

Express supplies HTTP transport in this example; Orvaxis matches the declared routes and executes their lifecycle. Install only the adapter peer dependency you use; Express and Fastify are optional. The package ships CommonJS and ESM builds.

---

## Guard an existing Express route

Mirror the protected method and path in an `Orvaxis` instance and leave the handler in Express. The guard runs the matching policies and calls `next()` only when they all allow the request:

<!-- snippet: examples/express-existing-route.ts#imports,guard -->
```ts
import express, { type Application } from "express"
import { createExpressPolicyGuard } from "orvaxis/express"
import { formatExecutionSummary, Orvaxis, type Policy } from "orvaxis"
import { testRequest } from "orvaxis/testing"

const documentOwner: Policy = {
  name: "document-owner",
  evaluate(ctx) {
    return ctx.req.headers["x-user-id"] === ctx.params.id
      ? { allow: true, modify: { authorizedUserId: ctx.params.id } }
      : { allow: false, reason: "You cannot access this document", status: 403 }
  },
}

// Mirror the protected method and path here; the real handler stays in Express.
export const security = new Orvaxis()
security.group({
  prefix: "/api",
  routes: [{ method: "GET", path: "/documents/:id", policies: [documentOwner], handler: () => {} }],
})

export function createExistingRouteDemo(): Application {
  const server = express()
  server.get("/api/documents/:id", createExpressPolicyGuard(security), (req, res) =>
    res.json({ documentId: req.params.id })
  )
  return server
}
```

The guard does not run middleware, validation or handlers, and it supports pre-validation policies only. The [integration guide](docs/guide/integrate-existing-route.md) ends with the denial explained from its trace.

## Check protections in CI

Authorization tests cover the requests someone remembered to write. A static check adds a different guardrail: it fails when a route that must be protected is declared without the policy that protects it. It reads route declarations; no policy or handler is executed:

```ts
import { checkPolicyRequirements } from "orvaxis/testing"

const report = checkPolicyRequirements(app.inspectRoutes(), [
  {
    name: "task access requires authentication, tenant and ownership checks",
    paths: ["/api/tenants/:tenantId/tasks/:taskId"],
    requirePolicies: ["authenticate", "tenant-access", "task-owner-or-admin"],
  },
])

if (!report.passed) process.exitCode = 1
```

Declared configuration does not prove the policy decides correctly, so keep a permission matrix next to it. [Authorization requirements in CI](docs/articles/authorization-requirements-in-ci.md) combines the two, and `examples/protection-report.ts` shows the baseline workflow with `diffProtectionReports()`.

## Testing without a server

`testRequest` runs the full lifecycle (policies, middleware, validation, handler) against an `Orvaxis` instance, so tests exercise the runtime the adapters use:

```ts
import { testRequest } from "orvaxis/testing"

const result = await testRequest(app, { path: "/api/reports/alice", headers: { "x-user-id": "bob" } })
// result.status === 403; result.ctx holds the trace for diagnostics
```

The [testing guide](docs/guide/testing.md) covers permission matrices (`testPolicyMatrix`), static policy requirements and route introspection.

---

## The full runtime

For a matched request the stages run in this order:

```text
onRequest → route match → authenticate → pre-validation policies
          → beforePipeline → global/group/route middleware
          → input validation → post-validation policies
          → beforeHandler → handler → afterHandler
          → trace finalization → afterPipeline
```

Denials, errors and short-circuits stop later stages. The [lifecycle reference](docs/reference/lifecycle.md) documents the complete order and hook contracts.

| Capability | Where to read |
|---|---|
| Routing, groups, wildcards, middleware and lifecycle hooks | [How a request runs](docs/guide/execution-model.md), [routing](docs/guide/routing-and-groups.md), [middleware and hooks](docs/guide/middleware-and-hooks.md) |
| Identity with `app.authenticate()` and `ctx.identity`; policies by scope and priority, before or after validation | [Core concepts](docs/reference/core-concepts.md#policies), [cookbook](docs/cookbook.md) |
| Typed, validated input with `defineRoute()`; response contracts; OpenAPI 3.1 export | [Typed validation](docs/guide/typed-validation.md), [response contracts](docs/guide/response-contracts.md), [OpenAPI](docs/guide/openapi.md) |
| Traces, debug timelines, structured logging, OpenTelemetry spans | [Observability](docs/guide/observability.md), [OpenTelemetry](docs/guide/opentelemetry.md) |
| SSE and file streaming, request IDs, cancellation, timeouts, graceful shutdown | [Adapters](docs/guide/http-adapters.md), [streaming](docs/guide/streaming.md), [shutdown](docs/guide/timeouts-and-shutdown.md) |
| Plugins (hooks, policies, middleware, `around`, `onClose`), CORS, request context | [Plugins](docs/guide/plugins.md), [request context](docs/guide/request-context.md) |

### HTTP adapters

Adapters are thin wrappers that normalize the request and delegate to the runtime.

| Adapter | Import | Peer dependency |
|---|---|---|
| Express | `createExpressServer` from `orvaxis/express` | `express ^4.20 \|\| ^5` (types: `@types/express`) |
| Fastify | `createFastifyServer` from `orvaxis/fastify` | `fastify ^5` |

Both peers are optional and each adapter has its own subpath, so `orvaxis`, `orvaxis/testing` and `orvaxis/openapi` never need either. The core has no runtime dependencies. Details: [HTTP adapters](docs/guide/http-adapters.md).

```ts
import { Orvaxis } from "orvaxis"
import { createFastifyServer } from "orvaxis/fastify"

const app = new Orvaxis()
app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/users/:id",
      handler: async (ctx) => {
        ctx.res.send({ id: ctx.params.id })
      },
    },
  ],
})

createFastifyServer(app).listen(3000)
```

---

## Documentation

Browse the [documentation site](https://maku85.github.io/orvaxis/) or the Markdown sources in `docs/`. Good places to start:

- [Get started](docs/guide/getting-started.md) and [Add Orvaxis to an existing Express route](docs/guide/integrate-existing-route.md)
- [Diagnose a 403](docs/guide/diagnose-403.md) and the [recorded policy traces](docs/demo/policy-traces.md)
- [Multi-tenant task demo](docs/guide/multi-tenant-demo.md): tenant, ownership and roles, with permission matrix and CI check
- [Why Orvaxis](docs/why-orvaxis.md), [cookbook](docs/cookbook.md) and [benchmarks](docs/benchmarks.md)
- [Changelog](CHANGELOG.md) and the migration guides: [0.4.0 → 0.5.0](docs/migration/0.4.0-to-0.5.0.md), [0.3.1 → 0.4.0](docs/migration/0.3.1-to-0.4.0.md)

Every example, with its command, port and expected output, is in the [examples catalog](docs/examples/index.md).

---

## Status

Orvaxis is **pre-1.0**: minor versions may contain breaking changes, which the [changelog](CHANGELOG.md) lists. The runtime, adapters, public types and examples are covered by automated tests, and CI runs them on Node.js 22.13 and 24 against Express 4, Express 5 and Fastify 5. Read the changelog before upgrading, and test your own policies with `testRequest` and a permission matrix before relying on them in production.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code conventions, and the PR process. To report a bug or propose a feature, use the [GitHub issue templates](https://github.com/maku85/orvaxis/issues/new/choose).

---

## License

MIT
