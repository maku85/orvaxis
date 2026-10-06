import { basename } from "node:path"
import type { Span, SpanContext, Tracer } from "@opentelemetry/api"
import { testRequest } from "../core/testHarness"
import { Orvaxis, traceEvent, traceMiddleware } from "../index"
import { otelPlugin } from "../otel"

// Runs otelPlugin with no OpenTelemetry SDK, exporter or collector: a recording tracer stands in
// for `trace.getTracer(...)`, so the span structure the plugin produces can be read locally.
// Exporting real spans needs your own SDK and exporter (see the OpenTelemetry guide).

type Recorded = {
  name: string
  parent: string | null
  parentRecord?: Recorded
  attributes: Record<string, unknown>
  events: string[]
  status?: number
  exceptions: string[]
}

export function createRecordingTracer() {
  const spans: Recorded[] = []
  let counter = 0
  const tracer = {
    startSpan(name: string, options?: { attributes?: Record<string, unknown> }, ctx?: unknown) {
      const parentSpan = ctx
        ? (ctx as { getValue?: (k: symbol) => unknown }).getValue?.(
            Symbol.for("OpenTelemetry Context Key SPAN")
          )
        : undefined
      const parentRecord = (parentSpan as { __record?: Recorded } | undefined)?.__record
      const record: Recorded = {
        name,
        parent: null,
        parentRecord,
        attributes: { ...(options?.attributes ?? {}) },
        events: [],
        exceptions: [],
      }
      spans.push(record)
      const spanContext: SpanContext = {
        traceId: `${"0".repeat(31)}1`,
        spanId: String(++counter).padStart(16, "0"),
        traceFlags: 1,
      }
      const span = {
        __record: record,
        spanContext: () => spanContext,
        setAttribute(key: string, value: unknown) {
          record.attributes[key] = value
          return span
        },
        addEvent(eventName: string) {
          record.events.push(eventName)
          return span
        },
        setStatus(status: { code: number }) {
          record.status = status.code
          return span
        },
        updateName(next: string) {
          record.name = next
          return span
        },
        recordException(error: Error) {
          record.exceptions.push(`${error.name}: ${error.message}`)
        },
        end() {},
        isRecording: () => true,
      }
      return span as unknown as Span
    },
  } as unknown as Tracer
  return { tracer, spans }
}

export function createTracedApp(tracer: Tracer) {
  // #region app
  const app = new Orvaxis()
  app.register(otelPlugin({ tracer })) // tracer comes from trace.getTracer("my-service") in real use
  app.group({
    prefix: "/api",
    middleware: [traceMiddleware()],
    policies: [
      {
        name: "tenant",
        evaluate: (ctx) =>
          ctx.req.headers["x-tenant"] ? { allow: true } : { allow: false, reason: "no tenant" },
      },
    ],
    routes: [
      {
        method: "GET",
        path: "/users/:id",
        handler: (ctx) => {
          traceEvent("db:query", { table: "users" })
          ctx.res.json({ id: ctx.params.id })
        },
      },
    ],
  })
  // #endregion
  return app
}

export const otelScenarios = [
  { id: "success", request: { path: "/api/users/42", headers: { "x-tenant": "acme" } } },
  { id: "denied", request: { path: "/api/users/42" } },
  { id: "not-found", request: { path: "/api/nope", headers: { "x-tenant": "acme" } } },
] as const

export async function recordSpans(scenario: (typeof otelScenarios)[number]) {
  const { tracer, spans } = createRecordingTracer()
  const app = createTracedApp(tracer)
  await testRequest(app, { ...scenario.request, id: "req-1" })
  // Resolve parents by their final name (the root is renamed to its route template).
  return spans.map(({ parentRecord, ...span }) => ({ ...span, parent: parentRecord?.name ?? null }))
}

/** The span tree as indented text, for reading. */
export function outline(spans: Awaited<ReturnType<typeof recordSpans>>): string {
  const status = (code?: number) => (code === 1 ? "OK" : code === 2 ? "ERROR" : "unset")
  const depth = (name: string | null): number => {
    const parent = spans.find((span) => span.name === name)
    return parent ? 1 + depth(parent.parent) : 0
  }
  return spans
    .map((span) => {
      const events = span.events.length > 0 ? `  events: ${span.events.join(", ")}` : ""
      const errors = span.exceptions.length > 0 ? `  exception: ${span.exceptions.join("; ")}` : ""
      const root = span.parent === null ? `  status: ${status(span.status)}` : ""
      return `${"  ".repeat(depth(span.parent))}${span.name}${root}${events}${errors}`
    })
    .join("\n")
}

if (basename(process.argv[1] ?? "") === "otel-local.ts") {
  ;(async () => {
    for (const scenario of otelScenarios) {
      console.log(`=== ${scenario.id} ===
${outline(await recordSpans(scenario))}
`)
    }
  })()
}
