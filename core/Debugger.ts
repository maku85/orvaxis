import type { DebugInfo, OrvaxisContext } from "../types"

type PerfOrigin = { startMs: number; startPerf: number }

export class Debugger {
  enabled = false
  // Keyed by DebugInfo instance so entries across the same request share one origin.
  // WeakMap ensures no retention after the request context is GC'd.
  private readonly _origins = new WeakMap<DebugInfo, PerfOrigin>()

  enable() {
    this.enabled = true
  }

  log(ctx: OrvaxisContext, event: string, meta?: Record<string, unknown>) {
    if (!this.enabled) return

    ctx.meta.debug ??= { timeline: [] } satisfies DebugInfo

    const debug = ctx.meta.debug as DebugInfo

    let origin = this._origins.get(debug)
    if (!origin) {
      origin = { startMs: Date.now(), startPerf: performance.now() }
      this._origins.set(debug, origin)
    }

    const { startMs, startPerf } = origin
    debug.timeline.push({ event, time: startMs + (performance.now() - startPerf), meta })
  }
}
