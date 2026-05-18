import { Orvaxis } from "../core/Orvaxis"
import { createExpressServer } from "../http/expressAdapter"
import { loggerPlugin } from "../plugins/loggerPlugin"

const app = new Orvaxis()

// Default format is "json" — emits structured objects for log aggregators:
//   { type: "request",  method, path, requestId }
//   { type: "response", method, path, status, durationMs, requestId }
//   { type: "error",    requestId, message, error }
//
// Use format: "text" for plain human-readable output in development:
//   [REQ] GET /api/fast req-abc
//   [RES] GET /api/fast 200 3ms req-abc
app.register(loggerPlugin({ format: "text" }))

app.on("beforeHandler", (ctx) => {
  ctx.meta.handlerStartedAt = Date.now()
})

app.on("afterHandler", (ctx) => {
  const handlerDuration = Date.now() - (ctx.meta.handlerStartedAt as number)
  console.log(`[HANDLER] ${ctx.req.path} — ${handlerDuration}ms`)
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

// Each request prints (text format):
// [REQ] GET /api/fast req-abc          ← loggerPlugin onRequest
// [HANDLER] /api/fast — Xms            ← afterHandler hook (handler time only)
// [RES] GET /api/fast 200 Xms req-abc  ← loggerPlugin afterPipeline (total time)
