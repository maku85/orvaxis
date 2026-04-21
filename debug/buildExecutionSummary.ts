import type { DebugEntry, DebugInfo, OrvaxisContext, Trace, TraceEvent } from "../types"

export type ExecutionSummary = {
  requestId: string | undefined
  route: OrvaxisContext["meta"]["route"]
  duration: number | null
  traceEvents: TraceEvent[]
  debugSteps: Record<string, DebugEntry[]>
}

export function buildExecutionSummary(ctx: OrvaxisContext): ExecutionSummary {
  const trace = ctx.meta.trace as Trace | undefined
  const debug = ctx.meta.debug as DebugInfo | undefined

  const duration =
    trace?.endTime != null && trace?.startTime != null ? trace.endTime - trace.startTime : null

  const debugSteps = (debug?.timeline ?? []).reduce<Record<string, DebugEntry[]>>((acc, ev) => {
    const group = ev.event.split(":")[0]
    acc[group] ??= []
    acc[group].push(ev)
    return acc
  }, {})

  return {
    requestId: trace?.requestId,
    route: ctx.meta.route,
    duration,
    traceEvents: trace?.events ?? [],
    debugSteps,
  }
}
