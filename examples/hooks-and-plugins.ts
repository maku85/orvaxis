import { Orvaxis } from "../core/Orvaxis"
import { createExpressServer } from "../http/expressAdapter"
import { loggerPlugin } from "../plugins/loggerPlugin"

const app = new Orvaxis()

app.register(loggerPlugin)

app.on("onRequest", (ctx) => {
  ctx.meta.startedAt = Date.now()
})

app.on("beforeHandler", (ctx) => {
  ctx.meta.handlerStartedAt = Date.now()
})

app.on("afterHandler", (ctx) => {
  const handlerDuration = Date.now() - (ctx.meta.handlerStartedAt as number)
  console.log(`[HANDLER] ${ctx.req.path} — ${handlerDuration}ms`)
})

app.on("afterPipeline", (ctx) => {
  const totalDuration = Date.now() - (ctx.meta.startedAt as number)
  console.log(`[DONE] ${ctx.req.method} ${ctx.req.path} — ${totalDuration}ms total`)
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
server.listen(3002).catch(console.error)

// Each request prints to console:
// [REQ] /api/fast               ← loggerPlugin (onRequest)
// [HANDLER] /api/fast — Xms     ← afterHandler hook (handler time only)
// [DONE] GET /api/fast — Xms    ← afterPipeline hook (total time)
