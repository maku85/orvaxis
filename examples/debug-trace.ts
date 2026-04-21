import { Orvaxis } from "../core/Orvaxis"
import { createExpressServer } from "../http/expressAdapter"
import { buildExecutionSummary } from "../debug/buildExecutionSummary"
import { traceMiddleware } from "../middleware/traceMiddleware"

const app = new Orvaxis()

// Records each lifecycle step in ctx.meta.debug
app.debugger.enable()

app.on("afterPipeline", (ctx) => {
  const summary = buildExecutionSummary(ctx)
  console.log("[SUMMARY]", JSON.stringify(summary, null, 2))
})

app.group({
  prefix: "/api",
  // emits MIDDLEWARE:start / MIDDLEWARE:end events into the trace
  middleware: [traceMiddleware()],
  routes: [
    {
      method: "GET",
      path: "/users",
      handler: async (ctx) => {
        ctx.res.json({ users: ["alice", "bob"] })
      },
    },
    {
      method: "GET",
      path: "/error",
      handler: async () => {
        throw new Error("Simulated error")
      },
    },
  ],
})

const server = createExpressServer(app)
server.listen(3003).catch(console.error)

// GET /api/users → response + summary including:
//   - steps: REQUEST_START, POLICY_*, HOOK:*, PIPELINE_*, MIDDLEWARE_*, HANDLER_*, REQUEST_END
//   - duration: total ms
//   - route: { route, group }

// GET /api/error → 500 + summary with ERROR step
