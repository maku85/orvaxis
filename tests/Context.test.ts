import { describe, expect, it } from "vitest"
import { createContext } from "../core/Context"
import type { OrvaxisRequest, OrvaxisResponse } from "../types"

const emptyReq: OrvaxisRequest = { path: "/", method: "GET", headers: {} }
const emptyRes: OrvaxisResponse = {}

describe("createContext", () => {
  it("sets req and res from arguments", () => {
    const req: OrvaxisRequest = { path: "/test", method: "GET", headers: {} }
    const res: OrvaxisResponse = { send: () => {} }

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
