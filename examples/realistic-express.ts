/**
 * Realistic example — Express adapter
 *
 * A task management REST API demonstrating:
 *   - API key authentication (global policy, priority 100)
 *   - Per-key rate limiting (global policy, priority 90)
 *   - Role-based access control (admin group policy)
 *   - Schema validation with Zod (body + params)
 *   - Type-safe body via defineRoute<TBody>() — no cast needed
 *   - ctx.params shortcut — no ctx.meta.route!.params
 *   - Type-safe auth state via ctx.state — no double-cast
 *   - Request tracing via traceMiddleware
 *   - Structured logging via loggerPlugin
 *   - Service functions using getContext() — no ctx threading
 *   - SSE live-update stream (timeout auto-cancelled on first write)
 *   - Observability via buildExecutionSummary on afterPipeline
 *
 * Usage:
 *   npx tsx examples/realistic-express.ts
 *
 *   export API_KEY=key-alice          # role: user
 *   export API_KEY=key-admin          # role: admin
 *
 *   curl -H "x-api-key: $API_KEY" http://localhost:3000/api/v1/tasks
 */

import { randomUUID } from "node:crypto"
import { z } from "zod"
import { getContext } from "../core/contextStore"
import { defineRoute } from "../core/defineRoute"
import { HttpError } from "../core/HttpError"
import { Orvaxis } from "../core/Orvaxis"
import { buildExecutionSummary } from "../debug/buildExecutionSummary"
import { createExpressServer } from "../http/expressAdapter"
import { traceMiddleware } from "../middleware/traceMiddleware"
import { loggerPlugin } from "../plugins/loggerPlugin"
import { schemaValidationPlugin } from "../plugins/schemaValidationPlugin"
import type { OrvaxisContext, Policy } from "../types"

// ── Domain types ────────────────────────────────────────────────────────────

type Task = { id: string; title: string; done: boolean; ownerId: string; createdAt: number }
type AuthState = { userId: string; role: "user" | "admin" }
type AppCtx = OrvaxisContext<AuthState>

// ── In-memory store ──────────────────────────────────────────────────────────

const tasks = new Map<string, Task>()
const rateStore = new Map<string, { count: number; resetAt: number }>()

// ── Identities ───────────────────────────────────────────────────────────────

const IDENTITIES: Record<string, AuthState> = {
  "key-alice": { userId: "alice", role: "user" },
  "key-bob": { userId: "bob", role: "user" },
  "key-admin": { userId: "root", role: "admin" },
}

// ── Policies ─────────────────────────────────────────────────────────────────

const requireApiKey: Policy<AuthState> = {
  name: "require-api-key",
  priority: 100,
  evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"] as string
    const identity = IDENTITIES[key]
    if (!identity) return { allow: false, reason: "Invalid or missing X-API-Key", status: 401 }
    ctx.state = identity
    return { allow: true }
  },
}

const rateLimit: Policy<AuthState> = {
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

const requireAdmin: Policy<AuthState> = {
  name: "require-admin",
  evaluate(ctx) {
    if (ctx.state.role !== "admin")
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

// ── Service helpers (use getContext — no ctx argument needed) ─────────────────

function authState(): AuthState {
  return (getContext()?.state as AuthState) ?? { userId: "", role: "user" }
}

function requireTask(id: string): Task {
  const task = tasks.get(id)
  if (!task) throw new HttpError(404, "Task not found")
  const { userId, role } = authState()
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
          ctx.state.role === "admin" ? true : t.ownerId === ctx.state.userId
        )
        ctx.res.json(list)
      },
    },
    defineRoute<z.infer<typeof CreateTaskBody>, AuthState>({
      method: "POST",
      path: "",
      schema: { body: CreateTaskBody },
      handler: async (ctx) => {
        const task: Task = {
          id: randomUUID(),
          title: ctx.req.body.title,
          done: false,
          ownerId: ctx.state.userId,
          createdAt: Date.now(),
        }
        tasks.set(task.id, task)
        broadcast("task:created", task)
        ctx.res.status(201).json(task)
      },
    }),
    {
      method: "GET",
      path: "/:id",
      schema: { params: TaskParams },
      handler: async (ctx) => {
        ctx.res.json(requireTask(ctx.params.id))
      },
    },
    defineRoute<z.infer<typeof UpdateTaskBody>, AuthState>({
      method: "PATCH",
      path: "/:id",
      schema: { body: UpdateTaskBody, params: TaskParams },
      handler: async (ctx) => {
        const task = requireTask(ctx.params.id)
        const patch = ctx.req.body
        if (patch.title !== undefined) task.title = patch.title
        if (patch.done !== undefined) task.done = patch.done
        broadcast("task:updated", task)
        ctx.res.json(task)
      },
    }),
    {
      method: "DELETE",
      path: "/:id",
      schema: { params: TaskParams },
      handler: async (ctx) => {
        const { id } = ctx.params
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
        const { id } = ctx.params
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

const server = createExpressServer(app)
server.listen(3000, (port) => console.log(`[orvaxis] listening on http://localhost:${port}`))
