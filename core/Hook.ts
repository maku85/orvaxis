import type { HookName, Logger, OrvaxisContext } from "../types"

type HookFn = (ctx: OrvaxisContext, error?: Error) => Promise<void> | void

export class HookSystem {
  private readonly logger: Logger
  private hooks: Record<HookName, HookFn[]> = {
    onRequest: [],
    beforePipeline: [],
    beforeHandler: [],
    afterHandler: [],
    afterPipeline: [],
    onError: [],
  }

  constructor(logger: Logger = console) {
    this.logger = logger
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
          this.logger.error("[orvaxis] onError hook threw:", hookErr)
        } else if (firstError === undefined) {
          firstError = hookErr
        }
      }
    }
    if (firstError !== undefined) throw firstError
  }
}
