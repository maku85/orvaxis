import { createExpressServer } from "../http/expressAdapter"
import { buildExecutionSummary, Orvaxis, traceEvent, traceMiddleware } from "../index"

const app = new Orvaxis()

// enable() / disable() are the only way to toggle debug collection.
// app.debugger.enabled is a read-only getter — direct assignment throws.
app.debugger.enable()

app.on("afterPipeline", (ctx) => {
  const summary = buildExecutionSummary(ctx)
  console.log("[SUMMARY]", JSON.stringify(summary, null, 2))
  // summary.requestId        — unique ID for this request
  // summary.duration         — total ms (always available)
  // summary.traceEvents      — user-emitted events (MIDDLEWARE:start/end, custom, ...)
  // summary.debugSteps       — internal lifecycle events grouped by phase (REQUEST_START, POLICY_*, HOOK:*, ...)
  // summary.combinedTimeline — all events merged and sorted by timestamp, each with kind: "trace" | "debug"
  // summary.route            — matched route + group
})

app.group({
  prefix: "/api",
  middleware: [traceMiddleware()],
  routes: [
    {
      method: "GET",
      path: "/users",
      handler: async (ctx) => {
        traceEvent("db:query", { table: "users" })
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

// GET /api/users → response + summary with:
//   traceEvents: [MIDDLEWARE:start, db:query, MIDDLEWARE:end]
//   debugSteps:  { REQUEST_START, POLICY_*, HOOK:*, PIPELINE_*, MIDDLEWARE_*, HANDLER_*, REQUEST_END }
//   duration:    total ms

// GET /api/error → 500 + summary with ERROR in debugSteps
