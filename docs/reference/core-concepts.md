# Core concepts reference

Detailed runtime, router, policy, hooks, plugins, tracing, and context reference. For the exact stage order and short-circuit rules, see the [request lifecycle reference](lifecycle.md).


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

`HEAD` requests automatically fall back to the matching `GET` route when no dedicated `HEAD` route is registered. The `GET` handler executes in full — policies, middleware, and hooks all run — but the response body is suppressed and the connection is closed cleanly. `Content-Length` and `Content-Type` are computed from the body the `GET` handler would have sent and set on the response before closing, so clients using `HEAD` for prefetch or cache validation see accurate metadata. A dedicated `HEAD` route always takes priority over the fallback.

```ts
// GET /api/users → { users: [] }
// HEAD /api/users → 200, correct headers, no body  (automatic, no extra code needed)
app.group({
  prefix: "/api",
  routes: [{ method: "GET", path: "/users", handler: async (ctx) => ctx.res.json({ users: [] }) }],
})
```

When a path is registered but the incoming method is not, the router responds with `405 Method Not Allowed` and sets an `Allow` response header listing every method registered on that path. `HEAD` is included automatically whenever `GET` is registered.

```ts
app.group({
  prefix: "/api",
  routes: [{ method: "GET", path: "/users", handler: async (ctx) => ctx.res.json([]) }],
})

// POST /api/users → 405 Method Not Allowed
//                    Allow: GET, HEAD
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

Middleware uses an onion-style `next()` chain. `await next()` runs the remaining middleware in the current layer and then returns to the caller. Call `next()` at most once. If middleware returns without calling it, Orvaxis stops the rest of the request lifecycle, including later middleware layers and the route handler. A response sent with `ctx.res.json()`, `send()`, `end()`, `write()`, or `pipe()` also stops later application phases, even if middleware then calls `next()`.

When the lifecycle stops, `afterPipeline` still runs once for final logging and tracing. `afterHandler` runs only if the route handler ran. Hooks that send a response at `onRequest`, `beforePipeline`, `onValidation`, or `beforeHandler` likewise stop later application phases. If middleware stops without sending a response, it must arrange for a response elsewhere or throw an error; otherwise the HTTP connection may remain open.

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

`scope.path` supports three forms:

| Form | Example | Matches |
|---|---|---|
| `string` | `"/api"` | `/api` and any sub-path (`/api/v1/users`) but not `/apiv2` |
| `RegExp` | `/^\/admin/` | any path matching the pattern |
| `(path) => boolean` | `p => p.startsWith("/admin") && !p.startsWith("/admin/public")` | custom predicate |

String matching is prefix-based: `"/api"` covers the entire sub-tree without requiring a RegExp. There are no false positives — `"/api"` does not match `"/apiv2"`.

Scopes filter global, group, and route policies with the same rules. Policies execute in fixed layers: global first, then group, then route. Within each layer, higher `priority` runs first; equal priorities keep registration order (global) or declaration order (group and route). A priority in one layer never moves that policy ahead of another layer. The first denial stops evaluation. RegExp scopes with `g` or `y` flags are reset for each request, so reuse does not make matches alternate.

---

### Hooks

Lifecycle events that allow observation of execution:

- `onRequest` — fired first, before routing; every request passes through this hook
- `onNotFound` — fired when no route matches the requested path, before the 404 error is thrown
- `onMethodNotAllowed` — fired when the path is registered but the HTTP method is not, before the 405 error is thrown; `ctx.meta.allowedMethods` is already populated
- `beforePipeline` — fired before the global pipeline runs
- `onValidation` — fired after all middleware, before post-validation policies; `schemaValidationPlugin` validates/coerces `route.schema` fields here
- `beforeHandler` — fired after validation and post-validation policies, immediately before the route handler
- `afterHandler` — fired immediately after the route handler completes
- `afterPipeline` — fired after the handler and trace finalization (also fires when `onNotFound` / `onMethodNotAllowed` send a response)
- `onError` — fired on any unhandled error

`beforeHandler` / `afterHandler` wrap only the handler itself, independent from the pipeline. Use them for per-handler timing, logging, or auditing without interfering with middleware. They do not fire when the handler throws — use `onError` for that case.

Policies run in two phases. Existing policies default to `preValidation`, so authentication and other early checks keep their current behavior. A policy that depends on parsed input can use `phase: "postValidation"` and declare a non-empty `requires` list (`body`, `params`, `query`, or `headers`). It runs only after `onValidation`; Orvaxis rejects the request with a configuration error if `schemaValidationPlugin` is missing or the matched route does not define every required schema. Invalid input fails validation (422) before such a policy runs.

Policy decisions are added to `ctx.meta.trace.events` as `POLICY_DECISION` events. Each event reports the policy name, layer (`global`, `group`, or `route`), phase, order within that layer, priority, elapsed time, and outcome (`allow`, `deny`, `skipped`, or `error`). Denials and evaluation errors are terminal; later request stages do not run. The same events appear in `buildExecutionSummary().policyDecisions` and are forwarded to OpenTelemetry spans.

Collection defaults to a bounded summary of at most 100 decisions per request. `maxEvents` accepts 1–1000. Policy decision events do not copy request bodies, headers, cookies, identity values, free-form denial reasons, or exception messages. Names should be stable configuration labels, never values derived from a request. Configure collection on `Orvaxis`:

```ts
const app = new Orvaxis({
  policyTrace: { mode: "summary", maxEvents: 100 }, // default
  // policyTrace: { mode: "off" },
  // Detailed mode requires a redactor for free-form denial reasons.
  // policyTrace: { mode: "detailed", redact: (reason) => redact(reason) },
})
```

Detailed mode adds static scope descriptions and denial reasons only after the supplied redactor processes them. If redaction throws, the reason is omitted and request handling continues. When the event limit is reached, one `POLICY_TRACE_LIMIT` marker reports truncation. Choose `off` for requests where policy-trace collection is unnecessary.

`onNotFound` and `onMethodNotAllowed` can short-circuit the error path: if a listener sends a response (`ctx.res.sent === true`), the runtime skips the `HttpError` and returns normally without triggering `onError`. If no listener sends a response, the error is thrown as usual.

`afterPipeline` runs after successful runtime processing, including a handled 404/405 and middleware short-circuit. Errors before completion use `onError` and skip `afterPipeline`; if `afterPipeline` itself throws, `onError` runs afterward. The trace is finalized before either completion hook runs.

```ts
// custom 404 response
app.on("onNotFound", (ctx) => {
  ctx.res.status(404).json({ error: "Not Found", path: ctx.req.path })
})

