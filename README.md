<p align="center">
  <img src="./assets/orvaxis-banner.png" width="800"/>
</p>

<h1 align="center">Orvaxis</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/orvaxis"><img src="https://img.shields.io/npm/v/orvaxis" alt="npm version"/></a>
  <a href="https://github.com/maku85/orvaxis/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/maku85/orvaxis/ci.yml?label=CI" alt="CI"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/orvaxis" alt="license"/></a>
  <a href="https://www.npmjs.com/package/orvaxis"><img src="https://img.shields.io/node/v/orvaxis" alt="node version"/></a>
</p>

<p align="center">
  Lightweight, policy-driven execution runtime for Node.js applications.
</p>

---

## Installation

```bash
npm install orvaxis
```

Install the HTTP adapter peer dependency you intend to use:

```bash
npm install express   # Express adapter
npm install fastify   # Fastify adapter
```

The package ships both **CommonJS** (`require`) and **ES Module** (`import`) builds. Bundlers and native ESM consumers pick up the ESM build automatically via the `"exports"` map; no configuration needed.

It is not a framework in the traditional sense.
It is an **execution orchestration layer** designed to control, observe, and structure backend request flows in a predictable and composable way.

---

## Why Orvaxis

Minimal frameworks like Express are flexible but unstructured at scale. Opinionated frameworks like NestJS are structured but heavy. Orvaxis is a third option: a **runtime execution layer** that brings explicit ordering, declarative control, and built-in observability without replacing your framework.

[See a concrete side-by-side comparison →](docs/why-orvaxis.md)

---

## Core Principles

### 1. Execution is explicit
Every request passes through a clearly defined lifecycle:
- policies (decision layer)
- hooks (event layer)
- middleware (flow layer)
- route handler (business logic)

---

### 2. Control is declarative
Policies define *what is allowed*, independently from implementation logic.

---

### 3. Structure is hierarchical
Routes are organized in groups with inheritance:
- shared middleware
- shared policies
- scoped execution context

---

### 4. Observability is built-in
Every request produces a trace:
- execution timeline
- performance metrics
- lifecycle events
- debug summary

---

### 5. Extensibility via plugins
System capabilities are extended through plugins that attach to lifecycle hooks.

---

## Architecture Overview
```
Request
↓
Policy Engine (global → group → route)
↓
onRequest hook
↓
beforePipeline hook
↓
Global Pipeline (app.use() middleware)
↓
Group Middleware (inherited)
↓
Route Middleware (scoped)
↓
beforeHandler hook
↓
Route Handler
↓
afterHandler hook
↓
Trace finalization
↓
afterPipeline hook
↓
Debug output (if enabled)
```

---

## Core Concepts

### Runtime
The central execution engine responsible for orchestrating the full request lifecycle.

### Router
Handles route resolution and grouping:
- method + path matching via a per-method radix trie — `O(d)` in path depth, independent of total route count
- static segments always take priority over param segments, which take priority over wildcard catch-alls at the same level; backtracking is automatic
- group-based inheritance
- route metadata resolution

Route paths support three segment types:

| Syntax | Example | Matches | Captured as |
|--------|---------|---------|-------------|
| Static | `/users` | exact string | — |
| Param | `/:id` | one segment | `params.id` |
| Wildcard | `/*` or `/*name` | all remaining segments | `params["*"]` or `params.name` |

The wildcard must be the last segment in the pattern. More specific routes always win: `/users/me` beats `/:id`, which beats `/*`.

`HEAD` requests automatically fall back to the matching `GET` route when no dedicated `HEAD` route is registered. The `GET` handler executes in full — policies, middleware, and hooks all run — but the response body is suppressed and the connection is closed cleanly. Headers set by the handler (e.g. `Content-Type`, custom headers) are forwarded normally. A dedicated `HEAD` route always takes priority over the fallback.

```ts
// GET /api/users → { users: [] }
// HEAD /api/users → 200, correct headers, no body  (automatic, no extra code needed)
app.group({
  prefix: "/api",
  routes: [{ method: "GET", path: "/users", handler: async (ctx) => ctx.res.json({ users: [] }) }],
})
```

Registering two routes with the same method and pattern throws a `TypeError` immediately at registration time:

```ts
app.group({ prefix: "/api", routes: [{ method: "GET", path: "/users", handler }] })
app.group({ prefix: "/api", routes: [{ method: "GET", path: "/users", handler }] })
// TypeError: Duplicate route: GET /api/users

// param name conflict at the same trie position
app.group({ prefix: "/api", routes: [{ method: "GET", path: "/:id",     handler }] })
app.group({ prefix: "/api", routes: [{ method: "GET", path: "/:userId", handler }] })
// TypeError: Route conflict: GET /api/:userId — param ":userId" conflicts with ":id" already registered at this position
```

Routes that share a path but differ in HTTP method, or that share a pattern across different group prefixes, are allowed.

`Route.method` is typed as `HttpMethod` (`"GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"`). Methods are normalised to uppercase at both registration and match time, so a route registered as `"get"` and a request arriving as `"GET"` always find each other. Unknown method strings are rejected at registration with a `TypeError`.

```ts
app.group({
  prefix: "/files",
  routes: [
    // named wildcard — captures the full remaining path
    {
      method: "GET",
      path: "/*filepath",
      handler: async (ctx) => {
        const { filepath } = ctx.params // e.g. "docs/readme.md"
        ctx.res.json({ filepath })
      },
    },
  ],
})
```

### Groups
Logical grouping of routes:
- shared middleware
- shared policies
- prefix-based organization

Example:
```ts
app.group({
  prefix: "/api",
  middleware: [traceMiddleware()],
  policies: [rateLimitPolicy],
  routes: [...]
})
```

---

### Middleware

Functions that participate in execution flow and can:

- mutate context
- control execution flow
- enrich request state

---

### Policies

Pre-execution rules that determine whether a request is allowed.

- can block execution
- can modify context metadata
- can be scoped (route/group/global)
- can be prioritized

Example:
```ts
type AuthState = { userId: string; role: "user" | "admin" }

export const requireApiKey: Policy<AuthState> = {
  name: "require-api-key",
  priority: 100,
  async evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"] as string
    const identity = IDENTITIES[key]
    if (!identity) return { allow: false, reason: "Missing X-API-Key header", status: 401 }
    ctx.state = identity   // typed write — no cast needed
    return { allow: true }
  }
}

// handler — ctx.state is typed as AuthState
const handler = async (ctx: OrvaxisContext<AuthState>) => {
  ctx.state.role   // "user" | "admin"
  ctx.state.userId // string
}
```

`scope.method` is typed as `HttpMethod` (always uppercase). The request method is normalised to uppercase before the comparison, so a request arriving as `"get"` still matches a scope with `method: "GET"`.

---

### Hooks

Lifecycle events that allow observation of execution:

- `onRequest` — fired after policy evaluation, before middleware
- `beforePipeline` — fired before the global pipeline runs
- `beforeHandler` — fired after all middleware, immediately before the route handler
- `afterHandler` — fired immediately after the route handler completes
- `afterPipeline` — fired after the handler and trace finalization
- `onError` — fired on any unhandled error

`beforeHandler` / `afterHandler` wrap only the handler itself, independent from the pipeline. Use them for per-handler timing, logging, or auditing without interfering with middleware. They do not fire when the handler throws — use `onError` for that case.

Hooks do not modify flow; they observe and react.

All registered listeners for a hook always run, even if an earlier one throws. If exactly one listener throws, that error is re-thrown as-is. If more than one throws, a native `AggregateError` is raised with all errors available in `.errors[]`:

```ts
app.on("afterPipeline", async (ctx) => {
  // inspect all hook errors when multiple listeners fail
  try {
    // ...
  } catch (err) {
    if (err instanceof AggregateError) {
      for (const e of err.errors) console.error(e)
    }
  }
})
```

`onError` hook listeners that throw are logged via the injected logger and never re-thrown.

Use `HttpError` to throw errors with an explicit HTTP status code from anywhere in the lifecycle — handlers, middleware, policies, or hooks:

```ts
import { HttpError } from "orvaxis"

// in a handler
throw new HttpError(404, "User not found")

// in onError — check the type before accessing .status
app.on("onError", (ctx) => {
  if (ctx.error instanceof HttpError) {
    console.error(`[${ctx.error.status}] ${ctx.error.message}`)
  }
})
```

