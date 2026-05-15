import type { DebugEntry, DebugInfo, OrvaxisContext, Trace, TraceEvent } from "../types"

export type UnifiedEvent = {
  kind: "trace" | "debug"
  name: string
  timestamp: number
  meta?: Record<string, unknown>
}

export type ExecutionSummary = {
  requestId: string | undefined
  route: OrvaxisContext["meta"]["route"]
  duration: number | null
  traceEvents: TraceEvent[]
  debugSteps: Record<string, DebugEntry[]>
  combinedTimeline: UnifiedEvent[]
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

  const combinedTimeline: UnifiedEvent[] = [
    ...(trace?.events ?? []).map((e) => ({
      kind: "trace" as const,
      name: e.type,
      timestamp: e.timestamp,
      meta: e.meta,
    })),
    ...(debug?.timeline ?? []).map((e) => ({
      kind: "debug" as const,
      name: e.event,
      timestamp: e.time,
      meta: e.meta,
    })),
  ].sort((a, b) => a.timestamp - b.timestamp)

  return {
    requestId: trace?.requestId,
    route: ctx.meta.route,
    duration,
    traceEvents: trace?.events ?? [],
    debugSteps,
    combinedTimeline,
  }
}