// custom 405 response — ctx.meta.allowedMethods is already set
app.on("onMethodNotAllowed", (ctx) => {
  const allowed = ctx.meta.allowedMethods as string[]
  ctx.res.status(405).json({ error: "Method Not Allowed", allowed })
})

// redirect legacy URLs inside onNotFound
app.on("onNotFound", (ctx) => {
  if (ctx.req.path.startsWith("/old/")) {
    ctx.res.status(301).setHeader("Location", ctx.req.path.replace("/old/", "/api/")).end()
  }
})
```

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

// basic — status + message
throw new HttpError(404, "User not found")

// with a machine-readable code (forwarded to the client in the error envelope)
throw new HttpError(403, "Forbidden", { code: "FORBIDDEN" })

// with validation details
throw new HttpError(422, "Validation failed", {
  code: "VALIDATION_ERROR",
  details: [{ path: ["email"], message: "Invalid email" }],
})

// in onError — check the type before accessing .status / .code
app.on("onError", (ctx) => {
  if (ctx.error instanceof HttpError) {
    console.error(`[${ctx.error.status}] ${ctx.error.code ?? ""} ${ctx.error.message}`)
  }
})
```

`HttpError` extends the native `Error` class and also accepts a `cause` in the third argument (e.g. `{ cause: originalError }`) for error chaining.

