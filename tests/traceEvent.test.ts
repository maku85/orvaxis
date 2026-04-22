import { describe, expect, it } from "vitest"
import { Runtime } from "../core/Runtime"
import { createMockResponse } from "../core/mockResponse"
import { traceEvent } from "../debug/traceEvent"
import type { OrvaxisRequest } from "../types"

function makeReq(path = "/api/resource"): OrvaxisRequest {
  return { path, method: "GET", headers: {} }
}

describe("traceEvent", () => {
  it("does nothing when called outside a request scope", () => {
    expect(() => traceEvent("CUSTOM_EVENT")).not.toThrow()
  })

  it("emits an event into ctx.meta.trace from inside a handler", async () => {
    const runtime = new Runtime()

    runtime.router.group({
      prefix: "/api",
      routes: [
        {
          method: "GET",
          path: "/resource",
          handler: async () => {
            traceEvent("CUSTOM:db_query", { table: "users" })
          },
        },
      ],
    })

    const ctx = await runtime.execute(makeReq(), createMockResponse())
    const events = ctx.meta.trace?.events ?? []
    const custom = events.find((e) => e.type === "CUSTOM:db_query")

    expect(custom).toBeDefined()
    expect(custom?.meta).toEqual({ table: "users" })
  })

  it("emits an event from inside a middleware", async () => {
    const runtime = new Runtime()

    runtime.pipeline.use(async (_ctx, next) => {
      traceEvent("MW:before")
      await next()
      traceEvent("MW:after")
    })

    runtime.router.group({
      prefix: "/api",
      routes: [{ method: "GET", path: "/resource", handler: async () => {} }],
    })

    const ctx = await runtime.execute(makeReq(), createMockResponse())
    const types = (ctx.meta.trace?.events ?? []).map((e) => e.type)

    expect(types).toContain("MW:before")
    expect(types).toContain("MW:after")
  })

  it("does not emit when called after the request scope ends", async () => {
    const runtime = new Runtime()
    runtime.router.group({
      prefix: "/api",
      routes: [{ method: "GET", path: "/resource", handler: async () => {} }],
    })

    const ctx = await runtime.execute(makeReq(), createMockResponse())
    const countBefore = ctx.meta.trace?.events.length ?? 0

    traceEvent("LATE_EVENT")

    expect(ctx.meta.trace?.events.length).toBe(countBefore)
  })
})
