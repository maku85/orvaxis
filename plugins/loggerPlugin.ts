import type { Logger, OrvaxisContext, PluginContext } from "../types"

export type LoggerPluginOptions = {
  logger?: Logger
  format?: "text" | "json"
}

export function loggerPlugin(options: LoggerPluginOptions = {}) {
  const logger = options.logger ?? console
  const format = options.format ?? "json"
  const startTimes = new WeakMap<object, number>()

  return {
    name: "logger",

    apply(runtime: PluginContext) {
      runtime.hooks.on("onRequest", (ctx: OrvaxisContext) => {
        startTimes.set(ctx, Date.now())
        if (format === "json") {
          logger.info({
            type: "request",
            method: ctx.req.method,
            path: ctx.req.path,
            requestId: ctx.req.id,
          })
        } else {
          logger.info("[REQ]", ctx.req.method, ctx.req.path, ctx.req.id)
        }
      })

      runtime.hooks.on("afterPipeline", (ctx: OrvaxisContext) => {
        const startTime = startTimes.get(ctx)
        const durationMs = startTime !== undefined ? Date.now() - startTime : undefined
        if (format === "json") {
          logger.info({
            type: "response",
            method: ctx.req.method,
            path: ctx.req.path,
            status: ctx.res.statusCode,
            durationMs,
            requestId: ctx.req.id,
          })
        } else {
          logger.info(
            "[RES]",
            ctx.req.method,
            ctx.req.path,
            ctx.res.statusCode,
            durationMs !== undefined ? `${durationMs}ms` : undefined,
            ctx.req.id
          )
        }
      })

      runtime.hooks.on("onError", (ctx: OrvaxisContext, err?: Error) => {
        if (format === "json") {
          logger.error({ type: "error", requestId: ctx.req.id, message: err?.message, error: err })
        } else {
          logger.error("[ERR]", ctx.req.id, err)
        }
      })
    },
  }
}