---

### Plugins

Plugins extend runtime capabilities by registering hooks, middleware, or policies.

Orvaxis ships with two built-in plugins:

**`loggerPlugin`** — logs every request/response cycle and unhandled errors. It is a factory function that accepts an optional `{ logger, format }` argument:

```ts
import { Orvaxis, loggerPlugin } from "orvaxis"

// default: JSON format, uses console
const app = new Orvaxis()
app.register(loggerPlugin())

// custom logger (pino, winston, or any object satisfying Logger)
app.register(loggerPlugin({ logger: pinoInstance }))

// text format — human-readable plain strings, useful in development
app.register(loggerPlugin({ format: "text" }))
```

By default `format` is `"json"`, emitting one structured object per event — ready for Datadog, Elasticsearch, Loki, and similar aggregation stacks without a custom parser:

```
// onRequest
{ type: "request", method: "GET", path: "/api/users", requestId: "550e8400-…" }

// afterPipeline — includes status code and total duration
{ type: "response", method: "GET", path: "/api/users", status: 200, durationMs: 12, requestId: "550e8400-…" }

// onError
{ type: "error", requestId: "550e8400-…", message: "Not Found", error: Error }
```

With `format: "text"` the output is plain strings suitable for a terminal:

```
[REQ] GET /api/users 550e8400-…
[RES] GET /api/users 200 12ms 550e8400-…
[ERR] 550e8400-… Error: Not Found
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

**`schemaValidationPlugin`** — validates `body`, `params`, `query`, and `headers` against a `route.schema` after middleware and before post-validation policies and the handler. Any library whose objects expose a `.parse(data)` method works (Zod, TypeBox, custom validators):

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

On validation failure the plugin throws an error with `status: 422`, a `field` property indicating which part failed (`"body"`, `"params"`, `"query"`, or `"headers"`), and the original validator error as `cause`. When the validator error exposes an `.issues` array (Zod and any library following the same convention), the adapter error response includes a `details` field with `{ path, message }` pairs so clients receive actionable feedback:

```json
{
  "error": "Validation failed: body",
  "details": [
    { "path": ["name"], "message": "Required" },
    { "path": ["age"],  "message": "Expected number, received string" }
  ]
}
```

The plugin is opt-in. A plain `Route` with a `schema` field is ignored unless `schemaValidationPlugin` is registered. `defineRoute()` makes the dependency explicit: a request matching a route created with it fails with a configuration error if the plugin is missing. Post-validation policies also require this plugin plus matching route schemas.

**`corsPlugin`** — handles cross-origin requests for any adapter (Express, Fastify, or custom):

```ts
import { Orvaxis, corsPlugin } from "orvaxis"

const app = new Orvaxis()

// wildcard — open public API
app.register(corsPlugin())

// restricted to specific origins
app.register(corsPlugin({
  origin: ["https://app.example.com", "https://admin.example.com"],
  credentials: true,
  exposedHeaders: ["X-Request-ID"],
  maxAge: 3600,
}))
```

| Option | Type | Default | Description |
|---|---|---|---|
| `origin` | `string \| string[] \| RegExp` | `"*"` | Allowed origin(s) |
| `methods` | `string[]` | registered methods | `Access-Control-Allow-Methods` for preflight |
| `allowedHeaders` | `string[]` | mirrors request | `Access-Control-Allow-Headers` for preflight |
| `exposedHeaders` | `string[]` | — | `Access-Control-Expose-Headers` on all responses |
| `credentials` | `boolean` | `false` | `Access-Control-Allow-Credentials` |
| `maxAge` | `number` | — | `Access-Control-Max-Age` (seconds) for preflight cache |

`OPTIONS` preflight requests on known paths automatically receive a `204` response with all CORS headers populated, no route registration required. `OPTIONS` on an unknown path returns `404` as usual.

When `origin` is not `"*"` the plugin also sets `Vary: Origin` so CDNs cache responses per origin correctly.

**`otelPlugin`** — emits an OpenTelemetry `SERVER` span for every request. Requires `@opentelemetry/api` (optional peer dependency) and a pre-configured SDK with your chosen exporter (OTLP, Zipkin, Jaeger, etc.):

```ts
import { Orvaxis } from "orvaxis"
import { otelPlugin } from "orvaxis/otel"
import { trace } from "@opentelemetry/api"

