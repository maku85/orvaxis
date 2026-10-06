import { getPolicyTraceInfo, type PolicyTraceInfo } from "../core/PolicyEngine.js"
import type { DebugEntry, DebugInfo, OrvaxisContext, Trace, TraceEvent } from "../types/index.js"

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
  policyDecisions: TraceEvent[]
  stoppedByPolicy: TraceEvent | undefined
  notReachedStages: string[]
  /** Whether decisions were dropped by `maxEvents`; the terminal decision is always kept. */
  policyTrace: PolicyTraceInfo
  debugSteps: Record<string, DebugEntry[]>
  combinedTimeline: UnifiedEvent[]
}

export function buildExecutionSummary(ctx: OrvaxisContext): ExecutionSummary {
  const trace = ctx.meta.trace as Trace | undefined
  const debug = ctx.meta.debug as DebugInfo | undefined

  const duration =
    trace?.endTime != null && trace?.startTime != null ? trace.endTime - trace.startTime : null

  const policyDecisions = (trace?.events ?? []).filter((event) => event.type === "POLICY_DECISION")
  const stoppedByPolicy = policyDecisions.find((event) => {
    const outcome = event.meta?.outcome
    return outcome === "deny" || outcome === "error"
  })
  const policyStages = [
    "global.preValidation",
    "group.preValidation",
    "route.preValidation",
    "beforePipeline",
    "globalPipeline",
    "groupMiddleware",
    "routeMiddleware",
    "validation",
    "global.postValidation",
    "group.postValidation",
    "route.postValidation",
    "beforeHandler",
    "handler",
  ]
  const stoppedStage = stoppedByPolicy
    ? `${String(stoppedByPolicy.meta?.layer)}.${String(stoppedByPolicy.meta?.phase)}`
    : undefined
  const stopIndex = stoppedStage ? policyStages.indexOf(stoppedStage) : -1
  const notReachedStages = stopIndex >= 0 ? policyStages.slice(stopIndex + 1) : []

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
    policyDecisions,
    stoppedByPolicy,
    notReachedStages,
    policyTrace: getPolicyTraceInfo(ctx),
    debugSteps,
    combinedTimeline,
  }
}
