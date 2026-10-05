import type { Middleware, OrvaxisContext } from "../types/index.js"

export class Pipeline {
  private middlewares: Middleware[] = []

  use(fn: Middleware) {
    this.middlewares.push(fn)
  }

  async execute(ctx: OrvaxisContext): Promise<boolean> {
    let index = -1

    const runner = async (i: number): Promise<void> => {
      if (i <= index) return
      index = i

      if (ctx.res.sent) return

      const fn = this.middlewares[i]
      if (!fn) return

      let calledNext = false
      await fn(ctx, async () => {
        if (calledNext) return
        calledNext = true
        await runner(i + 1)
      })

      if (!calledNext || ctx.res.sent) {
        stopped = true
      }
    }

    let stopped = false
    await runner(0)
    return !stopped && !ctx.res.sent
  }
}
