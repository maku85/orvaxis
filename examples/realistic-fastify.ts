/**
 * Realistic example — Fastify adapter
 *
 * A task management REST API demonstrating:
 *   - API key authentication (global policy, priority 100)
 *   - Per-key rate limiting (global policy, priority 90)
 *   - Role-based access control (admin group policy)
 *   - Schema validation with Zod (body + params)
 *   - Request tracing via traceMiddleware
 *   - Structured logging via loggerPlugin
 *   - Service functions using getContext() — no ctx threading
 *   - SSE live-update stream using ctx.res.write / ctx.res.end
 *   - Observability via buildExecutionSummary on afterPipeline
 *
 * Usage:
 *   npx tsx examples/realistic-fastify.ts
 *
 *   export API_KEY=key-alice          # role: user
 *   export API_KEY=key-admin          # role: admin
 *
 *   curl -H "x-api-key: $API_KEY" http://localhost:3001/api/v1/tasks
 */

import { randomUUID } from "node:crypto"
import { z } from "zod"
import { getContext } from "../core/contextStore"
import { HttpError } from "../core/HttpError"
import { Orvaxis } from "../core/Orvaxis"
import { buildExecutionSummary } from "../debug/buildExecutionSummary"
import { createFastifyServer } from "../http/fastifyAdapter"
import { traceMiddleware } from "../middleware/traceMiddleware"
import { loggerPlugin } from "../plugins/loggerPlugin"
import { schemaValidationPlugin } from "../plugins/schemaValidationPlugin"
import type { OrvaxisContext, Policy } from "../types"

// ── Domain types ─────────────────────────────────────────────────────────────

type Task = { id: string; title: string; done: boolean; ownerId: string; createdAt: number }
type AuthMeta = { userId: string; role: "user" | "admin" }
type AppCtx = OrvaxisContext<Record<string, unknown>, AuthMeta>

// ── In-memory store ───────────────────────────────────────────────────────────

const tasks = new Map<string, Task>()
const rateStore = new Map<string, { count: number; resetAt: number }>()

// ── Identities ────────────────────────────────────────────────────────────────

const IDENTITIES: Record<string, AuthMeta> = {
  "key-alice": { userId: "alice", role: "user" },
  "key-bob": { userId: "bob", role: "user" },
  "key-admin": { userId: "root", role: "admin" },
}

// ── Policies ──────────────────────────────────────────────────────────────────

const requireApiKey: Policy = {
  name: "require-api-key",
  priority: 100,
  evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"] as string
    const identity = IDENTITIES[key]
    if (!identity) return { allow: false, reason: "Invalid or missing X-API-Key", status: 401 }
    return { allow: true, modify: identity }
  },
}

const rateLimit: Policy = {
  name: "rate-limit",
  priority: 90,
  evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"] as string
    const now = Date.now()
    const entry = rateStore.get(key) ?? { count: 0, resetAt: now + 60_000 }
    if (now > entry.resetAt) {
      entry.count = 0
      entry.resetAt = now + 60_000
    }
    entry.count++
    rateStore.set(key, entry)
    if (entry.count > 60)
      return { allow: false, reason: "Rate limit exceeded (60 req/min)", status: 429 }
    return { allow: true }
  },
}