// configure SDK + exporter once at startup (outside this file)

const app = new Orvaxis()
app.register(otelPlugin({ tracer: trace.getTracer("my-service") }))
```

Each matched request produces **three nested spans**:

| Span | Lifecycle window | What it covers |
|---|---|---|
| `GET /users/:id` (root) | `onRequest` → `afterPipeline` | full request duration |
| `orvaxis.pipeline` | `beforePipeline` → `beforeHandler` | global pipeline + group/route middleware + validation + post-validation policies |
| `orvaxis.handler` | `beforeHandler` → `afterHandler` | route handler only |

The root span attributes:

| Attribute | Value |
|---|---|
| `http.request.method` | `GET`, `POST`, … |
| `url.path` | request path |
| `orvaxis.request_id` | `ctx.req.id` |
| `http.response.status_code` | response status |

The root span name is initially set to the raw path (`GET /users/42`) and updated to the route template (`GET /users/:id`) before the handler runs, so parameterised routes group correctly in your trace backend.

Distributed trace context is extracted from incoming `traceparent` / `tracestate` headers so Orvaxis participates in upstream traces automatically. Both child spans are parented to the root span via the stored OTel context and appear correctly nested in Jaeger, Zipkin, and any W3C-compliant backend. `traceMiddleware` events are forwarded to the root span as OTel span events. On error the exception is recorded via `span.recordException`, any open child spans are closed first, and the root span is marked `ERROR`.

Requests that fail before routing (404, 405) produce only the root span — `orvaxis.pipeline` and `orvaxis.handler` are never opened.

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
- `startTime` / `endTime` — wall-clock boundaries in integer milliseconds (`Date.now()`); `endTime` marks completion of request processing before the completion hook runs
- `outcome` — `"success"` or `"error"`, including failures in policies, middleware, handlers, and hooks
- `responseSentAtRuntimeEnd` — whether the response API had been used when runtime execution completed
- `responseCompletedAtRuntimeEnd` — whether the adapter reported the underlying HTTP response stream finished at that moment; may be `undefined` for custom adapters

The runtime trace and the HTTP response have separate lifetimes. A handler can return after starting an SSE or other streamed response, so `outcome: "success"` and `responseSentAtRuntimeEnd: true` can coexist with `responseCompletedAtRuntimeEnd: false`. These response fields are a snapshot at the end of request processing; they do not update when the network stream later completes. Errors are finalized before `onError` runs, so error hooks, the logger plugin, and OpenTelemetry can inspect the trace. `afterPipeline` runs after successful request processing, including a short-circuit; failures use `onError` and do not also invoke `afterPipeline`.

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
app.debugger.enable()   // start collecting debug timeline
app.debugger.disable()  // stop collecting (e.g. after warm-up)
```

`enabled` is a read-only getter — direct assignment throws at runtime. Always use `enable()` / `disable()` to toggle the state.

Use `buildExecutionSummary(ctx)` to get a structured view of both the trace and the debug timeline:

