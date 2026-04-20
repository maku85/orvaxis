import { Orvaxis } from "../core/Orvaxis"
import { createExpressServer } from "../http/expressAdapter"

const app = new Orvaxis()

app.on("onRequest", (ctx) => {
  ctx.logs.push(`[${ctx.req.method}] ${ctx.req.path}`)
})

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/hello",
      handler: async (ctx) => {
        ctx.res.json({ message: "Hello from Orvaxis" })
      },
    },
    {
      method: "GET",
      path: "/status",
      handler: async (ctx) => {
        ctx.res.json({ status: "ok" })
      },
    },
  ],
})

const server = createExpressServer(app)
server.listen(3000)
