import type { Middleware, OrvaxisContext } from "../types/index.js"

/**
 * Run `middlewares` in order, each continuing through `next()`. Resolves to `true` when every
 * middleware called `next()` and no response was sent, `false` when the chain stopped early.
 */
export async function composeMiddleware(
  middlewares: readonly Middleware[],
  ctx: OrvaxisContext
): Promise<boolean> {
  let index = -1
  let stopped = false

  const runner = async (i: number): Promise<void> => {
    if (i <= index) return
    index = i
    if (ctx.res.sent) return
    const fn = middlewares[i]
    if (!fn) return
    let calledNext = false
    await fn(ctx, async () => {
      if (calledNext) return
      calledNext = true
      await runner(i + 1)
    })
    if (!calledNext || ctx.res.sent) stopped = true
  }

  await runner(0)
  return !stopped && !ctx.res.sent
}

export class Pipeline {
  private middlewares: Middleware[] = []

  use(fn: Middleware) {
    this.middlewares.push(fn)
  }

  execute(ctx: OrvaxisContext): Promise<boolean> {
    return composeMiddleware(this.middlewares, ctx)
  }
}
