import { Orvaxis } from "../core/Orvaxis"
import { createExpressServer } from "../http/expressAdapter"

const app = new Orvaxis()

// ctx.logs is a per-request string accumulator capped at 1 000 entries (configurable
// via new Orvaxis({ logsMaxSize: N })). Designed for short debug trails — use a
// dedicated logger for high-volume output.
app.on("onRequest", (ctx) => {
  ctx.logs.push(`[${ctx.req.method}] ${ctx.req.path}`)
})

app.on("afterPipeline", (ctx) => {
  if (ctx.logs.length > 0) {
    console.log("[ctx.logs]", ctx.logs)
  }
})

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/hello",
      handler: async (ctx) => {
        ctx.logs.push("handler: /hello executed")
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
server.listen(3000).catch(console.error)

// GET /api/hello prints to console:
// [ctx.logs] [ '[GET] /api/hello', 'handler: /hello executed' ]
