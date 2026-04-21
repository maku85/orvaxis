import { describe, expect, it } from "vitest"
import { buildExecutionSummary } from "../debug/buildExecutionSummary"
import type { DebugEntry, OrvaxisContext, Trace } from "../types"

function makeCtx(
  opts: {
    withDebug?: boolean
    timeline?: DebugEntry[]
    trace?: Partial<Trace>
    route?: OrvaxisContext["meta"]["route"]
  } = {}
): OrvaxisContext {
  const ctx: OrvaxisContext = {
    req: { path: "/", method: "GET", headers: {} },
    res: {},
    state: {},
    meta: {},
    logs: [],
  }

  if (opts.withDebug !== false) {
    ctx.meta.debug = { timeline: opts.timeline ?? [] }
  }

  if (opts.trace) {
    ctx.meta.trace = { requestId: "test", events: [], startTime: 0, ...opts.trace }
  }

  if (opts.route) {
    ctx.meta.route = opts.route
  }

  return ctx
}

describe("buildExecutionSummary", () => {
  it("returns null when ctx.meta.debug is absent", () => {
    const ctx = makeCtx({ withDebug: false })
    expect(buildExecutionSummary(ctx)).toBeNull()
  })

  it("returns an object when ctx.meta.debug is present", () => {
    const ctx = makeCtx()
    expect(buildExecutionSummary(ctx)).not.toBeNull()
  })

  it("includes route from ctx.meta.route", () => {
    const route = { route: { method: "GET", path: "/x", handler: async () => {} }, group: { prefix: "/api", routes: [] }, params: {} }
    const ctx = makeCtx({ route })
    const summary = buildExecutionSummary(ctx)
    expect(summary?.route).toBe(route)
  })

  it("calculates duration from trace start/endTime", () => {
    const ctx = makeCtx({ trace: { startTime: 1000, endTime: 1050 } })
    const summary = buildExecutionSummary(ctx)
    expect(summary?.duration).toBe(50)
  })

  it("sets duration to null when trace is absent", () => {
    const ctx = makeCtx()
    const summary = buildExecutionSummary(ctx)
    expect(summary?.duration).toBeNull()
  })

  it("sets duration to null when endTime is missing", () => {
    const ctx = makeCtx({ trace: { startTime: 1000 } })
    const summary = buildExecutionSummary(ctx)
    expect(summary?.duration).toBeNull()
  })

  it("groups timeline events by the prefix before ':'", () => {
    const ctx = makeCtx({
      timeline: [
        { event: "HOOK:onRequest", time: 1 },
        { event: "HOOK:afterPipeline", time: 2 },
        { event: "PIPELINE_DONE", time: 3 },
      ],
    })

    const summary = buildExecutionSummary(ctx)
    expect(summary?.steps.HOOK).toHaveLength(2)
    expect(summary?.steps.PIPELINE_DONE).toHaveLength(1)
  })

  it("groups events without ':' under their full name", () => {
    const ctx = makeCtx({
      timeline: [
        { event: "REQUEST_START", time: 1 },
        { event: "REQUEST_END", time: 2 },
      ],
    })

    const summary = buildExecutionSummary(ctx)
    expect(summary?.steps.REQUEST_START).toHaveLength(1)
    expect(summary?.steps.REQUEST_END).toHaveLength(1)
  })

  it("returns empty steps when timeline is empty", () => {
    const ctx = makeCtx({ timeline: [] })
    const summary = buildExecutionSummary(ctx)
    expect(summary?.steps).toEqual({})
  })
})
