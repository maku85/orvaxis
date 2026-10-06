import { basename } from "node:path"
import { testRequest } from "../core/testHarness"
import {
  buildExecutionSummary,
  buildRequestReport,
  loggerPlugin,
  Orvaxis,
  traceEvent,
  traceMiddleware,
} from "../index"

// What the runtime records about a request, shown without a server: successful, failing and
// denied requests go through the same observation points.

export type LogRecord = [level: "info" | "error", record: Record<string, unknown>]

export function createObservedApp(logs: LogRecord[]) {
  // #region app
  const app = new Orvaxis()
  app.debugger.enable() // optional: also record the internal lifecycle steps

  // Any object with info() and error() works: pino, winston, console, or this array.
  app.register(
    loggerPlugin({
      logger: {
        info: (record: Record<string, unknown>) => logs.push(["info", record]),
        error: (record: Record<string, unknown>) => logs.push(["error", record]),
      },
    })
  )

  app.policy({
    name: "authenticate",
    evaluate: (ctx) =>
      ctx.req.headers["x-user"]
        ? { allow: true }
        : { allow: false, status: 401, reason: "No user" },
  })

  app.group({
    prefix: "/api",
    middleware: [traceMiddleware()], // MIDDLEWARE:start / MIDDLEWARE:end around the layer
    routes: [
      {
        method: "GET",
        path: "/orders/:id",
        handler: async (ctx) => {
          // Custom events can come from anywhere in the call chain, including after an await.
          await loadOrder(ctx.params.id)
          ctx.res.json({ id: ctx.params.id })
        },
      },
      {
        method: "GET",
        path: "/explode",
        handler: () => {
          throw new Error("database password is hunter2")
        },
      },
      {
        // Starts a stream and returns: the runtime is done, the response is not.
        method: "GET",
        path: "/stream",
        handler: (ctx) => {
          ctx.res.write("data: first\n\n")
        },
      },
    ],
  })
  // #endregion
  return app
}

// #region custom-event
async function loadOrder(id: string) {
  await Promise.resolve() // stands in for I/O
  traceEvent("db:query", { table: "orders", id }) // no ctx needed; a no-op outside a request
}
// #endregion

export const observedScenarios = [
  { id: "success", request: { path: "/api/orders/42", headers: { "x-user": "alice" } } },
  { id: "handler-error", request: { path: "/api/explode", headers: { "x-user": "alice" } } },
  { id: "denied", request: { path: "/api/orders/42" } },
  { id: "stream", request: { path: "/api/stream", headers: { "x-user": "alice" } } },
] as const

/** Everything worth reading about one request, with the volatile numbers removed. */
export async function observe(scenario: (typeof observedScenarios)[number]) {
  const logs: LogRecord[] = []
  const app = createObservedApp(logs)
  const result = await testRequest(app, { ...scenario.request, id: "req-1" })
  if (!result.ctx) throw new Error("no context")
  const trace = result.ctx.meta.trace
  const summary = buildExecutionSummary(result.ctx)
  const report = buildRequestReport(result.ctx)
  const strip = ({ durationMs: _d, ...rest }: Record<string, unknown>) => rest
  return {
    status: result.status,
    trace: {
      requestId: trace?.requestId,
      outcome: trace?.outcome,
      handlerExecuted: trace?.handlerExecuted,
      responseSentAtRuntimeEnd: trace?.responseSentAtRuntimeEnd,
      responseCompletedAtRuntimeEnd: trace?.responseCompletedAtRuntimeEnd,
      events: trace?.events.map((event) => event.type),
    },
    debugSteps: Object.keys(summary.debugSteps),
    report: { ...report, durationMs: null },
    logs: logs.map(([level, record]): LogRecord => [level, strip(record)]),
  }
}

/** The few fields the guide prints for each scenario. */
export function compact(observation: Awaited<ReturnType<typeof observe>>) {
  return {
    status: observation.status,
    runtime: observation.trace.outcome,
    events: observation.trace.events,
    responseSent: observation.trace.responseSentAtRuntimeEnd,
    responseCompleted: observation.trace.responseCompletedAtRuntimeEnd,
    terminalDecision: observation.report.terminalDecision,
    logs: observation.logs.map(([level, record]) => `${level} ${String(record.type)}`),
  }
}

if (basename(process.argv[1] ?? "") === "observability.ts") {
  ;(async () => {
    for (const scenario of observedScenarios) {
      console.log(`=== ${scenario.id} ===\n${JSON.stringify(await observe(scenario), null, 2)}\n`)
    }
  })()
}
