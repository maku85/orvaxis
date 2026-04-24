import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"

function makeApp() {
  const app = new Orvaxis()
  app.group({
    prefix: "/api",
    routes: [
      {
        method: "GET",
        path: "/ping",
        handler: async (ctx) => {
          ctx.res.status(200).json({ pong: true })
        },
      },
      {
        method: "POST",
        path: "/echo",
        handler: async (ctx) => {
          ctx.res.status(201).json({ received: ctx.req.body })
        },
      },
      {
        method: "GET",
        path: "/header-echo",
        handler: async (ctx) => {
          const token = ctx.req.headers["x-token"]
          ctx.res.setHeader("x-echoed", token as string).json({ ok: true })
        },
      },
    ],
  })
  return app
}

describe("testRequest", () => {
  describe("successful requests", () => {
    it("returns status and body from a matching route", async () => {
      const res = await testRequest(makeApp(), { path: "/api/ping" })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ pong: true })
      expect(res.error).toBeUndefined()
    })

    it("defaults method to GET", async () => {
      const res = await testRequest(makeApp(), { path: "/api/ping" })
      expect(res.status).toBe(200)
    })

    it("forwards extra fields (e.g. body) onto the request", async () => {
      const res = await testRequest(makeApp(), {
        path: "/api/echo",
        method: "POST",
        body: { name: "orvaxis" },
      })
      expect(res.status).toBe(201)
      expect(res.body).toEqual({ received: { name: "orvaxis" } })
    })

    it("forwards custom headers onto the request", async () => {
      const res = await testRequest(makeApp(), {
        path: "/api/header-echo",
        headers: { "x-token": "secret" },
      })
      expect(res.status).toBe(200)
      expect(res.headers["x-echoed"]).toBe("secret")
    })

    it("exposes the full execution context via ctx", async () => {
      const res = await testRequest(makeApp(), { path: "/api/ping" })
      expect(res.ctx).toBeDefined()
      expect(res.ctx?.req.path).toBe("/api/ping")
      expect(res.ctx?.req.method).toBe("GET")
    })
  })

  describe("error paths", () => {
    it("returns status 404 and an error when no route matches", async () => {
      const res = await testRequest(makeApp(), { path: "/not-found" })
      expect(res.status).toBe(404)
      expect(res.error).toBeDefined()
      expect(res.error?.message).toBe("Not Found")
      expect(res.ctx).toBeUndefined()
    })

    it("returns status 403 when a policy blocks the request", async () => {
      const app = new Orvaxis()
      app.policy({ name: "blocker", evaluate: async () => ({ allow: false, reason: "Forbidden" }) })
      app.group({
        prefix: "/secure",
        routes: [{ method: "GET", path: "/data", handler: async () => {} }],
      })

      const res = await testRequest(app, { path: "/secure/data" })
      expect(res.status).toBe(403)
      expect(res.error?.message).toBe("Forbidden")
    })

    it("reflects a custom error status from a thrown error", async () => {
      const app = new Orvaxis()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/fail",
            handler: async () => {
              throw Object.assign(new Error("Gone"), { status: 410 })
            },
          },
        ],
      })

      const res = await testRequest(app, { path: "/api/fail" })
      expect(res.status).toBe(410)
      expect(res.error?.message).toBe("Gone")
    })

    it("does not throw even when the handler throws", async () => {
      const app = new Orvaxis()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/boom",
            handler: async () => {
              throw new Error("unexpected")
            },
          },
        ],
      })

      await expect(testRequest(app, { path: "/api/boom" })).resolves.not.toThrow()
      const res = await testRequest(app, { path: "/api/boom" })
      expect(res.error?.message).toBe("unexpected")
    })
  })

  describe("request id", () => {
    it("forwards a custom request id to the trace", async () => {
      const res = await testRequest(makeApp(), { path: "/api/ping", id: "req-abc" })
      expect(res.ctx?.meta.trace?.requestId).toBe("req-abc")
    })
  })
})
