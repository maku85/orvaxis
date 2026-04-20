import type { Runtime } from "../core/Runtime"
import type { OrvaxisContext } from "../types"

export const loggerPlugin = {
  name: "logger",

  apply(runtime: Runtime) {
    runtime.hooks.on("onRequest", (ctx: OrvaxisContext) => {
      console.log("[REQ]", (ctx.req as any).url)
    })

    runtime.hooks.on("onError", (_ctx: OrvaxisContext, err: unknown) => {
      console.error("[ERR]", err)
    })
  },
}
