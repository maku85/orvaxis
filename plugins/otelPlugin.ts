import {
  type Attributes,
  type Span,
  SpanKind,
  SpanStatusCode,
  type TextMapGetter,
  type Tracer,
  context,
  propagation,
} from "@opentelemetry/api"
import type { OrvaxisContext, PluginContext, Trace } from "../types"

export type OtelPluginOptions = {
  tracer: Tracer
}

const headerGetter: TextMapGetter<Record<string, string | string[] | undefined>> = {
  get(carrier, key) {
    const val = carrier[key.toLowerCase()]
    return Array.isArray(val) ? val[0] : val
  },
  keys(carrier) {
    return Object.keys(carrier)
  },
}

function resolveSpanName(ctx: OrvaxisContext): string {
  const route = ctx.meta.route
  if (route) return `${ctx.req.method.toUpperCase()} ${route.group.prefix}${route.route.path}`
  return `${ctx.req.method.toUpperCase()} ${ctx.req.path}`
}

export function otelPlugin({ tracer }: OtelPluginOptions) {
  const spans = new WeakMap<OrvaxisContext, Span>()

  return {
    name: "otel",

    apply(runtime: PluginContext) {
      runtime.hooks.on("onRequest", (ctx: OrvaxisContext) => {
        const parentCtx = propagation.extract(context.active(), ctx.req.headers, headerGetter)
        const span = tracer.startSpan(
          resolveSpanName(ctx),
          {
            kind: SpanKind.SERVER,
            attributes: {
              "http.request.method": ctx.req.method.toUpperCase(),
              "url.path": ctx.req.path,
              ...(ctx.req.id ? { "orvaxis.request_id": ctx.req.id } : {}),
            },
          },
          parentCtx
        )
        spans.set(ctx, span)
      })

      runtime.hooks.on("afterPipeline", (ctx: OrvaxisContext) => {
        const span = spans.get(ctx)
        if (!span) return
        span.setAttribute("http.response.status_code", ctx.res.statusCode)
        const trace = ctx.meta.trace as Trace | undefined
        for (const ev of trace?.events ?? []) {
          span.addEvent(ev.type, ev.meta as Attributes | undefined, ev.timestamp)
        }
        span.setStatus({ code: SpanStatusCode.OK })
        span.end()
        spans.delete(ctx)
      })

      runtime.hooks.on("onError", (ctx: OrvaxisContext, err?: Error) => {
        const span = spans.get(ctx)
        if (!span) return
        if (err) span.recordException(err)
        span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message })
        span.setAttribute("http.response.status_code", ctx.res.statusCode)
        span.end()
        spans.delete(ctx)
      })
    },
  }
}
