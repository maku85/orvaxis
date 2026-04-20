import type { Middleware, OrvaxisContext } from "../types"

export class Pipeline {
  private middlewares: Middleware[] = []

  use(fn: Middleware) {
    this.middlewares.push(fn)
  }

  async execute(ctx: OrvaxisContext): Promise<void> {
    let index = -1

    const runner = async (i: number): Promise<void> => {
      if (i <= index) return
      index = i

      const fn = this.middlewares[i]
      if (!fn) return

      await fn(ctx, () => runner(i + 1))
    }

    await runner(0)
  }
}