```ts
import { buildExecutionSummary } from "orvaxis"

app.on("afterPipeline", (ctx) => {
  const summary = buildExecutionSummary(ctx)
  // summary.requestId      — from ctx.meta.trace
  // summary.duration       — total ms
  // summary.traceEvents    — all trace events, including custom and policy events
  // summary.policyDecisions — automatic policy outcomes in execution order
  // summary.stoppedByPolicy — the terminal deny/error decision, if any
  // summary.notReachedStages — later policy/request stages skipped after that decision
  // summary.debugSteps     — internal lifecycle events grouped by phase (requires debugger enabled)
  // summary.combinedTimeline — all events merged and sorted by timestamp, each with a `kind` field ("trace" | "debug")
  // summary.route          — matched route + group
})
```

`combinedTimeline` is the easiest way to understand the full sequence of what happened during a request — it interleaves your custom trace events with the internal lifecycle steps in chronological order. Each entry carries `{ kind, name, timestamp, meta }`.

`buildExecutionSummary` always returns an object — `traceEvents`, `combinedTimeline`, and `duration` are available even without the debugger enabled.

For a compact, copyable diagnostic, use `formatExecutionSummary(ctx)`. It prints the matched route template, outcome, policy decisions and stages skipped after a denial. It deliberately omits request values, denial reasons and error messages, so the output is safer to attach to a bug report. For example, the same runnable demo shows an allowed request, a 403 and a handler failure:

```sh
pnpm exec tsx examples/policy-diagnostics.ts
```

```ts
import { formatExecutionSummary } from "orvaxis"

app.on("afterPipeline", (ctx) => {
  console.log(formatExecutionSummary(ctx))
})
```

The formatter only reports decisions already captured in the trace; it does not evaluate policies again. If policy tracing is disabled, it reports that no decisions were recorded.

---

### Execution Model

A request lifecycle is deterministic:

```
1   onRequest hook
2   Route lookup
    ├─ no match → onNotFound hook → response sent: finish; otherwise: throw 404 → onError
    └─ method mismatch → onMethodNotAllowed hook → response sent: finish; otherwise: throw 405 → onError
3   Pre-validation policies  global → group → route; priority sorted within each layer
4   beforePipeline hook
5   Global pipeline       middleware registered via app.use()
6   Group middleware
7   Route middleware
8   onValidation hook     schemaValidationPlugin parses declared fields
9   Post-validation policies  global → group → route
10  beforeHandler hook
11  Route handler
12  afterHandler hook
13  Trace finalization    ctx.meta.trace is set before afterPipeline or onError
14  afterPipeline hook    successful processing and handled short-circuits only
    Debug output          lifecycle events are recorded if app.debugger.enable() was called
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

#### `ctx.logs` — request-scoped log accumulator

`ctx.logs` is a `string[]` that lives for the duration of a single request. Push any formatted message from hooks, middleware, or handlers and read it back at any later lifecycle point — useful for short per-request audit trails, debugging, or test assertions without a real logger:

```ts
app.on("onRequest", (ctx) => {
  ctx.logs.push(`[${ctx.req.method}] ${ctx.req.path}`)
})

app.on("afterPipeline", (ctx) => {
  if (ctx.logs.length > 0) console.log("[request log]", ctx.logs)
})
```

The array is initialised as `[]` by the framework. Nothing in the framework writes to it — it is entirely user-owned.

`ctx.logs` is capped at **1 000 entries** by default. Pushes beyond the cap are dropped and `console.warn` fires once per request context. For high-volume output use a dedicated logger instead. The cap is configurable via `OrvaxisOptions`:

```ts
// raise the cap
const app = new Orvaxis({ logsMaxSize: 5_000 })

// disable (set to Infinity — not recommended for long-lived SSE connections)
const app = new Orvaxis({ logsMaxSize: Infinity })
```

---

#### `defineRoute()` — types from parsed request schemas

On an ordinary `Route`, request fields remain broadly typed. `defineRoute()` infers each field from the validator's **output** type, so coercion and transforms are reflected in the handler's types for body, params, query, and headers:

```ts
import { defineRoute, schemaValidationPlugin } from "orvaxis"
import { z } from "zod"

