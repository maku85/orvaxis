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
    const errors: unknown[] = []
    for (const fn of this.hooks[name]) {
      try {
        await fn(ctx, error)
      } catch (hookErr) {
        if (name === "onError") {
          this.logger.error("[orvaxis] onError hook threw:", hookErr)
        } else {
          errors.push(hookErr)
        }
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, "Multiple hook errors")
  }
}
