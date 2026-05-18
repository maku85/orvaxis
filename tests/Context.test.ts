import { describe, expect, it, vi } from "vitest"
import { createContext } from "../core/Context"
import { createMockResponse } from "../core/mockResponse"
import type { OrvaxisRequest } from "../types"

const emptyReq: OrvaxisRequest = { path: "/", method: "GET", headers: {} }
const emptyRes = createMockResponse()

describe("createContext", () => {
  it("sets req and res from arguments", () => {
    const req: OrvaxisRequest = { path: "/test", method: "GET", headers: {} }
    const res = createMockResponse()

    const ctx = createContext(req, res)

    expect(ctx.req).toBe(req)
    expect(ctx.res).toBe(res)
  })

  it("initialises state as an empty object", () => {
    const ctx = createContext(emptyReq, emptyRes)
    expect(ctx.state).toEqual({})
  })

  it("initialises meta as an empty object", () => {
    const ctx = createContext(emptyReq, emptyRes)
    expect(ctx.meta).toEqual({})
  })

  it("initialises logs as an empty array", () => {
    const ctx = createContext(emptyReq, emptyRes)
    expect(ctx.logs).toEqual([])
  })

  it("does not set an error property", () => {
    const ctx = createContext(emptyReq, emptyRes)
    expect(ctx.error).toBeUndefined()
  })

  it("creates independent state objects for separate contexts", () => {
    const ctx1 = createContext(emptyReq, emptyRes)
    const ctx2 = createContext(emptyReq, emptyRes)

    ctx1.state.x = 1
    expect(ctx2.state.x).toBeUndefined()
  })
})

describe("ctx.logs — bounded array", () => {
  it("is a real array (Array.isArray)", () => {
    const ctx = createContext(emptyReq, emptyRes)
    expect(Array.isArray(ctx.logs)).toBe(true)
  })

  it("accepts pushes up to the cap", () => {
    const ctx = createContext(emptyReq, emptyRes, 3)
    ctx.logs.push("a")
    ctx.logs.push("b")
    ctx.logs.push("c")
    expect(ctx.logs).toEqual(["a", "b", "c"])
  })

  it("drops entries beyond the cap", () => {
    const ctx = createContext(emptyReq, emptyRes, 2)
    ctx.logs.push("a")
    ctx.logs.push("b")
    ctx.logs.push("c")
    expect(ctx.logs).toEqual(["a", "b"])
    expect(ctx.logs.length).toBe(2)
  })

  it("emits console.warn once when the cap is first exceeded", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const ctx = createContext(emptyReq, emptyRes, 1)
    ctx.logs.push("a")
    ctx.logs.push("b")
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain("ctx.logs")
    warnSpy.mockRestore()
  })

  it("warns only once across multiple dropped entries", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const ctx = createContext(emptyReq, emptyRes, 1)
    ctx.logs.push("a")
    ctx.logs.push("b")
    ctx.logs.push("c")
    expect(warnSpy).toHaveBeenCalledOnce()
    warnSpy.mockRestore()
  })

  it("fills up to the cap on a multi-item push that straddles the boundary", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const ctx = createContext(emptyReq, emptyRes, 2)
    ctx.logs.push("a", "b", "c")
    expect(ctx.logs).toEqual(["a", "b"])
    expect(warnSpy).toHaveBeenCalledOnce()
    warnSpy.mockRestore()
  })

  it("respects a custom cap passed to createContext", () => {
    const ctx = createContext(emptyReq, emptyRes, 5)
    for (let i = 0; i < 6; i++) ctx.logs.push(`entry-${i}`)
    expect(ctx.logs.length).toBe(5)
  })
})

describe("ctx.params", () => {
  it("returns an empty object when no route is matched yet", () => {
    const ctx = createContext(emptyReq, emptyRes)
    expect(ctx.params).toEqual({})
  })

  it("returns the route params once meta.route is populated", () => {
    const ctx = createContext(emptyReq, emptyRes)
    ctx.meta.route = {
      route: { method: "GET", path: "/:id", handler: async () => {} },
      group: { prefix: "/", routes: [] },
      params: { id: "abc-123" },
    }
    expect(ctx.params).toEqual({ id: "abc-123" })
  })

  it("reflects live updates when params change", () => {
    const ctx = createContext(emptyReq, emptyRes)
    ctx.meta.route = {
      route: { method: "GET", path: "/:id", handler: async () => {} },
      group: { prefix: "/", routes: [] },
      params: { id: "first" },
    }
    expect(ctx.params.id).toBe("first")
    ctx.meta.route.params = { id: "second" }
    expect(ctx.params.id).toBe("second")
  })
})
