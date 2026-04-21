import { Orvaxis } from "../core/Orvaxis"
import { createExpressServer } from "../http/expressAdapter"
import { loggerPlugin } from "../plugins/loggerPlugin"

const app = new Orvaxis()

app.register(loggerPlugin)

app.on("onRequest", (ctx) => {
  ctx.meta.startedAt = Date.now()
})

app.on("afterPipeline", (ctx) => {
  const duration = Date.now() - ctx.meta.startedAt
  console.log(`[DONE] ${ctx.req.method} ${ctx.req.path} — ${duration}ms`)
})

app.on("onError", (_ctx, err) => {
  console.error("[UNHANDLED]", err)
})

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/fast",
      handler: async (ctx) => {
        ctx.res.json({ response: "immediate" })
      },
    },
    {
      method: "GET",
      path: "/slow",
      handler: async (ctx) => {
        await new Promise((r) => setTimeout(r, 100))
        ctx.res.json({ response: "delayed 100ms" })
      },
    },
  ],
})

const server = createExpressServer(app)
server.listen(3002)

// Each request prints to console:
// [REQ] /api/fast          ← loggerPlugin (onRequest)
// [DONE] GET /api/fast — Xms  ← afterPipeline hook
