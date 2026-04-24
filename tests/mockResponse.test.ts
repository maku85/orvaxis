import { describe, expect, it } from "vitest"
import { createMockResponse } from "../core/mockResponse"

describe("createMockResponse", () => {
  it("initializes with default values", () => {
    const res = createMockResponse()
    expect(res.statusCode).toBe(200)
    expect(res.sent).toBe(false)
    expect(res.body).toBeUndefined()
    expect(res.sentHeaders).toEqual({})
  })

  it("status() sets statusCode and returns the mock for chaining", () => {
    const res = createMockResponse()
    const returned = res.status(404)
    expect(res.statusCode).toBe(404)
    expect(returned).toBe(res)
  })

  it("json() sets sent=true and stores body", () => {
    const res = createMockResponse()
    res.json({ ok: true })
    expect(res.sent).toBe(true)
    expect(res.body).toEqual({ ok: true })
  })

  it("send() sets sent=true and stores body", () => {
    const res = createMockResponse()
    res.send("hello")
    expect(res.sent).toBe(true)
    expect(res.body).toBe("hello")
  })

  it("setHeader() stores the header and returns the mock for chaining", () => {
    const res = createMockResponse()
    const returned = res.setHeader("Content-Type", "application/json")
    expect(res.sentHeaders["Content-Type"]).toBe("application/json")
    expect(returned).toBe(res)
  })

  it("setHeader() accepts an array value", () => {
    const res = createMockResponse()
    res.setHeader("X-Custom", ["a", "b"])
    expect(res.sentHeaders["X-Custom"]).toEqual(["a", "b"])
  })

  it("status() and json() can be chained", () => {
    const res = createMockResponse()
    res.status(201).json({ created: true })
    expect(res.statusCode).toBe(201)
    expect(res.sent).toBe(true)
    expect(res.body).toEqual({ created: true })
  })
})