`HttpError` extends the native `Error` class and accepts an optional `ErrorOptions` third argument (e.g. `{ cause }` for error chaining).

---

### Plugins

Plugins extend runtime capabilities by registering hooks, middleware, or policies.

Orvaxis ships with two built-in plugins:

**`loggerPlugin`** — logs incoming requests and unhandled errors. It is a factory function that accepts an optional `{ logger }` argument:

```ts
import { Orvaxis, loggerPlugin } from "orvaxis"

// default: uses console
const app = new Orvaxis()
app.register(loggerPlugin())

// custom logger (pino, winston, or any object satisfying Logger)
app.register(loggerPlugin({ logger: pinoInstance }))
```

The `Logger` interface requires only `info` and `error` methods, making it compatible with `console`, pino, winston, and most structured loggers:

```ts
import type { Logger } from "orvaxis"

const myLogger: Logger = {
  info: (...args) => pino.info(args),
  error: (...args) => pino.error(args),
}
```

The same logger can be passed to `new Orvaxis({ logger })` to capture hook system meta-errors, and to the adapter options to capture post-response errors:

```ts
const logger = pinoInstance
const app = new Orvaxis({ logger })
const server = createExpressServer(app, undefined, { logger })
app.register(loggerPlugin({ logger }))
```

**`schemaValidationPlugin`** — validates `body`, `params`, `query`, and `headers` against a `route.schema` before the handler runs. Any library whose objects expose a `.parse(data)` method works (Zod, TypeBox, custom validators):

```ts
import { Orvaxis, schemaValidationPlugin } from "orvaxis"
import { z } from "zod"

const app = new Orvaxis()
app.register(schemaValidationPlugin)

app.group({
  prefix: "/api",
  routes: [
    {
      method: "POST",
      path: "/users",
      schema: {
        body: z.object({ name: z.string(), age: z.number().int().min(0) }),
      },
      handler: async (ctx) => {
        // ctx.req.body   — parsed, coerced body
        // ctx.req.query  — typed as Record<string, string | string[]>, populated by both adapters
        ctx.res.status(201).json(ctx.req.body)
      },
    },
  ],
})
```

On validation failure the plugin throws an error with `status: 422`, a `field` property indicating which part failed (`"body"`, `"params"`, `"query"`, or `"headers"`), and the original validator error as `cause`. The plugin is opt-in — routes with a `schema` field are silently ignored unless `schemaValidationPlugin` is registered.

To write a custom plugin:

```ts
import type { Plugin } from "orvaxis"

const metricsPlugin: Plugin = {
  name: "metrics",
  apply(ctx) {
    ctx.hooks.on("afterPipeline", (reqCtx) => {
      const duration = reqCtx.meta.trace?.endTime - reqCtx.meta.trace?.startTime
      recordMetric("request.duration", duration)
    })
  }
}

app.register(metricsPlugin)
```

The `apply` parameter is typed as `PluginContext`, a minimal interface that exposes only `hooks.on`. If you need explicit typing on `apply`, import `PluginContext` directly:

```ts
import type { Plugin, PluginContext } from "orvaxis"

const myPlugin: Plugin = {
  name: "my-plugin",
  apply(ctx: PluginContext) {
    ctx.hooks.on("onRequest", (reqCtx) => { /* ... */ })
  }
}
```

Registered plugins are tracked in `runtime.plugins` and applied immediately on registration. `PluginManager` is also exported for custom orchestration.

---

### Tracing System

Each request generates a structured execution trace available as `ctx.meta.trace`:

- `requestId` — unique identifier per request
- `events` — timestamped lifecycle events (`TraceEvent[]`); timestamps are wall-clock-aligned with sub-millisecond decimal precision, guaranteed monotonically increasing within a request
- `startTime` / `endTime` — wall-clock boundaries in integer milliseconds (`Date.now()`)

Use `traceMiddleware()` to automatically record timing around middleware execution:

```ts
import { traceMiddleware } from "orvaxis"

app.group({ prefix: "/api", middleware: [traceMiddleware()], routes: [...] })
```

Emit custom events from anywhere in the call chain with `traceEvent()` — no need to pass `ctx`:

```ts
import { traceEvent } from "orvaxis"

async function fetchUser(id: string) {
  traceEvent("db:query", { table: "users", id })
  // ...
}
```

