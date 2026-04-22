# Why Orvaxis

A concrete comparison between a typical Express app and the same app built with Orvaxis.

---

## The scenario

An API with three requirements that show up in almost every real backend:

1. **Authentication** — every request must carry a valid Bearer token
2. **Rate limiting** — cap requests per client to 100/min
3. **Observability** — log method, path, status, and duration for every request

---

## Express — the natural approach

This is how most Express apps grow organically. Each concern gets added as it's needed.

```ts
import express from "express"

const app = express()
const requestCounts = new Map<string, { count: number; reset: number }>()

// authentication middleware
app.use((req, res, next) => {
  const token = req.headers["authorization"]?.replace("Bearer ", "")
  if (!token) return res.status(401).json({ error: "Unauthenticated" })

  try {
    const user = verifyToken(token) // throws if invalid
    ;(req as any).user = user
    next()
  } catch {
    res.status(401).json({ error: "Invalid token" })
  }
})

// rate limiting middleware
app.use((req, res, next) => {
  const key = (req as any).user?.id ?? req.ip
  const now = Date.now()
  const entry = requestCounts.get(key)

  if (!entry || entry.reset < now) {
    requestCounts.set(key, { count: 1, reset: now + 60_000 })
    return next()
  }

  if (entry.count >= 100) {
    return res.status(429).json({ error: "Rate limit exceeded" })
  }

  entry.count++
  next()
})

// observability: start timer before route
app.use((req, res, next) => {
  const start = Date.now()
  res.on("finish", () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`)
  })
  next()
})

app.get("/api/me", (req, res) => {
  res.json({ user: (req as any).user })
})

app.get("/api/items", (req, res) => {
  res.json({ items: [] })
})

app.listen(3000)
```

This works. The problems surface as the app grows:

- **Order is implicit.** Auth, rate limiting, and logging run in the order they were registered. There's nothing in the code that makes this order visible or enforced — a future developer adding a middleware in the wrong place silently changes behavior.
- **Decisions are tangled with implementation.** The auth middleware both decides whether to allow the request *and* mutates `req` to carry the user. The rate limiter both decides *and* increments the counter. There's no place to look at "what rules govern this request" independently of "how those rules work."
- **Observability is a side effect.** The logging middleware hooks into `res.on("finish")`, a low-level mechanism that's easy to miss and hard to extend. Adding structured tracing (duration by layer, not just total) requires significant rework.
- **Error handling diverges.** The auth middleware calls `res.status(401).json(...)` directly. The rate limiter does the same. If you want to add a consistent error response shape, you need to touch every middleware.

---

## Orvaxis — the same scenario

```ts
import { Orvaxis, createExpressServer } from "orvaxis"
import type { Policy } from "orvaxis"

// ── policies: declare what is allowed ─────────────────────────────────────────

const authenticate: Policy = {
  name: "authenticate",
  priority: 100,
  evaluate(ctx) {
    const token = ctx.req.headers["authorization"]?.replace("Bearer ", "")
    if (!token) return { allow: false, reason: "Unauthenticated", status: 401 }

    try {
      const user = verifyToken(token)
      return { allow: true, modify: { user } }
    } catch {
      return { allow: false, reason: "Invalid token", status: 401 }
    }
  },
}

const requestCounts = new Map<string, { count: number; reset: number }>()

const rateLimit: Policy = {
  name: "rate-limit",
  priority: 90,
  evaluate(ctx) {
    const key = (ctx.meta.user as any)?.id ?? ctx.req.headers["x-forwarded-for"] ?? "unknown"
    const now = Date.now()
    const entry = requestCounts.get(key as string)

    if (!entry || entry.reset < now) {
      requestCounts.set(key as string, { count: 1, reset: now + 60_000 })
      return { allow: true }
    }
    if (entry.count >= 100) return { allow: false, reason: "Rate limit exceeded", status: 429 }

    entry.count++
    return { allow: true }
  },
}

// ── app ───────────────────────────────────────────────────────────────────────

const app = new Orvaxis()

app.policy(authenticate)
app.policy(rateLimit)

// observability: every request produces a structured trace automatically.
// log the summary after the pipeline completes.
app.on("afterPipeline", (ctx) => {
  const trace = ctx.meta.trace
  if (!trace) return
  const duration = (trace.endTime ?? Date.now()) - trace.startTime
  console.log(`${ctx.req.method} ${ctx.req.path} ${ctx.res.statusCode} ${duration}ms`)
})

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/me",
      handler: async (ctx) => ctx.res.json({ user: ctx.meta.user }),
    },
    {
      method: "GET",
      path: "/items",
      handler: async (ctx) => ctx.res.json({ items: [] }),
    },
  ],
})

createExpressServer(app).listen(3000)
```

---

## What changed

**Execution order is explicit and enforced.**
Policies always run before hooks, hooks before middleware, middleware before the handler. That order is guaranteed by the runtime — not by the sequence of `app.use()` calls. Adding a new policy or middleware cannot accidentally change when auth or rate limiting runs.

**Decisions are separate from implementation.**
The `authenticate` policy returns `{ allow: true, modify: { user } }` or `{ allow: false, ... }`. It doesn't write to `req`, doesn't call `res.json()`, and doesn't call `next()`. The policy is a pure decision — testable in isolation with a single function call, no mock `req`/`res` objects needed.

**Observability is structural, not bolted on.**
Every request automatically produces a `Trace` with a timeline of events, start time, and end time. The `afterPipeline` hook reads from `ctx.meta.trace`, which is always populated. Adding per-layer timing, span IDs, or OpenTelemetry export is a matter of reading what's already there.

**Error handling is centralized.**
When a policy returns `{ allow: false, status: 401 }`, the runtime throws a typed error and routes it through the `onError` hook. One place handles all rejections — consistent shape, consistent logging, no duplication across middleware.

---

## When Orvaxis is not the right fit

- **Simple APIs with few rules.** If your app has 3–5 routes and a single auth check, the overhead of explicit layers adds structure without solving a real problem. Plain Express middleware is fine.
- **You need framework-specific features.** Orvaxis sits on top of Express or Fastify and delegates transport to them. If you rely heavily on framework-specific APIs (e.g., Fastify schemas, Express template engines), you're working around the abstraction.
- **Pre-1.0 stability is a concern.** The API may change before 1.0. Pin the version and review the changelog before upgrading.
