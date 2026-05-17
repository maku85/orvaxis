import { Orvaxis } from "../core/Orvaxis"
import { createExpressServer } from "../http/expressAdapter"

const app = new Orvaxis()

app.group({
  prefix: "/",
  routes: [
    // Named wildcard: captures the full sub-path as `filepath`.
    // GET /files/docs/readme.md → filepath = "docs/readme.md"
    // GET /files/img/logo.png   → filepath = "img/logo.png"
    {
      method: "GET",
      path: "/files/*filepath",
      handler: async (ctx) => {
        // biome-ignore lint/style/noNonNullAssertion: route is always defined inside a route handler
        const { filepath } = ctx.meta.route!.params
        // In a real app you would resolve and stream the file from disk.
        ctx.res.json({ filepath })
      },
    },

    // More specific static routes registered under the same prefix
    // still win over the wildcard thanks to the static > param > wildcard priority.
    // GET /api/status → handled here, never falls through to the catch-all below.
    {
      method: "GET",
      path: "/api/status",
      handler: async (ctx) => {
        ctx.res.json({ status: "ok" })
      },
    },

    // Unnamed catch-all: matches any GET path not handled above.
    // The matched portion is available as params["*"].
    // GET /anything/at/all → params["*"] = "anything/at/all"
    {
      method: "GET",
      path: "/*",
      handler: async (ctx) => {
        ctx.res.status(404).json({ error: "Not Found", path: ctx.req.path })
      },
    },
  ],
})

const server = createExpressServer(app)
server.listen(3005).catch(console.error)
