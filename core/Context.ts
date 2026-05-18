import type { OrvaxisContext, OrvaxisRequest, OrvaxisResponse } from "../types"

const DEFAULT_LOGS_MAX_SIZE = 1000

function createBoundedLogs(cap: number): string[] {
  const arr: string[] = []
  let warned = false

  function warnOnce() {
    if (!warned) {
      warned = true
      console.warn(
        `[orvaxis] ctx.logs cap (${cap}) reached — further entries are dropped. ` +
          "ctx.logs is designed for short debug trails, not high-volume logging."
      )
    }
  }

  return new Proxy(arr, {
    get(target, prop, receiver) {
      if (prop === "push") {
        return (...items: string[]): number => {
          const available = cap - target.length
          if (available <= 0) {
            warnOnce()
            return target.length
          }
          if (items.length > available) {
            warnOnce()
            return target.push(...items.slice(0, available))
          }
          return target.push(...items)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

export function createContext(
  req: OrvaxisRequest,
  res: OrvaxisResponse,
  logsMaxSize = DEFAULT_LOGS_MAX_SIZE
): OrvaxisContext {
  const ctx: OrvaxisContext = {
    req,
    res,
    state: {},
    meta: {},
    logs: createBoundedLogs(logsMaxSize),
    get params() {
      return (ctx.meta.route?.params ?? {}) as Record<string, string>
    },
  }
  return ctx
}
