import { Orvaxis } from "../core/Orvaxis"
import { createExpressServer } from "../http/expressAdapter"
import type { Policy } from "../types"

const requireApiKey: Policy = {
  name: "require-api-key",
  priority: 100,
  evaluate(ctx) {
    const key = (ctx.req as any).headers["x-api-key"]
    if (!key) return { allow: false, reason: "Missing X-API-Key header" }
    return { allow: true, modify: { apiKey: key } }
  },
}

const adminOnly: Policy = {
  name: "admin-only",
  priority: 50,
  evaluate(ctx) {
    if (ctx.meta.apiKey !== "admin-secret") {
      return { allow: false, reason: "Admin access required" }
    }
    return { allow: true }
  },
}

const app = new Orvaxis()

app.policy(requireApiKey)

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/hello",
      handler: async (ctx) => {
        ctx.res.json({ message: "Hello, authenticated user" })
      },
    },
    {
      method: "GET",
      path: "/admin",
      policies: [adminOnly],
      handler: async (ctx) => {
        ctx.res.json({ message: "Welcome to the admin area" })
      },
    },
  ],
})

const server = createExpressServer(app)
server.listen(3001)

// GET /api/hello              → 403 Missing X-API-Key header
// GET /api/hello (with key)   → 200
// GET /api/admin (non-admin)  → 403 Admin access required
// GET /api/admin (admin key)  → 200
