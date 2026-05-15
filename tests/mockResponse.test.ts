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

  describe("streaming", () => {
    it("write() appends chunks and sets sent=true", () => {
      const res = createMockResponse()
      res.write("hello")
      res.write(" world")
      expect(res.sent).toBe(true)
      expect(res.chunks).toEqual(["hello", " world"])
      expect(res.ended).toBe(false)
    })

    it("end() sets ended=true and sent=true", () => {
      const res = createMockResponse()
      res.end()
      expect(res.sent).toBe(true)
      expect(res.ended).toBe(true)
      expect(res.chunks).toEqual([])
    })

    it("end(chunk) appends the final chunk before closing", () => {
      const res = createMockResponse()
      res.write("part1")
      res.end("done")
      expect(res.chunks).toEqual(["part1", "done"])
      expect(res.ended).toBe(true)
    })

    it("pipe() stores the stream and sets sent=true", () => {
      const { Readable } = require("node:stream")
      const res = createMockResponse()
      const stream = new Readable({ read() {} })
      res.pipe(stream)
      expect(res.sent).toBe(true)
      expect(res.piped).toBe(stream)
    })

    it("initializes chunks as empty array and ended as false", () => {
      const res = createMockResponse()
      expect(res.chunks).toEqual([])
      expect(res.ended).toBe(false)
      expect(res.piped).toBeNull()
    })
  })
})
