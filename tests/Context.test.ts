import { describe, expect, it } from "vitest"
import { createContext } from "../core/Context"

describe("createContext", () => {
  it("sets req and res from arguments", () => {
    const req = { path: "/test", method: "GET" }
    const res = { send: () => {} }

    const ctx = createContext(req, res)

    expect(ctx.req).toBe(req)
    expect(ctx.res).toBe(res)
  })

  it("initialises state as an empty object", () => {
    const ctx = createContext({}, {})
    expect(ctx.state).toEqual({})
  })

  it("initialises meta as an empty object", () => {
    const ctx = createContext({}, {})
    expect(ctx.meta).toEqual({})
  })

  it("initialises logs as an empty array", () => {
    const ctx = createContext({}, {})
    expect(ctx.logs).toEqual([])
  })

  it("does not set an error property", () => {
    const ctx = createContext({}, {})
    expect(ctx.error).toBeUndefined()
  })

  it("creates independent state objects for separate contexts", () => {
    const ctx1 = createContext({}, {})
    const ctx2 = createContext({}, {})

    ctx1.state.x = 1
    expect(ctx2.state.x).toBeUndefined()
  })
})
