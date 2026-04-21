import type { DebugEntry, DebugInfo, OrvaxisContext, Trace } from "../types"

export function buildExecutionSummary(ctx: OrvaxisContext) {
  const debug = ctx.meta.debug as DebugInfo | undefined

  if (!debug) return null

  const trace = ctx.meta.trace as Trace | undefined

  return {
    route: ctx.meta.route,
    duration:
      trace?.endTime != null && trace?.startTime != null
        ? trace.endTime - trace.startTime
        : null,

    steps: debug.timeline.reduce<Record<string, DebugEntry[]>>((acc, ev) => {
      const group = ev.event.split(":")[0]

      acc[group] ??= []
      acc[group].push(ev)

      return acc
    }, {}),
  }
}
