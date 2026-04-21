import type { DebugInfo, OrvaxisContext } from "../types"

export class Debugger {
  enabled = false

  enable() {
    this.enabled = true
  }

  log(ctx: OrvaxisContext, event: string, meta?: Record<string, unknown>) {
    if (!this.enabled) return

    ctx.meta.debug ??= { timeline: [] } satisfies DebugInfo

    const debug = ctx.meta.debug as DebugInfo
    debug.timeline.push({ event, time: Date.now(), meta })
  }
}