`traceEvent` is a no-op when called outside a request scope.

---

### Debug Layer

When enabled, the debugger records a structured timeline of every lifecycle step:

```ts
app.debugger.enable()
```

Use `buildExecutionSummary(ctx)` to get a structured view of both the trace and the debug timeline:

```ts
import { buildExecutionSummary } from "orvaxis"

app.on("afterPipeline", (ctx) => {
  const summary = buildExecutionSummary(ctx)
  // summary.requestId      — from ctx.meta.trace
  // summary.duration       — total ms
  // summary.traceEvents    — user-emitted events (traceEvent / traceMiddleware)
  // summary.debugSteps     — internal lifecycle events grouped by phase (requires debugger enabled)
  // summary.combinedTimeline — all events merged and sorted by timestamp, each with a `kind` field ("trace" | "debug")
  // summary.route          — matched route + group
})
```

`combinedTimeline` is the easiest way to understand the full sequence of what happened during a request — it interleaves your custom trace events with the internal lifecycle steps in chronological order. Each entry carries `{ kind, name, timestamp, meta }`.

`buildExecutionSummary` always returns an object — `traceEvents`, `combinedTimeline`, and `duration` are available even without the debugger enabled.

---

### Execution Model

A request lifecycle is deterministic:

```
1   Policy evaluation     global → group → route, sorted by priority
2   onRequest hook
3   beforePipeline hook
4   Global pipeline       middleware registered via app.use()
5   Group middleware
6   Route middleware
7   beforeHandler hook
8   Route handler
9   afterHandler hook
10  Trace finalization    ctx.meta.trace is set
11  afterPipeline hook
12  Debug output          if app.debugger.enable() was called
```

---

### Typed Context

`OrvaxisContext` accepts two optional type parameters to add compile-time types to `ctx.state` and `ctx.meta`:

```ts
type AppState = { user: { id: string; role: string } }
type AppMeta  = { requestId: string }

type AppContext = OrvaxisContext<AppState, AppMeta>

const handler = async (ctx: AppContext) => {
  ctx.state.user.role   // string
  ctx.meta.requestId    // string
  ctx.meta.tracer       // TracerLike | undefined  (always present from ContextMeta)
}
```

The second parameter is intersected with `ContextMeta`, so all framework-internal fields remain typed.

#### `ctx.params` — URL parameter shortcut

`ctx.params` is a shorthand for `ctx.meta.route?.params ?? {}`. It is always safe to access inside a handler — no `!` assertion needed:

```ts
// before
const { id } = ctx.meta.route!.params

// after
const { id } = ctx.params
```

#### `defineRoute<TBody>()` — typed request body

`ctx.req.body` is typed as `unknown` on all routes. Use `defineRoute` to propagate the Zod (or any `.parse()`-based) schema's inferred type directly into `ctx.req.body` inside the handler, eliminating the manual cast:

```ts
import { defineRoute, schemaValidationPlugin } from "orvaxis"
import { z } from "zod"

const CreateUserBody = z.object({ name: z.string(), age: z.number() })

app.group({
  prefix: "/api",
  routes: [
    defineRoute({
      method: "POST",
      path: "/users",
      schema: { body: CreateUserBody },
      handler: async (ctx) => {
        const body = ctx.req.body          // z.infer<typeof CreateUserBody> — no cast
        ctx.res.status(201).json({ name: body.name })
      },
    }),
  ],
})
```

Pass `TState` as a second type argument to also type `ctx.state`:

```ts
defineRoute<z.infer<typeof CreateUserBody>, AuthState>({ ... })
```

---

### Request-scoped Context

`getContext()` returns the `OrvaxisContext` for the currently executing request, from anywhere in the async call chain — no need to thread `ctx` through every function:

```ts
import { getContext } from "orvaxis"

async function getCurrentUser() {
  const ctx = getContext()
  return ctx?.state.user
}
```

Returns `undefined` when called outside a request scope. Backed by `AsyncLocalStorage` — concurrent requests are fully isolated.

---

## HTTP Adapters

Orvaxis is not tied to any specific HTTP framework. The core runtime is framework-agnostic — adapters are thin wrappers that normalize the incoming request and delegate to the runtime.

Two adapters are included out of the box:

