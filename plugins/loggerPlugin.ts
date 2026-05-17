import type { Logger, OrvaxisContext, PluginContext } from "../types"

export function loggerPlugin(options: { logger?: Logger } = {}) {
  const logger = options.logger ?? console

  return {
    name: "logger",

    apply(runtime: PluginContext) {
      runtime.hooks.on("onRequest", (ctx: OrvaxisContext) => {
        logger.info("[REQ]", ctx.req.method, ctx.req.path, ctx.req.id)
      })

      runtime.hooks.on("onError", (ctx: OrvaxisContext, err?: Error) => {
        logger.error("[ERR]", ctx.req.id, err)
      })
    },
  }
}
