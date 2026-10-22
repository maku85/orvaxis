import { describe, expect, it } from "vitest"
import { HttpError } from "../core/HttpError"
import { createMockResponse } from "../core/mockResponse"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import type { Policy } from "../types"

function build(calls: string[]) {
  const app = new Orvaxis()
  app.on("onRequest", () => {
    calls.push("onRequest")
  })
  const gate: Policy = {
    name: "needs-user",
    evaluate(ctx) {
      calls.push(`policy:${String(ctx.identity?.userId)}`)
      return ctx.identity
        ? { allow: true }
        : { allow: false, status: 401, reason: "Authentication required" }
    },
  }
  app.policy(gate)
  app.group({
    prefix: "/api",
    routes: [
      {
        method: "GET",
        path: "/me",
        handler: (ctx) => {
          calls.push("handler")
          ctx.res.json({ user: ctx.identity?.userId })
        },
      },
    ],
  })
  return app
}

describe("app.authenticate()", () => {
  it("runs after routing and before policies, and exposes ctx.identity", async () => {
    const calls: string[] = []
    const app = build(calls)
    app.authenticate((ctx) => {
      calls.push("authenticate")
      return { userId: ctx.req.headers["x-user"] }
    })
    const res = await testRequest(app, { path: "/api/me", headers: { "x-user": "alice" } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user: "alice" })
    expect(calls).toEqual(["onRequest", "authenticate", "policy:alice", "handler"])
  })

  it("does not run for unmatched routes", async () => {
    const calls: string[] = []
    const app = build(calls)
    app.authenticate(() => {
      calls.push("authenticate")
      return { userId: "x" }
    })
    const res = await testRequest(app, { path: "/nope" })
    expect(res.status).toBe(404)
    expect(calls).not.toContain("authenticate")
  })

  it("leaves identity undefined for an anonymous caller and lets policies decide", async () => {
    const calls: string[] = []
    const app = build(calls)
    app.authenticate(() => null)
    const res = await testRequest(app, { path: "/api/me" })
    expect(res.status).toBe(401)
    expect(calls).not.toContain("handler")
    expect(res.ctx?.identity).toBeUndefined()
  })

  it("stops the request when the authenticator throws, without running policies or handler", async () => {
    const calls: string[] = []
    const app = build(calls)
    app.authenticate(() => {
      throw new HttpError(401, "Invalid token")
    })
    const res = await testRequest(app, { path: "/api/me" })
    expect(res.status).toBe(401)
    expect(calls).toEqual(["onRequest"])
  })

  it("accepts an async authenticator", async () => {
    const app = build([])
    app.authenticate(async () => ({ userId: "bob" }))
    const res = await testRequest(app, { path: "/api/me" })
    expect(res.body).toEqual({ user: "bob" })
  })

  it("records an AUTHENTICATE trace event without identity values", async () => {
    const app = build([])
    app.authenticate(() => ({ userId: "secret-user" }))
    const res = await testRequest(app, { path: "/api/me" })
    const event = res.ctx?.meta.trace?.events.find((e) => e.type === "AUTHENTICATE")
    expect(event?.meta).toEqual({ outcome: "identified" })
  })

  it("records the error outcome when it throws", async () => {
    const app = build([])
    app.authenticate(() => {
      throw new HttpError(401, "no")
    })
    const res = await testRequest(app, { path: "/api/me" })
    const event = res.ctx?.meta.trace?.events.find((e) => e.type === "AUTHENTICATE")
    expect(event?.meta).toEqual({ outcome: "error", errorName: "HttpError" })
  })

  it("rejects a second authenticator and non-functions", () => {
    const app = new Orvaxis()
    app.authenticate(() => null)
    expect(() => app.authenticate(() => null)).toThrow(/already registered/)
    expect(() => new Orvaxis().authenticate(undefined as never)).toThrow(TypeError)
  })

  it("is also applied by authorize(), used by the Express policy guard", async () => {
    const calls: string[] = []
    const app = build(calls)
    app.authenticate(() => ({ userId: "carol" }))
    const ctx = await app.authorize(
      { path: "/api/me", method: "GET", headers: {} },
      createMockResponse()
    )
    expect(ctx.identity?.userId).toBe("carol")
    expect(calls).toEqual(["policy:carol"])
  })

  it("is not required: without it ctx.identity stays undefined", async () => {
    const res = await testRequest(build([]), { path: "/api/me" })
    expect(res.status).toBe(401)
  })
})
