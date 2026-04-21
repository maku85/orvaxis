import { describe, expect, it } from "vitest"
import { validateGroup, validateRequest } from "../core/validation"
import type { Group, OrvaxisRequest } from "../types"

function makeReq(overrides: Partial<OrvaxisRequest> = {}): OrvaxisRequest {
  return { path: "/", method: "GET", headers: {}, ...overrides }
}

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    prefix: "/api",
    routes: [{ method: "GET", path: "/resource", handler: async () => {} }],
    ...overrides,
  }
}

describe("validateRequest", () => {
  it("accepts a valid request", () => {
    expect(() => validateRequest(makeReq())).not.toThrow()
  })

  it("throws 400 when path is empty", () => {
    const err = (() => {
      try {
        validateRequest(makeReq({ path: "" }))
      } catch (e) {
        return e as { message: string; status: number }
      }
    })()
    expect(err?.status).toBe(400)
    expect(err?.message).toMatch(/path/)
  })

  it("throws 400 when path does not start with /", () => {
    const err = (() => {
      try {
        validateRequest(makeReq({ path: "no-slash" }))
      } catch (e) {
        return e as { message: string; status: number }
      }
    })()
    expect(err?.status).toBe(400)
    expect(err?.message).toMatch(/path/)
  })

  it("throws 400 when method is empty", () => {
    const err = (() => {
      try {
        validateRequest(makeReq({ method: "" }))
      } catch (e) {
        return e as { message: string; status: number }
      }
    })()
    expect(err?.status).toBe(400)
    expect(err?.message).toMatch(/method/)
  })
})

describe("validateGroup", () => {
  it("accepts a valid group", () => {
    expect(() => validateGroup(makeGroup())).not.toThrow()
  })

  it("throws when prefix is empty", () => {
    expect(() => validateGroup(makeGroup({ prefix: "" }))).toThrow(TypeError)
  })

  it("throws when prefix does not start with /", () => {
    expect(() => validateGroup(makeGroup({ prefix: "api" }))).toThrow(/start with/)
  })

  it("throws when prefix ends with /", () => {
    expect(() => validateGroup(makeGroup({ prefix: "/api/" }))).toThrow(/end with/)
  })

  it("accepts prefix of exactly /", () => {
    expect(() =>
      validateGroup(makeGroup({ prefix: "/" }))
    ).not.toThrow()
  })

  it("accepts empty route.path (matches prefix exactly)", () => {
    expect(() =>
      validateGroup(
        makeGroup({ routes: [{ method: "GET", path: "", handler: async () => {} }] })
      )
    ).not.toThrow()
  })

  it("throws when route.path is non-empty and does not start with /", () => {
    expect(() =>
      validateGroup(
        makeGroup({ routes: [{ method: "GET", path: "resource", handler: async () => {} }] })
      )
    ).toThrow(/start with/)
  })

  it("throws when route.method is empty", () => {
    expect(() =>
      validateGroup(
        makeGroup({ routes: [{ method: "", path: "/resource", handler: async () => {} }] })
      )
    ).toThrow(/method/)
  })
})
