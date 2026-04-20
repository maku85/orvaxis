import type { OrvaxisContext } from "../types"

export function createContext(req: any, res: any): OrvaxisContext {
  return {
    req,
    res,
    state: {},
    meta: {},
    logs: [],
  }
}
