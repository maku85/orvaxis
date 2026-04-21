import { describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest } from "../types"

function makeReq(path: string, method = "GET"): OrvaxisRequest {
  return { path, method, url: path, headers: {} }
}

describe("Orvaxis", () => {
  it("handles a request through a registered group", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/v1",
      routes: [
        {
          method: "GET",
          path: "/ping",
          handler: async (ctx) => {
            ctx.state.result = "pong"
          },
        },
      ],
    })

    const ctx = await app.handle(makeReq("/v1/ping"), {})
    expect(ctx.state.result).toBe("pong")
  })

  it("use() adds global middleware (fluent return)", async () => {
    const app = new Orvaxis()
    const order: string[] = []

    app.use(async (_ctx, next) => {
      order.push("mw")
      await next()
    })
    app.group({
      prefix: "/v1",
      routes: [
        {
          method: "GET",
          path: "/x",
          handler: async () => {
            order.push("handler")
          },
        },
      ],
    })

    await app.handle(makeReq("/v1/x"), {})
    expect(order).toEqual(["mw", "handler"])
  })

  it("on() registers hooks that fire during execution", async () => {
    const app = new Orvaxis()
    const fn = vi.fn()

    app.on("onRequest", fn)
    app.group({
      prefix: "/v1",
      routes: [{ method: "GET", path: "/x", handler: async () => {} }],
    })

    await app.handle(makeReq("/v1/x"), {})
    expect(fn).toHaveBeenCalledOnce()
  })

  it("policy() registers a global policy", async () => {
    const app = new Orvaxis()
    app.policy({
      name: "deny-all",
      evaluate: async () => ({ allow: false, reason: "blocked" }),
    })
    app.group({
      prefix: "/v1",
      routes: [{ method: "GET", path: "/x", handler: async () => {} }],
    })

    const err = await app.handle(makeReq("/v1/x"), {}).catch((e) => e)
    expect(err.message).toBe("blocked")
  })

  it("register() applies a plugin via its apply method", async () => {
    const app = new Orvaxis()
    const applied = vi.fn()

    app.register({ name: "my-plugin", apply: applied })
    expect(applied).toHaveBeenCalledOnce()
  })

  it("fluent methods return the Orvaxis instance", () => {
    const app = new Orvaxis()
    expect(app.use(async (_ctx, next) => next())).toBe(app)
    expect(app.on("onRequest", async () => {})).toBe(app)
    expect(app.group({ prefix: "/x", routes: [] })).toBe(app)
    expect(app.policy({ name: "p", evaluate: async () => ({ allow: true }) })).toBe(app)
  })

  it("exposes the debugger from the runtime", () => {
    const app = new Orvaxis()
    expect(app.debugger).toBeDefined()
    expect(typeof app.debugger.enable).toBe("function")
  })
})
