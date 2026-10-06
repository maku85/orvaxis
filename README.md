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

## What Orvaxis does

Orvaxis is a framework-agnostic execution runtime for Node.js APIs. It coordinates routing, policies, middleware, validation, lifecycle hooks, and handlers in an explicit request flow. Express and Fastify adapters provide the HTTP transport; the core has no mandatory runtime dependencies.

Use it to organize how requests run, enforce input and response contracts, observe execution, and test behavior without starting an HTTP server. Named policy decisions also explain why a request was blocked and which stages were never reached.

| Capability | What you can do | Learn more |
|---|---|---|
| **Routing and lifecycle** | Declare route groups, parameters and wildcards; compose global, group and route middleware with lifecycle hooks | [Lifecycle](docs/reference/lifecycle.md), [router](docs/reference/core-concepts.md#router), [hooks and plugins example](examples/hooks-and-plugins.ts) |
| **Declarative policies** | Apply named rules by scope and priority, before or after input validation; implement permissions, feature gates or other request conditions | [Policies](docs/reference/core-concepts.md#policies), [cookbook](docs/cookbook.md), [403 diagnostics](docs/guide/diagnose-403.md) |
| **Validated, typed input** | Parse and transform body, params, query and headers; infer handler types from validator outputs with `defineRoute()` | [Typed schemas](docs/reference/core-concepts.md#typed-context), [working example](examples/typed-schema.ts) |
| **Response contracts and OpenAPI** | Validate declared responses by status in strict or warning mode; generate OpenAPI 3.1 using your schema converter | [Contracts and OpenAPI](docs/reference/core-concepts.md#response-contracts-and-openapi) |
| **Observability** | Inspect request traces and debug timelines, emit custom events, use structured logging and export spans through OpenTelemetry | [Tracing](docs/reference/core-concepts.md#tracing-system), [debugging](docs/reference/core-concepts.md#debug-layer), [OpenTelemetry example](examples/otel-plugin.ts) |
| **Testing and inspection** | Execute requests without a server, test permission matrices, inspect route declarations and check required policies in CI | [Testing](docs/guide/testing.md), [route inspection](docs/guide/testing.md#route-introspection) |
| **HTTP and streaming** | Use Express or Fastify transport, stream SSE/files, propagate request IDs and handle cancellation, timeouts and graceful shutdown | [Adapters](docs/guide/http-adapters.md), [streaming](docs/guide/streaming.md), [shutdown](docs/guide/timeouts-and-shutdown.md#graceful-shutdown) |
| **Extensibility and context** | Register opt-in plugins, use CORS and logging plugins, and access isolated request context across async calls | [Plugins](docs/reference/core-concepts.md#plugins), [async context](docs/reference/core-concepts.md#request-scoped-context) |

Choose the integration that fits your application:

- **Full runtime:** declare routes and handlers in Orvaxis and use an Express or Fastify adapter. Orvaxis owns routing and execution within the mounted API.
- **Incremental Express guard:** add pre-validation policies to selected existing Express routes while keeping their handlers in Express. This mode evaluates policies; it does not run the full middleware, validation and handler lifecycle. See the [integration guide](docs/guide/integrate-existing-route.md).

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

## Why Orvaxis

Orvaxis gives requests a shared execution model: explicit policy phases, composable middleware, validation boundaries, lifecycle hooks, and a trace of what ran. This structure supports reusable rules and plugins, consistent diagnostics, and tests against the same runtime used by the HTTP adapters.

Authorization is one practical use case. Other uses include feature gates, validated request transformations, response contract checks, streaming APIs, and request-scoped observability. Application-specific policies and integrations remain under your control.

[See a concrete side-by-side comparison →](docs/why-orvaxis.md)

---

## Architecture Overview
For a matched request, the main execution stages are:

```text
onRequest → route match → pre-validation policies
          → beforePipeline → global/group/route middleware
          → input validation → post-validation policies
          → beforeHandler → handler → afterHandler
          → trace finalization → afterPipeline
```

Request validation and response validation are opt-in plugins. Response contracts are checked when handlers send values through the Orvaxis response API. Denials, errors and successful short-circuits stop later stages; errors finalize the trace before `onError`. The [lifecycle reference](docs/reference/lifecycle.md) documents the complete order and hook contracts.

---

## Core Concepts

Orvaxis groups policies, middleware, hooks, and route handlers into a predictable request flow. Route declarations inherit policies and middleware from their group. Typed request context carries application state through async work; validators and plugins add opt-in behavior.

The [core concepts reference](docs/reference/core-concepts.md) covers the router, policy scopes and priority, hook contracts, plugins, traces, debugging, and typed context. The [lifecycle reference](docs/reference/lifecycle.md) shows the actual execution order.

---

## HTTP Adapters

Orvaxis is not tied to any HTTP framework: adapters are thin wrappers that normalize the incoming request and delegate to the runtime. Two are included.

| Adapter | Import | Peer dependency |
|---|---|---|
| Express | `createExpressServer` from `orvaxis/express` | `express ^4.20 \|\| ^5` (types: `@types/express`) |
| Fastify | `createFastifyServer` from `orvaxis/fastify` | `fastify ^5` |

Both peers are optional and each adapter has its own subpath, so `orvaxis`, `orvaxis/testing` and `orvaxis/openapi` never need either. Importing `orvaxis/express`, `orvaxis/fastify` or `orvaxis/otel` without its peer fails immediately with a module-not-found error that names the package. Both full-runtime adapters mount Orvaxis as a catch-all, so routing, hooks and declared validation come from the Orvaxis runtime; benchmark your application before drawing performance conclusions. To protect one existing Express route without moving its handler, use the [existing route guide](docs/guide/integrate-existing-route.md).

Adapter details are in the documentation:

- [HTTP adapters](docs/guide/http-adapters.md) — query-string parsing differences, body size limits, the error response envelope, request IDs, custom adapters
- [Timeouts and graceful shutdown](docs/guide/timeouts-and-shutdown.md) — per-request deadlines, `ctx.req.signal`, draining connections
- [Streaming](docs/guide/streaming.md) — SSE, files and `pipe`

---

## Testing

`testRequest` runs the full lifecycle (policies, middleware, validation, handler) against an `Orvaxis` instance without starting a server, so tests exercise the runtime the adapters use:

```ts
import { testRequest } from "orvaxis/testing"

const result = await testRequest(app, { path: "/api/reports/alice", headers: { "x-user-id": "bob" } })
// result.status === 403; result.ctx holds the trace for diagnostics
```

The [testing guide](docs/guide/testing.md) covers the response shape, permission matrices (`testPolicyMatrix`), static policy requirements for CI (`checkPolicyRequirements`) and route introspection (`app.inspectRoutes()`).

---

## Documentation

This README and the documentation site describe the `main` branch. The published package is 0.4.0; changes made since then are listed under *Unreleased* in the [changelog](CHANGELOG.md) and in [Unreleased changes](docs/migration/next.md), and marked as unreleased where they are documented. Upgrading from 0.3.1? See [Migrating from 0.3.1 to 0.4.0](docs/migration/0.3.1-to-0.4.0.md).

Browse the [Orvaxis documentation site](https://maku85.github.io/orvaxis/) for the getting-started guide, navigable references, examples, and articles. The Markdown sources remain available below and in `docs/`.

[Explore the recorded allow, deny, and handler-error traces](docs/demo/policy-traces.md) in the static documentation demo.

- [Get started](docs/guide/getting-started.md) — the quickstart as a guide: protect one route and see the allowed/denied result
- [Add Orvaxis to an existing Express route](docs/guide/integrate-existing-route.md) — add policy checks without moving the handler
- [Multi-tenant task demo](docs/guide/multi-tenant-demo.md) — runnable tenant, ownership, roles, traces, permission matrix, and CI checks
- [Diagnose a 403](docs/guide/diagnose-403.md) — find the terminal policy and verify skipped stages
- [Request lifecycle reference](docs/reference/lifecycle.md) — hook, middleware, validation, and policy order
- [Core concepts reference](docs/reference/core-concepts.md) — router, policies, hooks, plugins, tracing, and context
- [Typed request schemas](docs/reference/core-concepts.md#typed-context) — infer handler types from parsed and transformed values
- [Response contracts and OpenAPI](docs/reference/core-concepts.md#response-contracts-and-openapi) — validate outgoing values and generate API metadata
- [Tracing and debugging](docs/reference/core-concepts.md#tracing-system) — lifecycle traces, custom events, and combined debug timelines
- [Plugins and OpenTelemetry](docs/reference/core-concepts.md#plugins) — logging, validation, CORS, and optional span export
- [HTTP adapters](docs/guide/http-adapters.md), [streaming](docs/guide/streaming.md), and [timeouts and graceful shutdown](docs/guide/timeouts-and-shutdown.md) — request and connection lifecycle in the HTTP adapters
- [Testing](docs/guide/testing.md) — `testRequest`, permission matrices, static policy requirements and route introspection
- [Diagnosing an API 403](docs/articles/diagnosing-a-403.md) — trace a denial to its terminal policy
- [Tenant authorization](docs/articles/tenant-authorization.md) — separate tenant access, ownership, and roles
- [Authorization requirements in CI](docs/articles/authorization-requirements-in-ci.md) — combine static route checks with permission tests
- [Why Orvaxis](docs/why-orvaxis.md) — side-by-side comparison with plain Express: auth, rate limiting, and observability with and without Orvaxis
- [Cookbook](docs/cookbook.md) — practical use cases with working examples (authentication, RBAC, rate limiting, tracing, feature flags, and more)
- [Benchmarks](docs/benchmarks.md) — microbenchmark results for each execution layer, plus instructions to run them locally

---

## Example Usage

The [multi-tenant task demo](docs/guide/multi-tenant-demo.md) includes runnable server commands, fixture identities, expected responses, permission traces, and the CI check. Its fixture storage is in-memory and local to the process.

### Express
```ts
import { Orvaxis } from "orvaxis"
import { createExpressServer } from "orvaxis/express"
import type { Policy } from "orvaxis"

const app = new Orvaxis()

const requireApiKey: Policy = {
  name: "require-api-key",
  priority: 100,
  evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"]
    if (!key) return { allow: false, reason: "Missing X-API-Key header" }
    return { allow: true }
  }
}

app.policy(requireApiKey)

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/users",
      handler: async (ctx) => {
        ctx.res.json({ users: [] })
      }
    }
  ]
})

const server = createExpressServer(app)
server.listen(3000)
```

### Fastify
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
        ctx.res.send({ id: ctx.meta.route?.params.id })
      }
    }
  ]
})

const server = createFastifyServer(app)
server.listen(3000)
```

---

## Project Structure
```
orvaxis/
  index.ts                   entry point, public API (no optional peer dependencies)
  express.ts                 orvaxis/express entry point (server adapter and policy guard)
  fastify.ts                 orvaxis/fastify entry point (createFastifyServer)
  otel.ts                    orvaxis/otel entry point (otelPlugin)
  openapi.ts                 orvaxis/openapi entry point (generateOpenApiDocument)
  testing.ts                 orvaxis/testing entry point

  core/
    Orvaxis.ts               public-facing class
    Runtime.ts               execution engine
    Router.ts                route matching, groups, and introspection (routes())
    Pipeline.ts              global middleware chain
    PolicyEngine.ts          policy evaluation
    Hook.ts                  hook system
    Tracer.ts                per-request trace
    Debugger.ts              debug timeline
    Context.ts               context factory
    contextStore.ts          AsyncLocalStorage store (getContext)
    HttpError.ts             HttpError class (status + message + cause)
    testHarness.ts           testRequest and policy-matrix helpers for unit testing
    policyRequirements.ts    static route-policy checks for CI (exported via orvaxis/testing)
    mockResponse.ts          createMockResponse (exported via orvaxis/testing)
    utils.ts                 shared utilities (mergeSafe, UNSAFE_KEYS)

  debug/
    buildExecutionSummary.ts combined trace + debug summary
    traceEvent.ts            emit custom trace events without ctx

  http/
    expressAdapter.ts        Express adapter (exported via orvaxis/express)
    fastifyAdapter.ts        Fastify adapter (exported via orvaxis/fastify)
    timeout.ts               withTimeout helper and AdapterOptions type

  middleware/
    traceMiddleware.ts       trace timing around middleware execution

  plugins/
    PluginManager.ts         plugin registry (Plugin type + PluginManager class)
    loggerPlugin.ts          built-in logger plugin
    corsPlugin.ts            configurable CORS and preflight handling
    otelPlugin.ts            OpenTelemetry SERVER span per request + orvaxis.pipeline/orvaxis.handler child spans (exported via orvaxis/otel, requires @opentelemetry/api)
    schemaValidationPlugin.ts body/params/query/headers validation via route.schema
    responseValidationPlugin.ts status-specific handler response validation; streaming is not buffered

  openapi/
    generateOpenApiDocument.ts  optional-converter OpenAPI 3.1 generation from inspected routes (orvaxis/openapi)

  types/
    index.ts                 all shared types

  examples/
    express-server.ts        minimal Express setup
    policy-server.ts         global and route-level policies
    policy-matrix.ts         identity, ownership, tenant, and admin test scenarios
    policy-ci-check.ts       static policy requirements plus dynamic permission checks
    tenant-tasks.ts          shared multi-tenant task fixtures, policies, and permission matrix
    tenant-tasks-server.ts   runnable Express API for the multi-tenant task example
    tenant-tasks-check.ts    CI policy requirements, matrix assertions, and decision traces
    quickstart.ts            protected-route Express quickstart
    typed-schema.ts          inferred body, params, query, and header outputs
    hooks-and-plugins.ts     lifecycle hooks and plugin registration
    debug-trace.ts           debugger, traceEvent, and buildExecutionSummary
    typed-context.ts         typed OrvaxisContext, getContext, traceEvent
    otel-plugin.ts           otelPlugin with child spans + custom span enrichment
    fastify-server.ts        Fastify adapter with policies and param routing
    wildcard-routing.ts      named wildcard (/*filepath), unnamed catch-all (/*), priority demo
    streaming.ts             SSE, NDJSON, and file streaming via write/end/pipe
```

---

## Design Philosophy

Orvaxis is built around a few key ideas:

- __Separation of concerns at runtime level__
- __Declarative control of execution__
- __Transparent request lifecycle__
- __Composable system primitives instead of monolithic abstractions__

It favors:

- explicitness over magic
- composition over inheritance
- observability over hidden behavior

---

## Current Status

The core execution model is covered by runtime, adapter, public API type, and example tests. CI runs the suite with coverage checks.

Not yet recommended for production. Known gaps before production use:

| Gap | Detail |
|-----|--------|
| **API stability** | Pre-1.0 — breaking changes may occur between minor versions. |

Graceful shutdown is supported via `server.close()` on the `ServerAdapter`. Both built-in adapters enforce a `shutdownTimeout` (default 10 s) so the process exits cleanly even when active connections stall.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code conventions, and the PR process. To report a bug or propose a feature, use the [GitHub issue templates](https://github.com/maku85/orvaxis/issues/new/choose).

---

## License

MIT