const CreateItem = {
  body: z.object({ quantity: z.coerce.number() }),
  params: z.object({ id: z.coerce.number() }),
  query: z.object({ page: z.coerce.number().default(1) }),
  headers: z.object({ "x-user": z.string().transform((value) => value.length) }),
}

app.group({
  prefix: "/api",
  routes: [
    defineRoute({
      method: "POST",
      path: "/items/:id",
      schema: CreateItem,
      handler: async (ctx) => {
        const quantity: number = ctx.req.body.quantity
        const id: number = ctx.params.id
        const page: number = ctx.req.query.page
        const userHeaderLength: number = ctx.req.headers["x-user"]
        ctx.res.status(201).json({ id, quantity, page, userHeaderLength })
      },
    }),
  ],
})
```

Register `schemaValidationPlugin` for every `defineRoute()` route. The plugin parses each declared field before the handler; omitting it produces an HTTP 500 configuration error rather than calling a handler with unvalidated data. The legacy explicit body generic remains supported for existing code:

```ts
defineRoute<z.infer<typeof CreateItem.body>, AuthState>({ ... })
```

For schema inference together with custom `ctx.state` or `ctx.meta` types, provide the schema type as the first generic argument and the state type as the second, or annotate the route's handler context. For example, with the `CreateItem` schema above, use `defineRoute<typeof CreateItem, AuthState>({ schema: CreateItem, ... })`. The older `defineRoute<TBody, TState>()` body-only form remains supported for compatibility.

Run `pnpm exec tsx examples/typed-schema.ts` to see the transformed values produced by the same route at runtime.

#### Response contracts and OpenAPI

Routes may declare validators by response status. Register `responseValidationPlugin()` to validate values passed to `ctx.res.json()` or `ctx.res.send()`; the parsed value is sent, so validator transforms are preserved. The default `strict` mode turns invalid output into an HTTP 500 error. Use `mode: "warn"` to report safe route/status metadata and send the original value while migrating existing handlers.

```ts
import { responseValidationPlugin } from "orvaxis"

app.register(responseValidationPlugin({ mode: "strict" }))
app.group({
  prefix: "/api",
  routes: [{
    method: "GET",
    path: "/items/:id",
    schema: { params: z.object({ id: z.string() }) },
    responses: {
      200: z.object({ id: z.string(), name: z.string() }),
      404: z.object({ error: z.string() }),
    },
    handler: (ctx) => ctx.res.json({ id: ctx.params.id, name: "Example" }),
  }],
})
```

Response validation is opt-in and only covers JSON/body values sent through the Orvaxis response methods. It selects the schema using the final status code. Adapter-generated errors and failures that occur before the handler (for example, Express JSON parsing errors) are outside this plugin's boundary. Streaming routes are never buffered: in `strict` mode the first `write`, `pipe`, or chunked `end` fails if that status has a declared schema; in `warn` mode the plugin reports `stream-not-validated` and lets the stream pass through. Leave streaming response schemas undeclared.

OpenAPI generation is available from the optional `orvaxis/openapi` subpath and has no runtime dependency on a validator library. Supply a converter because `.parse()` alone does not expose a JSON Schema:

```ts
import { generateOpenApiDocument } from "orvaxis/openapi"
import { z } from "zod"

const document = generateOpenApiDocument(app, {
  title: "Example API",
  version: "1.0.0",
  schemaConverter: (validator) => z.toJSONSchema(validator as z.ZodType),
})
```

The generator emits OpenAPI 3.1 paths, JSON request bodies, query/header/path parameters, declared JSON responses, and a default Orvaxis error envelope. It reads route metadata only; it never executes handlers or policies. Unsupported or non-object converter output raises a `TypeError` naming the route and schema field instead of silently omitting the contract. OpenAPI cannot express the runtime's streaming validation restriction, so streaming endpoints should omit response schemas and document their media type separately.

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