const requireAdmin: Policy = {
  name: "require-admin",
  evaluate(ctx) {
    if ((ctx.meta as unknown as AuthMeta).role !== "admin")
      return { allow: false, reason: "Admin access required", status: 403 }
    return { allow: true }
  },
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CreateTaskBody = z.object({ title: z.string().min(1).max(200) })
const UpdateTaskBody = z.object({
  title: z.string().min(1).max(200).optional(),
  done: z.boolean().optional(),
})
const TaskParams = z.object({ id: z.string().uuid() })

// ── Service helpers (use getContext — no ctx argument needed) ──────────────────

function authMeta(): AuthMeta {
  return (getContext()?.meta as unknown as AuthMeta) ?? { userId: "", role: "user" }
}

function requireTask(id: string): Task {
  const task = tasks.get(id)
  if (!task) throw new HttpError(404, "Task not found")
  const { userId, role } = authMeta()
  if (role !== "admin" && task.ownerId !== userId) throw new HttpError(403, "Access denied")
  return task
}

// ── SSE subscribers ───────────────────────────────────────────────────────────

type SseWriter = (event: string, data: unknown) => void
const subscribers = new Set<SseWriter>()

function broadcast(event: string, data: unknown) {
  for (const send of subscribers) {
    try {
      send(event, data)
    } catch {
      subscribers.delete(send)
    }
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Orvaxis()

app.register(loggerPlugin())
app.register(schemaValidationPlugin)

app.policy(requireApiKey)
app.policy(rateLimit)

app.on("afterPipeline", (ctx) => {
  const s = buildExecutionSummary(ctx)
  if (s.duration > 200) {
    console.warn(`[slow] ${ctx.req.method} ${ctx.req.path} — ${s.duration.toFixed(1)} ms`)
  }
})

app.on("onError", (ctx) => {
  const err = ctx.error as Error & { status?: number }
  if (!err.status || err.status >= 500) {
    console.error(`[error] ${ctx.req.id} ${err.message}`)
  }
})

// ── /api/v1/tasks ─────────────────────────────────────────────────────────────

app.group({
  prefix: "/api/v1/tasks",
  middleware: [traceMiddleware()],
  routes: [
    {
      method: "GET",
      path: "/events",
      handler: async (ctx) => {
        ctx.res
          .setHeader("Content-Type", "text/event-stream")
          .setHeader("Cache-Control", "no-cache")
          .setHeader("Connection", "keep-alive")

        const send: SseWriter = (event, data) =>
          ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

        subscribers.add(send)
        ctx.res.write(": connected\n\n")

        ctx.req.signal?.addEventListener("abort", () => {
          subscribers.delete(send)
          ctx.res.end()
        })
      },
    },
    {
      method: "GET",
      path: "",
      handler: async (ctx: AppCtx) => {
        const list = [...tasks.values()].filter((t) =>
          ctx.meta.role === "admin" ? true : t.ownerId === ctx.meta.userId
        )
        ctx.res.json(list)
      },
    },
    {
      method: "POST",
      path: "",
      schema: { body: CreateTaskBody },
      handler: async (ctx: AppCtx) => {
        const body = ctx.req.body as z.infer<typeof CreateTaskBody>
        const task: Task = {
          id: randomUUID(),
          title: body.title,
          done: false,
          ownerId: ctx.meta.userId,
          createdAt: Date.now(),
        }
        tasks.set(task.id, task)
        broadcast("task:created", task)
        ctx.res.status(201).json(task)
      },
    },
    {
      method: "GET",
      path: "/:id",
      schema: { params: TaskParams },
      handler: async (ctx) => {
        // biome-ignore lint/style/noNonNullAssertion: route is always defined inside a route handler
        ctx.res.json(requireTask(ctx.meta.route!.params.id))
      },
    },
    {
      method: "PATCH",
      path: "/:id",
      schema: { body: UpdateTaskBody, params: TaskParams },
      handler: async (ctx) => {
        // biome-ignore lint/style/noNonNullAssertion: route is always defined inside a route handler
        const task = requireTask(ctx.meta.route!.params.id)
        const patch = ctx.req.body as z.infer<typeof UpdateTaskBody>
        if (patch.title !== undefined) task.title = patch.title
        if (patch.done !== undefined) task.done = patch.done
        broadcast("task:updated", task)
        ctx.res.json(task)
      },
    },
    {
      method: "DELETE",
      path: "/:id",
      schema: { params: TaskParams },
      handler: async (ctx) => {
        // biome-ignore lint/style/noNonNullAssertion: route is always defined inside a route handler
        const { id } = ctx.meta.route!.params
        requireTask(id)
        tasks.delete(id)
        broadcast("task:deleted", { id })
        ctx.res.status(204).end()
      },
    },
  ],
})

// ── /api/v1/admin ─────────────────────────────────────────────────────────────

app.group({
  prefix: "/api/v1/admin",
  middleware: [traceMiddleware()],
  policies: [requireAdmin],
  routes: [
    {
      method: "GET",
      path: "/tasks",
      handler: async (ctx) => {
        const { userId, done } = ctx.req.query ?? {}
        const list = [...tasks.values()].filter((t) => {
          if (userId && t.ownerId !== userId) return false
          if (done !== undefined && String(t.done) !== done) return false
          return true
        })
        ctx.res.json(list)
      },
    },
    {
      method: "DELETE",
      path: "/tasks/:id",
      schema: { params: TaskParams },
      handler: async (ctx) => {
        // biome-ignore lint/style/noNonNullAssertion: route is always defined inside a route handler
        const { id } = ctx.meta.route!.params
        if (!tasks.has(id)) throw new HttpError(404, "Task not found")
        tasks.delete(id)
        broadcast("task:deleted", { id })
        ctx.res.status(204).end()
      },
    },
    {
      method: "GET",
      path: "/stats",
      handler: async (ctx) => {
        const all = [...tasks.values()]
        ctx.res.json({
          totalTasks: all.length,
          doneTasks: all.filter((t) => t.done).length,
          activeSseClients: subscribers.size,
          rateLimitEntries: rateStore.size,
        })
      },
    },
  ],
})

// ── Start ─────────────────────────────────────────────────────────────────────

// timeout: 0 — required for the SSE /events endpoint (long-lived connection)
const server = createFastifyServer(app, undefined, { timeout: 0 })
server.listen(3001, (port) => console.log(`[orvaxis] listening on http://localhost:${port}`))