| Adapter | Import | Peer dependency |
|---|---|---|
| Express | `createExpressServer` | `express ^4.20 \|\| ^5` |
| Fastify | `createFastifyServer` | `fastify ^5` |

Install only the framework you intend to use — both peer dependencies are optional.

### Timeout

Both adapters accept an optional `AdapterOptions` third argument:

```ts
import { createExpressServer } from "orvaxis"

// default: 30 000 ms
const server = createExpressServer(app)

// custom deadline
const server = createExpressServer(app, undefined, { timeout: 10_000 })

// disabled (long-running handlers, streaming, etc.)
const server = createExpressServer(app, undefined, { timeout: 0 })
```

When the deadline expires the adapter sends a 408 response and sets `ctx.req.signal` to aborted, so any downstream work that accepts an `AbortSignal` is cancelled immediately:

```ts
handler: async (ctx) => {
  // fetch is aborted if the request times out
  const res = await fetch("https://api.example.com/data", { signal: ctx.req.signal })
  ctx.res.json(await res.json())
}
```

`ctx.req.signal` is always defined when using the built-in adapters. Pass it to `node:http` requests, database drivers (pg, mongodb, prisma), or any API that accepts an `AbortSignal` to stop work the client will never see. The same option is available on `createFastifyServer`.

`withTimeout` and `AdapterOptions` are exported from the main entry point so custom adapters can reuse them:

```ts
import { withTimeout, type AdapterOptions } from "orvaxis"
```

### Error responses

Adapters sanitize error messages based on `NODE_ENV`:

| Environment | Generic `Error` | `HttpError` |
|---|---|---|
| `production` | `"Internal Server Error"` | original message |
| anything else | original message | original message |

`HttpError` messages are always forwarded because they are intentional user-facing responses. All other error messages are hidden in production to avoid leaking internal details such as stack traces, file paths, or database error text.

`sanitizeErrorMessage` is exported for custom adapters:

```ts
import { sanitizeErrorMessage } from "orvaxis"

// in a custom adapter's catch block:
res.status(err.status ?? 500).json({ error: sanitizeErrorMessage(err) })
```

### Request ID

Both adapters automatically assign a request ID on every request and return it in the `X-Request-ID` response header. The ID is also available as `ctx.req.id` throughout the entire execution lifecycle.

Priority order for the ID value:

1. `X-Request-ID` header from the incoming request — honours upstream propagation (API gateway, service mesh, distributed tracing)
2. Fastify's native request ID (Fastify adapter only)
3. `crypto.randomUUID()` — generated if none of the above is present

```ts
app.on("afterPipeline", (ctx) => {
  console.log(ctx.req.id) // always defined — e.g. "550e8400-e29b-41d4-a716-446655440000"
})
```

`loggerPlugin` automatically includes the ID in every log line:

```
[REQ] GET /api/users 550e8400-e29b-41d4-a716-446655440000
[ERR] 550e8400-e29b-41d4-a716-446655440000 Error: something failed
```

### Streaming

`ctx.res` exposes three methods for streaming responses:

| Method | Behaviour |
|--------|-----------|
| `ctx.res.write(chunk)` | Sends a chunk to the client without closing the connection |
| `ctx.res.end(chunk?)` | Sends an optional final chunk and closes the connection |
| `ctx.res.pipe(stream)` | Pipes a `node:stream.Readable` directly to the response |

```ts
app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/events",
      handler: async (ctx) => {
        ctx.res.setHeader("Content-Type", "text/event-stream")
        ctx.res.setHeader("Cache-Control", "no-cache")

        ctx.res.write("data: connected\n\n")

        // send a few events then close
        for (let i = 1; i <= 3; i++) {
          ctx.res.write(`data: event ${i}\n\n`)
        }

        ctx.res.end()
      },
    },
    {
      method: "GET",
      path: "/file/:name",
      handler: async (ctx) => {
        const { createReadStream } = await import("node:fs")
        const stream = createReadStream(`/data/${ctx.meta.route!.params.name}`)
        ctx.res.pipe(stream)
      },
    },
  ],
})
```

When using the built-in adapters, disable the default 30 s timeout for long-lived streaming connections:

```ts
const server = createExpressServer(app, undefined, { timeout: 0 })
```

For testing, `testRequest` captures all chunks in `result.chunks` and exposes `result.ended`, so streaming handlers do not require a live server.

