import type { Logger, OrvaxisContext, OrvaxisRequest, OrvaxisResponse } from "../types/index.js"

const DEFAULT_LOGS_MAX_SIZE = 1000

function createBoundedLogs(cap: number, logger: Logger): string[] {
  const arr: string[] = []
  let warned = false

  function warnOnce() {
    if (!warned) {
      warned = true
      try {
        const warn = logger.warn ?? logger.error
        warn.call(
          logger,
          `[orvaxis] ctx.logs cap (${cap}) reached — further entries are dropped. ` +
            "ctx.logs is designed for short debug trails, not high-volume logging."
        )
      } catch {
        // A failing logger must not turn a dropped debug entry into a request error.
      }
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
  logsMaxSize = DEFAULT_LOGS_MAX_SIZE,
  logger: Logger = console
): OrvaxisContext {
  const ctx: OrvaxisContext = {
    req,
    res,
    state: {},
    meta: {},
    logs: createBoundedLogs(logsMaxSize, logger),
    get params() {
      return (ctx.meta.route?.params ?? {}) as Record<string, string>
    },
  }
  return ctx
}
