import { basename } from "node:path"
import { createExpressServer } from "../express"
import { getContext, Orvaxis, traceEvent } from "../index"
import type { OrvaxisContext, Policy } from "../types"

// --- Typed context definition ---

// #region types
type AppState = {
  user: { id: string; role: "admin" | "user" }
}

type AppMeta = {
  apiKey: string
}

type AppContext = OrvaxisContext<AppState, AppMeta>
// #endregion

// --- Service layer (no ctx parameter needed) ---

// #region service
async function getCurrentUserId(): Promise<string | undefined> {
  const ctx = getContext() as AppContext | undefined
  return ctx?.state.user?.id
}

async function logQuery(table: string) {
  // traceEvent picks up the current request context automatically
  traceEvent("db:query", { table })
}
// #endregion

// --- Policies ---

const requireApiKey: Policy = {
  name: "require-api-key",
  priority: 100,
  evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"]
    if (!key || typeof key !== "string") {
      return { allow: false, reason: "Missing X-API-Key header", status: 401 }
    }
    return { allow: true, modify: { apiKey: key } }
  },
}

// --- App ---

export const app = new Orvaxis()

app.policy(requireApiKey)

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/me",
      handler: async (ctx: AppContext) => {
        // ctx.state and ctx.meta are fully typed
        ctx.state.user = { id: "u-1", role: "user" }

        const id = await getCurrentUserId() // uses getContext() internally
        await logQuery("users") // emits trace event without ctx

        ctx.res.json({ id, apiKey: ctx.meta.apiKey })
      },
    },
    {
      method: "GET",
      path: "/admin",
      handler: async (ctx: AppContext) => {
        ctx.state.user = { id: "u-2", role: "admin" }

        if (ctx.state.user.role !== "admin") {
          ctx.res.status(403).json({ error: "Forbidden" })
          return
        }

        ctx.res.json({ message: "Welcome, admin" })
      },
    },
  ],
})

if (basename(process.argv[1] ?? "") === "typed-context.ts") {
  createExpressServer(app).listen(3004).catch(console.error)
}

// GET /api/me  (no key)    → 401 Missing X-API-Key header
// GET /api/me  (with key)  → 200 { id: "u-1", apiKey: "..." }
// GET /api/admin (with key) → 200 { message: "Welcome, admin" }
