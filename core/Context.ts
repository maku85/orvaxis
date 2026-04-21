import type { OrvaxisContext, OrvaxisRequest, OrvaxisResponse } from "../types"

export function createContext(req: OrvaxisRequest, res: OrvaxisResponse): OrvaxisContext {
  return {
    req,
    res,
    state: {},
    meta: {},
    logs: [],
  }
}
