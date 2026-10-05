import {
  type Attributes,
  context,
  type Context as OtelContext,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  type TextMapGetter,
  type Tracer,
  trace,
} from "@opentelemetry/api"
import { HttpError } from "../core/HttpError.js"
import type { OrvaxisContext, PluginContext, Trace } from "../types/index.js"

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

type SpanState = {
  root: Span
  rootCtx: OtelContext
  pipeline?: Span
  handler?: Span
}

export function otelPlugin({ tracer }: OtelPluginOptions) {
  const states = new WeakMap<OrvaxisContext, SpanState>()

  return {
    name: "otel",

    apply(runtime: PluginContext) {
      runtime.hooks.on("onRequest", (ctx: OrvaxisContext) => {
        const parentCtx = propagation.extract(context.active(), ctx.req.headers, headerGetter)
        const root = tracer.startSpan(
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
        const rootCtx = trace.setSpan(parentCtx, root)
        states.set(ctx, { root, rootCtx })
      })

      runtime.hooks.on("beforePipeline", (ctx: OrvaxisContext) => {
        const state = states.get(ctx)
        if (!state) return
        state.pipeline = tracer.startSpan("orvaxis.pipeline", {}, state.rootCtx)
      })

      runtime.hooks.on("beforeHandler", (ctx: OrvaxisContext) => {
        const state = states.get(ctx)
        if (!state) return
        state.root.updateName(resolveSpanName(ctx))
        state.pipeline?.end()
        state.pipeline = undefined
        state.handler = tracer.startSpan("orvaxis.handler", {}, state.rootCtx)
      })

      runtime.hooks.on("afterHandler", (ctx: OrvaxisContext) => {
        const state = states.get(ctx)
        if (!state) return
        state.handler?.end()
        state.handler = undefined
      })

      runtime.hooks.on("afterPipeline", (ctx: OrvaxisContext) => {
        const state = states.get(ctx)
        if (!state) return
        state.pipeline?.end()
        state.handler?.end()
        const { root } = state
        root.setAttribute("http.response.status_code", ctx.res.statusCode)
        const orvaxisTrace = ctx.meta.trace as Trace | undefined
        root.setAttribute("orvaxis.runtime.outcome", orvaxisTrace?.outcome ?? "success")
        root.setAttribute("orvaxis.response.sent", orvaxisTrace?.responseSentAtRuntimeEnd ?? false)
        if (orvaxisTrace?.responseCompletedAtRuntimeEnd !== undefined) {
          root.setAttribute(
            "orvaxis.response.completed_at_runtime_end",
            orvaxisTrace.responseCompletedAtRuntimeEnd
          )
        }
        for (const ev of orvaxisTrace?.events ?? []) {
          root.addEvent(ev.type, ev.meta as Attributes | undefined, ev.timestamp)
        }
        root.setStatus({ code: SpanStatusCode.OK })
        root.end()
        states.delete(ctx)
      })

      runtime.hooks.on("onError", (ctx: OrvaxisContext, err?: Error) => {
        const state = states.get(ctx)
        if (!state) return
        state.pipeline?.end()
        state.handler?.end()
        const { root } = state
        const policyName = err instanceof HttpError ? err.policyName : undefined
        if (policyName) {
          const safeError = new Error(`Policy denied: ${policyName}`)
          safeError.name = "PolicyDeniedError"
          root.recordException(safeError)
        } else if (err) {
          root.recordException(err)
        }
        root.setStatus({
          code: SpanStatusCode.ERROR,
          message: policyName ? `Policy denied: ${policyName}` : err?.message,
        })
        const statusCode = ctx.res.sent
          ? ctx.res.statusCode
          : err instanceof HttpError
            ? err.status
            : 500
        root.setAttribute("http.response.status_code", statusCode)
        const orvaxisTrace = ctx.meta.trace as Trace | undefined
        root.setAttribute("orvaxis.runtime.outcome", orvaxisTrace?.outcome ?? "error")
        root.setAttribute("orvaxis.response.sent", orvaxisTrace?.responseSentAtRuntimeEnd ?? false)
        if (orvaxisTrace?.responseCompletedAtRuntimeEnd !== undefined) {
          root.setAttribute(
            "orvaxis.response.completed_at_runtime_end",
            orvaxisTrace.responseCompletedAtRuntimeEnd
          )
        }
        for (const ev of orvaxisTrace?.events ?? []) {
          root.addEvent(ev.type, ev.meta as Attributes | undefined, ev.timestamp)
        }
        root.end()
        states.delete(ctx)
      })
    },
  }
}
