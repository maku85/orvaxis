import type { HookName } from "../types"

type HookFn = (ctx: any, error?: any) => Promise<void> | void

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

  async trigger(name: HookName, ctx: any, error?: any) {
    for (const fn of this.hooks[name]) {
      await fn(ctx, error)
    }
  }
}
