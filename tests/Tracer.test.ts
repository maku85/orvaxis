import { describe, expect, it } from "vitest"
import { Tracer } from "../core/Tracer"

describe("Tracer", () => {
  it("stores the requestId", () => {
    const tracer = new Tracer("req-123")
    const trace = tracer.end()
    expect(trace.requestId).toBe("req-123")
  })

  it("records startTime on construction", () => {
    const before = Date.now()
    const tracer = new Tracer("id")
    const trace = tracer.end()
    expect(trace.startTime).toBeGreaterThanOrEqual(before)
    expect(trace.startTime).toBeLessThanOrEqual(Date.now())
  })

  it("starts with an empty events array", () => {
    const tracer = new Tracer("id")
    const trace = tracer.end()
    expect(trace.events).toEqual([])
  })

  it("records events with type and timestamp", () => {
    const tracer = new Tracer("id")
    tracer.event("REQUEST_START")
    const trace = tracer.end()

    expect(trace.events).toHaveLength(1)
    expect(trace.events[0].type).toBe("REQUEST_START")
    expect(typeof trace.events[0].timestamp).toBe("number")
  })

  it("records optional meta on events", () => {
    const tracer = new Tracer("id")
    tracer.event("MIDDLEWARE:end", { duration: 42 })
    const trace = tracer.end()

    expect(trace.events[0].meta).toEqual({ duration: 42 })
  })

  it("records events without meta as undefined", () => {
    const tracer = new Tracer("id")
    tracer.event("HOOK:onRequest")
    const trace = tracer.end()

    expect(trace.events[0].meta).toBeUndefined()
  })

  it("records multiple events in order", () => {
    const tracer = new Tracer("id")
    tracer.event("A")
    tracer.event("B")
    tracer.event("C")
    const trace = tracer.end()

    expect(trace.events.map((e) => e.type)).toEqual(["A", "B", "C"])
  })

  it("sets endTime when end() is called", () => {
    const tracer = new Tracer("id")
    const before = Date.now()
    const trace = tracer.end()
    expect(trace.endTime).toBeGreaterThanOrEqual(before)
    expect(trace.endTime).toBeLessThanOrEqual(Date.now())
  })

  it("endTime is >= startTime", () => {
    const tracer = new Tracer("id")
    const trace = tracer.end()
    expect(trace.endTime!).toBeGreaterThanOrEqual(trace.startTime)
  })
})
