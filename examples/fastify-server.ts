import { Orvaxis } from "../core/Orvaxis"
import { createFastifyServer } from "../http/fastifyAdapter"
import type { Policy } from "../types"

const app = new Orvaxis()

const requireApiKey: Policy = {
  name: "require-api-key",
  priority: 100,
  evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"]
    if (!key) return { allow: false, reason: "Missing X-API-Key header" }
    return { allow: true, modify: { apiKey: key } }
  },
}

app.policy(requireApiKey)

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/users",
      handler: async (ctx) => {
        ctx.res.send({ users: ["alice", "bob"] })
      },
    },
    {
      method: "GET",
      path: "/users/:id",
      handler: async (ctx) => {
        ctx.res.send({ id: ctx.meta.route?.params.id })
      },
    },
  ],
})

const server = createFastifyServer(app)
server.listen(3004).catch(console.error)
