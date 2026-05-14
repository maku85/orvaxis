import type { Runtime } from "../core/Runtime"
import type { Logger, OrvaxisContext } from "../types"

export function loggerPlugin(options: { logger?: Logger } = {}) {
  const logger = options.logger ?? console

  return {
    name: "logger",

    apply(runtime: Runtime) {
      runtime.hooks.on("onRequest", (ctx: OrvaxisContext) => {
        logger.info("[REQ]", ctx.req.path)
      })

      runtime.hooks.on("onError", (_ctx: OrvaxisContext, err?: Error) => {
        logger.error("[ERR]", err)
      })
    },
  }
}
