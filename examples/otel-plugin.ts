/**
 * otelPlugin example — child spans + custom enrichment
 *
 * Requires a running OTel collector and the @opentelemetry/api peer dependency.
 * Configure your SDK and exporter once at startup (e.g. with @opentelemetry/sdk-node);
 * this file only shows the Orvaxis side.
 *
 * Span tree produced per matched request:
 *
 *   GET /api/users/:id         (root SERVER span, full request duration)
 *   ├─ orvaxis.pipeline        (beforePipeline → beforeHandler: global mw + group/route mw)
 *   └─ orvaxis.handler         (beforeHandler → afterHandler: route handler only)
 *
 * 404 / 405 requests produce only the root span — child spans are never opened.
 */

import { trace } from "@opentelemetry/api"
import { createExpressServer } from "../http/expressAdapter"
import { Orvaxis, traceEvent, traceMiddleware } from "../index"
import { otelPlugin } from "../plugins/otelPlugin"

// In a real app this tracer is provided by your SDK initialisation.
const tracer = trace.getTracer("my-service", "1.0.0")

const app = new Orvaxis()
app.register(otelPlugin({ tracer }))

// traceMiddleware events (MIDDLEWARE:start / MIDDLEWARE:end) are forwarded
// to the root span as OTel span events by the plugin.
app.group({
  prefix: "/api",
  middleware: [traceMiddleware()],
  routes: [
    {
      method: "GET",
      path: "/users/:id",
      handler: async (ctx) => {
        // Emit a custom trace event — the plugin forwards it to the root span.
        traceEvent("db:query", { table: "users", id: ctx.params.id })

        // Manually add a child span for an external call, parented to the
        // active OTel context.  The plugin sets the root span as the active
        // context for the duration of the request via trace.setSpan(), so
        // any span you start here is automatically nested under the root.
        const childSpan = tracer.startSpan("redis:get")
        try {
          // await redis.get(`user:${ctx.params.id}`)
          childSpan.setStatus({ code: 1 /* OK */ })
        } finally {
          childSpan.end()
        }

        ctx.res.json({ id: ctx.params.id, name: "Alice" })
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
server.listen(3004).catch(console.error)

// GET /api/users/42 → span tree:
//   GET /api/users/:id            (root)
//   ├─ orvaxis.pipeline           (middleware timing)
//   │    events: [MIDDLEWARE:start, MIDDLEWARE:end]
//   ├─ orvaxis.handler            (handler timing)
//   └─ redis:get                  (manually created child span)

// GET /api/not-found → span tree:
//   GET /api/not-found            (root only, ERROR status, no child spans)