### Writing a custom adapter

Any adapter needs to:
1. Ensure `req.path` is a plain path string (no query string)
2. Create an `AbortController`, attach its `signal` to the request, and pass the controller as the third argument to `withTimeout` so that in-flight work is cancelled when the deadline expires
3. Call `app.handle(req, res)` (wrapped in `withTimeout` if a deadline is needed) and catch thrown errors, using `sanitizeErrorMessage` to build the response body
4. Return `{ listen(port, onListen?), close() }` to satisfy the `ServerAdapter` interface
5. In `close()`, call `server.closeIdleConnections()` before `server.close()` to release idle HTTP keep-alive connections immediately, allowing the close callback to fire as soon as active requests complete rather than waiting indefinitely

---

## Testing

`testRequest` runs the full execution cycle — policies, pipeline, middleware, handler — against an `Orvaxis` instance, with no HTTP server required.

```ts
import { Orvaxis, testRequest } from "orvaxis"

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
// notFound.error   → Error("Not Found")

// streaming handler
const streamed = await testRequest(app, { path: "/api/stream" })
// streamed.chunks  → ["chunk1", "chunk2"]   (written via ctx.res.write)
// streamed.ended   → true                   (ctx.res.end was called)
```

`TestRequestInit` accepts `path`, `method` (defaults to `"GET"`), `headers`, `query`, `id`, and any additional field (e.g. `body`) which is forwarded directly onto `req`. `query` is typed as `Record<string, string | string[]>` and maps directly to `ctx.req.query` inside the handler: `testRequest` never throws — errors thrown during execution are captured in `result.error` and their `.status` property (if present) is reflected in `result.status`. For streaming handlers, `result.chunks` holds all values passed to `ctx.res.write` and `ctx.res.end`, and `result.ended` is `true` when `ctx.res.end` was called.

### Route introspection

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

---

## Documentation

- [Why Orvaxis](docs/why-orvaxis.md) — side-by-side comparison with plain Express: auth, rate limiting, and observability with and without Orvaxis
- [Cookbook](docs/cookbook.md) — practical use cases with working examples (authentication, RBAC, rate limiting, tracing, feature flags, and more)
- [Benchmarks](docs/benchmarks.md) — microbenchmark results for each execution layer, plus instructions to run them locally

---

## Example Usage

### Express
```ts
import { Orvaxis, createExpressServer } from "orvaxis"
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
import { Orvaxis, createFastifyServer } from "orvaxis"

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
  index.ts                   entry point, public API

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
    testHarness.ts           testRequest helper for unit testing
    utils.ts                 shared utilities (mergeSafe, UNSAFE_KEYS)

  debug/
    buildExecutionSummary.ts combined trace + debug summary
    traceEvent.ts            emit custom trace events without ctx

  http/
    expressAdapter.ts        Express adapter
    fastifyAdapter.ts        Fastify adapter
    timeout.ts               withTimeout helper and AdapterOptions type

  middleware/
    traceMiddleware.ts       trace timing around middleware execution

  plugins/
    PluginManager.ts         plugin registry (Plugin type + PluginManager class)
    loggerPlugin.ts          built-in logger plugin
    schemaValidationPlugin.ts body/params/query/headers validation via route.schema

  types/
    index.ts                 all shared types

  examples/
    express-server.ts        minimal Express setup
    policy-server.ts         global and route-level policies
    hooks-and-plugins.ts     lifecycle hooks and plugin registration
    debug-trace.ts           debugger, traceEvent, and buildExecutionSummary
    typed-context.ts         typed OrvaxisContext, getContext, traceEvent
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

The core execution model is stable, tested, and covered by 279 passing tests.

Not yet recommended for production. Known gaps before production use:

| Gap | Detail |
|-----|--------|
| **API stability** | Pre-1.0 — breaking changes may occur between minor versions. |

Graceful shutdown is supported via `server.close()` on the `ServerAdapter`.

---

## Future Directions

- **OpenTelemetry export** — the trace system already produces structured spans; a plugin exporting to OTLP/Zipkin is a natural next step

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code conventions, and the PR process. To report a bug or propose a feature, use the [GitHub issue templates](https://github.com/maku85/orvaxis/issues/new/choose).

---

## License

MIT
