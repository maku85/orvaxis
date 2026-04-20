import type { Middleware } from "../types"

export function traceMiddleware(): Middleware {
  return async (ctx, next) => {
    ctx.meta.tracer?.event("MIDDLEWARE:start")

    const start = Date.now()
    await next()
    const duration = Date.now() - start

    ctx.meta.tracer?.event("MIDDLEWARE:end", { duration })
  }
}
