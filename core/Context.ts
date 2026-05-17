import type { OrvaxisContext, OrvaxisRequest, OrvaxisResponse } from "../types"

export function createContext(req: OrvaxisRequest, res: OrvaxisResponse): OrvaxisContext {
  const ctx: OrvaxisContext = {
    req,
    res,
    state: {},
    meta: {},
    logs: [],
    get params() {
      return (ctx.meta.route?.params ?? {}) as Record<string, string>
    },
  }
  return ctx
}
