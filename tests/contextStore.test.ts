import { describe, expect, it } from "vitest"
import { Runtime } from "../core/Runtime"
import { getContext } from "../core/contextStore"
import { createMockResponse } from "../core/mockResponse"
import type { OrvaxisRequest } from "../types"

function makeReq(path = "/api/resource"): OrvaxisRequest {
  return { path, method: "GET", headers: {} }
}

function makeRuntime() {
  const runtime = new Runtime()
  runtime.router.group({
    prefix: "/api",
    routes: [{ method: "GET", path: "/resource", handler: async () => {} }],
  })
  return runtime
}

describe("getContext", () => {
  it("returns undefined outside of a request scope", () => {
    expect(getContext()).toBeUndefined()
  })

  it("returns the current ctx inside a handler", async () => {
    const runtime = makeRuntime()
    let captured: unknown

    runtime.router.group({
      prefix: "/ctx",
      routes: [
        {
          method: "GET",
          path: "/check",
          handler: async () => {
            captured = getContext()
          },
        },
      ],
    })

    const ctx = await runtime.execute(makeReq("/ctx/check"), createMockResponse())
    expect(captured).toBe(ctx)
  })

  it("returns the current ctx inside a middleware", async () => {
    const runtime = new Runtime()
    let captured: unknown

    runtime.pipeline.use(async (_ctx, next) => {
      captured = getContext()
      await next()
    })
    runtime.router.group({
      prefix: "/api",
      routes: [{ method: "GET", path: "/resource", handler: async () => {} }],
    })

    const ctx = await runtime.execute(makeReq(), createMockResponse())
    expect(captured).toBe(ctx)
  })

  it("returns the current ctx inside a hook", async () => {
    const runtime = makeRuntime()
    let captured: unknown

    runtime.hooks.on("onRequest", async () => {
      captured = getContext()
    })

    const ctx = await runtime.execute(makeReq(), createMockResponse())
    expect(captured).toBe(ctx)
  })

  it("isolates context between concurrent requests", async () => {
    const runtime = new Runtime()
    const log: string[] = []

    runtime.router.group({
      prefix: "/items",
      routes: [
        {
          method: "GET",
          path: "/:id",
          handler: async (ctx) => {
            const id = ctx.meta.route?.params.id
            await new Promise((r) => setTimeout(r, 10))
            const stored = getContext()
            log.push(`${id}:${stored?.meta.route?.params.id}`)
          },
        },
      ],
    })

    await Promise.all([
      runtime.execute({ path: "/items/a", method: "GET", headers: {} }, createMockResponse()),
      runtime.execute({ path: "/items/b", method: "GET", headers: {} }, createMockResponse()),
    ])

    // Each request must see its own context, not the other's
    expect(log).toContain("a:a")
    expect(log).toContain("b:b")
    expect(log).not.toContain("a:b")
    expect(log).not.toContain("b:a")
  })

  it("returns undefined again after the request scope ends", async () => {
    const runtime = makeRuntime()
    await runtime.execute(makeReq(), createMockResponse())
    expect(getContext()).toBeUndefined()
  })
})
