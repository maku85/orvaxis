import type { HookName, OrvaxisContext } from "../types"

type HookFn = (ctx: OrvaxisContext, error?: Error) => Promise<void> | void

export class HookSystem {
  private hooks: Record<HookName, HookFn[]> = {
    onRequest: [],
    beforePipeline: [],
    beforeHandler: [],
    afterHandler: [],
    afterPipeline: [],
    onError: [],
  }

  on(name: HookName, fn: HookFn) {
    this.hooks[name].push(fn)
  }

  async trigger(name: HookName, ctx: OrvaxisContext, error?: Error) {
    let firstError: unknown
    for (const fn of this.hooks[name]) {
      try {
        await fn(ctx, error)
      } catch (hookErr) {
        if (name === "onError") {
          console.error("[orvaxis] onError hook threw:", hookErr)
        } else if (firstError === undefined) {
          firstError = hookErr
        }
      }
    }
    if (firstError !== undefined) throw firstError
  }
}
