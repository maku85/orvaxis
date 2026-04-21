import type { HookName, OrvaxisContext } from "../types"

type HookFn = (ctx: OrvaxisContext, error?: Error) => Promise<void> | void

export class HookSystem {
  private hooks: Record<HookName, HookFn[]> = {
    onRequest: [],
    beforePipeline: [],
    afterPipeline: [],
    onError: [],
  }

  on(name: HookName, fn: HookFn) {
    this.hooks[name].push(fn)
  }

  async trigger(name: HookName, ctx: OrvaxisContext, error?: Error) {
    for (const fn of this.hooks[name]) {
      if (name === "onError") {
        try {
          await fn(ctx, error)
        } catch (hookErr) {
          console.error("[orvaxis] onError hook threw:", hookErr)
        }
      } else {
        await fn(ctx, error)
      }
    }
  }
}
