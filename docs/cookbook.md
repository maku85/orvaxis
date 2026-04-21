# Orvaxis Cookbook

Practical use cases with working code examples.

---

## 1. API with authentication (API key)

Authenticate every request globally before it reaches any handler.

```ts
import { Orvaxis, createExpressServer } from "orvaxis"
import type { Policy } from "orvaxis"

const requireApiKey: Policy = {
  name: "require-api-key",
  priority: 100,
  evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"]
    if (!key || typeof key !== "string")
      return { allow: false, reason: "Missing X-API-Key", status: 401 }
    return { allow: true, modify: { apiKey: key } }
  },
}

const app = new Orvaxis()
app.policy(requireApiKey)

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/me",
      handler: async (ctx) => {
        ctx.res.json({ apiKey: ctx.meta.apiKey })
      },
    },
  ],
})

createExpressServer(app).listen(3000)
```

**Notes:**
- `modify` injects data into `ctx.meta`, available to all downstream handlers.
- Global policies run before group and route policies, in priority order.
- To scope a policy to specific routes, use [`scope`](#policy-scoping).

---

## 2. Role-based access control

Separate authentication (who you are) from authorization (what you can do) using two policies.

```ts
import type { Policy } from "orvaxis"

const authenticate: Policy = {
  name: "authenticate",
  priority: 100,
  async evaluate(ctx) {
    const token = ctx.req.headers["authorization"]?.replace("Bearer ", "")
    if (!token) return { allow: false, reason: "Unauthenticated", status: 401 }

    // decode/verify your JWT here
    const user = verifyToken(token) // { id, role }
    return { allow: true, modify: { user } }
  },
}

const requireAdmin: Policy = {
  name: "require-admin",
  priority: 10,
  scope: { path: /^\/admin/ },
  async evaluate(ctx) {
    if (ctx.meta.user?.role !== "admin")
      return { allow: false, reason: "Forbidden", status: 403 }
    return { allow: true }
  },
}

app.policy(authenticate)
app.policy(requireAdmin)
```

**Notes:**
- `authenticate` runs first (higher priority) and populates `ctx.meta.user`.
- `requireAdmin` is scoped to `/admin/*` paths — other routes are unaffected.
- To use typed context, define `type AppMeta = { user: { id: string; role: string } }` and `OrvaxisContext<{}, AppMeta>`.

---

## 3. Policy scoping

Apply a policy only to specific paths or methods without modifying route definitions.

```ts
const rateLimitApi: Policy = {
  name: "rate-limit",
  priority: 50,
  scope: {
    path: /^\/api/,   // regex: matches any path starting with /api
    method: "POST",   // only POST requests
  },
  async evaluate(ctx) {
    const ip = String(ctx.req.headers["x-forwarded-for"] ?? "unknown")
    const allowed = await checkRateLimit(ip)
    if (!allowed) return { allow: false, reason: "Too many requests", status: 429 }
    return { allow: true }
  },
}
```

`scope.path` accepts:
- `string` — exact match only (e.g. `"/health"`)
- `RegExp` — pattern match (e.g. `/^\/api/` for all paths under `/api`)

`scope.method` is one of `GET | POST | PUT | DELETE | PATCH | HEAD | OPTIONS`.

---

## 4. Feature flags

Gate access to experimental features with zero changes to route handlers.

```ts
const betaAccess: Policy = {
  name: "beta-access",
  priority: 20,
  scope: { path: /^\/beta/ },
  async evaluate(ctx) {
    const userId = ctx.meta.user?.id
    const enabled = await isFeatureEnabled("beta", userId)
    if (!enabled) return { allow: false, reason: "Feature not available", status: 404 }
    return { allow: true, modify: { beta: true } }
  },
}
```

Handlers under `/beta/*` receive `ctx.meta.beta === true` and can branch accordingly. All other routes are unaffected.

---

## 5. Request tracing and observability

Every request automatically produces a structured trace. Use `traceMiddleware` and `traceEvent` to enrich it.

```ts
import { Orvaxis, traceMiddleware, traceEvent, buildExecutionSummary, createExpressServer } from "orvaxis"

const app = new Orvaxis()
app.debugger.enable() // optional: adds internal lifecycle events

app.on("afterPipeline", (ctx) => {
  const summary = buildExecutionSummary(ctx)
  console.log({
    requestId: summary.requestId,
    route: summary.route,
    duration: `${summary.duration}ms`,
    events: summary.traceEvents,
  })
})

app.group({
  prefix: "/api",
  middleware: [traceMiddleware()], // records timing for each middleware
  routes: [
    {
      method: "GET",
      path: "/users",
      handler: async (ctx) => {
        traceEvent("db:query", { table: "users" }) // emit custom event from anywhere in the call chain
        ctx.res.json({ users: [] })
      },
    },
  ],
})

createExpressServer(app).listen(3000)
```

`buildExecutionSummary` returns:

| Field | Description |
|-------|-------------|
| `requestId` | Unique ID per request |
| `duration` | Total ms from start to `afterPipeline` |
| `traceEvents` | Custom + middleware timing events |
| `debugSteps` | Internal lifecycle steps (requires `debugger.enable()`) |
| `route` | Matched route and group |

`traceEvent` is a no-op outside a request scope — safe to call from shared service functions.

---

## 6. Audit logging

Log every request with timing, status, and error info using lifecycle hooks.

```ts
import { Orvaxis, createExpressServer } from "orvaxis"

const app = new Orvaxis()

app.on("onRequest", (ctx) => {
  ctx.meta.startedAt = Date.now()
})

app.on("afterPipeline", (ctx) => {
  const ms = Date.now() - (ctx.meta.startedAt as number)
  console.log(`[OK]  ${ctx.req.method} ${ctx.req.path} ${ms}ms — ${ctx.meta.trace?.requestId}`)
})

app.on("onError", (ctx, err) => {
  const ms = Date.now() - (ctx.meta.startedAt as number ?? 0)
  const status = (err as { status?: number }).status ?? 500
  console.error(`[ERR] ${ctx.req.method} ${ctx.req.path} ${status} ${ms}ms — ${err?.message}`)
})
```

**Limitation:** the runtime does not track HTTP response status codes for successful responses, because `OrvaxisResponse` is framework-agnostic and opaque. If you need response status logging, set it explicitly in handlers: `ctx.meta.status = 201` and read it in `afterPipeline`.

---

## 7. Group-level middleware (body parsing, correlation IDs)

Apply shared middleware to an entire group of routes.

```ts
import { createExpressServer } from "orvaxis"
import express from "express"
import type { Middleware } from "orvaxis"

// Assign a correlation ID to every request
const correlationId: Middleware = async (ctx, next) => {
  ctx.meta.correlationId = ctx.req.headers["x-correlation-id"] ?? crypto.randomUUID()
  await next()
}

app.group({
  prefix: "/api",
  middleware: [correlationId],
  routes: [...],
})
```

**Body parsing with Express:** since `createExpressServer` accepts an existing Express app, you can add framework-level middleware before Orvaxis takes over:

```ts
import express from "express"
import { Orvaxis, createExpressServer } from "orvaxis"

const expressApp = express()
expressApp.use(express.json())           // parse JSON bodies
expressApp.use(express.urlencoded({ extended: true })) // parse form bodies

const app = new Orvaxis()
// ... define groups and routes ...

createExpressServer(app, expressApp).listen(3000)
// Body is now accessible as ctx.req.body inside handlers
```

Same pattern for Fastify plugins:

```ts
import Fastify from "fastify"
import multipart from "@fastify/multipart"
import { Orvaxis, createFastifyServer } from "orvaxis"

const fastifyApp = Fastify()
await fastifyApp.register(multipart)

const app = new Orvaxis()
createFastifyServer(app, fastifyApp).listen(3000)
```

---

## 8. Health checks without policies

Use prefix `"/"` for a root-level group. Useful for health and readiness endpoints that must bypass authentication.

```ts
// Register the health group BEFORE adding global policies
const app = new Orvaxis()

app.group({
  prefix: "/",
  routes: [
    {
      method: "GET",
      path: "/health",
      handler: async (ctx) => {
        ctx.res.json({ status: "ok" })
      },
    },
  ],
})

// Global policies added after — they still apply to all other groups
app.policy(requireApiKey)
app.group({ prefix: "/api", routes: [...] })
```

> Global policies apply to **all** routes regardless of registration order. To exclude specific routes from a global policy, use `scope` on the policy.

---

## 9. Custom plugin

Encapsulate cross-cutting behavior (logging, metrics, tracing) into a reusable plugin.

```ts
import type { Plugin } from "orvaxis"

export const metricsPlugin: Plugin = {
  name: "metrics",
  apply(runtime) {
    runtime.hooks.on("onRequest", (ctx) => {
      ctx.meta.startedAt = Date.now()
    })

    runtime.hooks.on("afterPipeline", (ctx) => {
      const ms = Date.now() - (ctx.meta.startedAt as number)
      recordMetric(ctx.req.path, ctx.req.method, ms)
    })

    runtime.hooks.on("onError", (_ctx, err) => {
      recordError(err?.message ?? "unknown")
    })
  },
}

// Usage
app.register(metricsPlugin)
```

---

## 10. Typed context

Add compile-time types to `ctx.state` and `ctx.meta` for full IDE support.

```ts
import type { OrvaxisContext } from "orvaxis"

type AppState = {
  user: { id: string; role: "admin" | "user" }
}

type AppMeta = {
  apiKey: string
  correlationId: string
}

type AppContext = OrvaxisContext<AppState, AppMeta>

const handler = async (ctx: AppContext) => {
  ctx.state.user.role    // "admin" | "user"
  ctx.meta.apiKey        // string
  ctx.meta.correlationId // string
  ctx.meta.trace         // TracerLike — still available from ContextMeta
}
```

Use `getContext()` to access the typed context from anywhere in the async call chain:

```ts
import { getContext } from "orvaxis"

async function getCurrentUser() {
  const ctx = getContext() as AppContext | undefined
  return ctx?.state.user
}
```

---

## Known limitations

| Area | Detail |
|------|--------|
| **Response status** | The runtime does not track HTTP response status codes. Set `ctx.meta.status` manually in handlers if you need it in hooks. |
| **Body parsing** | No built-in body parsing. Use `createExpressServer(app, expressApp)` with `express.json()` pre-registered (see [use case 7](#7-group-level-middleware-body-parsing-correlation-ids)). |
| **Rate limiting** | No built-in counter/storage. Implement using any in-memory map or Redis client inside a policy. |
| **Policy scope `path: string`** | Exact match only. Use a `RegExp` (e.g. `/^\/admin/`) to match subtree paths. |
| **Response interception** | Handlers write directly to the framework response (`ctx.res.json()`, `ctx.res.send()`). Orvaxis does not intercept or transform responses. |
