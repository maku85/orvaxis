import { describe, expect, it } from "vitest"
import { createMockResponse } from "../core/mockResponse"
import { buildExecutionSummary } from "../debug/buildExecutionSummary"
import type { DebugEntry, OrvaxisContext, Trace, TraceEvent } from "../types"

function makeCtx(
  opts: {
    withDebug?: boolean
    timeline?: DebugEntry[]
    trace?: Partial<Trace>
    traceEvents?: TraceEvent[]
    route?: OrvaxisContext["meta"]["route"]
  } = {}
): OrvaxisContext {
  const ctx: OrvaxisContext = {
    req: { path: "/", method: "GET", headers: {} },
    res: createMockResponse(),
    state: {},
    meta: {},
    logs: [],
  }

  if (opts.withDebug !== false) {
    ctx.meta.debug = { timeline: opts.timeline ?? [] }
  }

  if (opts.trace || opts.traceEvents) {
    ctx.meta.trace = {
      requestId: "test",
      events: opts.traceEvents ?? [],
      startTime: 0,
      ...opts.trace,
    }
  }

  if (opts.route) {
    ctx.meta.route = opts.route
  }

  return ctx
}

describe("buildExecutionSummary", () => {
  it("always returns an object, even without debug or trace", () => {
    const ctx = makeCtx({ withDebug: false })
    expect(buildExecutionSummary(ctx)).not.toBeNull()
  })

  it("includes requestId from trace", () => {
    const ctx = makeCtx({ trace: { requestId: "req-42", startTime: 0 } })
    expect(buildExecutionSummary(ctx).requestId).toBe("req-42")
  })

  it("requestId is undefined when trace is absent", () => {
    const ctx = makeCtx({ withDebug: false })
    expect(buildExecutionSummary(ctx).requestId).toBeUndefined()
  })

  it("includes route from ctx.meta.route", () => {
    const route = {
      route: { method: "GET", path: "/x", handler: async () => {} },
      group: { prefix: "/api", routes: [] },
      params: {},
    }
    const ctx = makeCtx({ route })
    expect(buildExecutionSummary(ctx).route).toBe(route)
  })

  it("calculates duration from trace start/endTime", () => {
    const ctx = makeCtx({ trace: { startTime: 1000, endTime: 1050 } })
    expect(buildExecutionSummary(ctx).duration).toBe(50)
  })

  it("sets duration to null when trace is absent", () => {
    const ctx = makeCtx({ withDebug: false })
    expect(buildExecutionSummary(ctx).duration).toBeNull()
  })

  it("sets duration to null when endTime is missing", () => {
    const ctx = makeCtx({ trace: { startTime: 1000 } })
    expect(buildExecutionSummary(ctx).duration).toBeNull()
  })

  it("includes traceEvents from ctx.meta.trace.events", () => {
    const events: TraceEvent[] = [
      { type: "MIDDLEWARE:start", timestamp: 1 },
      { type: "MIDDLEWARE:end", timestamp: 2, meta: { duration: 1 } },
    ]
    const ctx = makeCtx({ traceEvents: events })
    expect(buildExecutionSummary(ctx).traceEvents).toEqual(events)
  })

  it("traceEvents is empty when trace is absent", () => {
    const ctx = makeCtx({ withDebug: false })
    expect(buildExecutionSummary(ctx).traceEvents).toEqual([])
  })

  it("groups debug timeline events by the prefix before ':'", () => {
    const ctx = makeCtx({
      timeline: [
        { event: "HOOK:onRequest", time: 1 },
        { event: "HOOK:afterPipeline", time: 2 },
        { event: "PIPELINE_DONE", time: 3 },
      ],
    })

    const { debugSteps } = buildExecutionSummary(ctx)
    expect(debugSteps.HOOK).toHaveLength(2)
    expect(debugSteps.PIPELINE_DONE).toHaveLength(1)
  })

  it("groups events without ':' under their full name", () => {
    const ctx = makeCtx({
      timeline: [
        { event: "REQUEST_START", time: 1 },
        { event: "REQUEST_END", time: 2 },
      ],
    })

    const { debugSteps } = buildExecutionSummary(ctx)
    expect(debugSteps.REQUEST_START).toHaveLength(1)
    expect(debugSteps.REQUEST_END).toHaveLength(1)
  })

  it("returns empty debugSteps when debug is not enabled", () => {
    const ctx = makeCtx({ withDebug: false })
    expect(buildExecutionSummary(ctx).debugSteps).toEqual({})
  })

  it("returns empty debugSteps when timeline is empty", () => {
    const ctx = makeCtx({ timeline: [] })
    expect(buildExecutionSummary(ctx).debugSteps).toEqual({})
  })
})
