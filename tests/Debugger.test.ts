import { describe, expect, it } from "vitest"
import { Debugger } from "../core/Debugger"
import type { OrvaxisContext } from "../types"

function makeCtx(): OrvaxisContext {
  return {
    req: { path: "/", method: "GET", headers: {} },
    res: {},
    state: {},
    meta: {},
    logs: [],
  }
}

describe("Debugger", () => {
  it("starts disabled", () => {
    const dbg = new Debugger()
    expect(dbg.enabled).toBe(false)
  })

  it("becomes enabled after enable()", () => {
    const dbg = new Debugger()
    dbg.enable()
    expect(dbg.enabled).toBe(true)
  })

  it("does not write to ctx when disabled", () => {
    const dbg = new Debugger()
    const ctx = makeCtx()
    dbg.log(ctx, "REQUEST_START")
    expect(ctx.meta.debug).toBeUndefined()
  })

  it("initialises timeline array on first log when enabled", () => {
    const dbg = new Debugger()
    dbg.enable()
    const ctx = makeCtx()
    dbg.log(ctx, "REQUEST_START")

    expect(ctx.meta.debug).toBeDefined()
    expect(Array.isArray(ctx.meta.debug?.timeline)).toBe(true)
  })

  it("appends an entry with event name and time", () => {
    const dbg = new Debugger()
    dbg.enable()
    const ctx = makeCtx()
    const before = Date.now()
    dbg.log(ctx, "PIPELINE_DONE")

    const entry = ctx.meta.debug?.timeline[0]
    expect(entry?.event).toBe("PIPELINE_DONE")
    expect(entry?.time).toBeGreaterThanOrEqual(before)
  })

  it("stores optional meta on timeline entries", () => {
    const dbg = new Debugger()
    dbg.enable()
    const ctx = makeCtx()
    dbg.log(ctx, "ERROR", { error: "oops" })

    expect(ctx.meta.debug?.timeline[0].meta).toEqual({ error: "oops" })
  })

  it("accumulates multiple entries in order", () => {
    const dbg = new Debugger()
    dbg.enable()
    const ctx = makeCtx()

    dbg.log(ctx, "A")
    dbg.log(ctx, "B")
    dbg.log(ctx, "C")

    expect(ctx.meta.debug?.timeline.map((e) => e.event)).toEqual(["A", "B", "C"])
  })

  it("reuses existing debug object across calls", () => {
    const dbg = new Debugger()
    dbg.enable()
    const ctx = makeCtx()

    dbg.log(ctx, "first")
    const ref = ctx.meta.debug
    dbg.log(ctx, "second")

    expect(ctx.meta.debug).toBe(ref)
  })
})
