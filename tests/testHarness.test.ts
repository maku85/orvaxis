import { describe, expect, it } from "vitest"
import { HttpError } from "../core/HttpError"
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
              throw new HttpError(410, "Gone")
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

  describe("query params", () => {
    it("forwards query params onto ctx.req.query", async () => {
      const app = new Orvaxis()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/search",
            handler: async (ctx) => {
              ctx.res.json({ q: ctx.req.query?.q, page: ctx.req.query?.page })
            },
          },
        ],
      })

      const res = await testRequest(app, {
        path: "/api/search",
        query: { q: "orvaxis", page: "2" },
      })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ q: "orvaxis", page: "2" })
    })

    it("ctx.req.query is undefined when not provided", async () => {
      const app = new Orvaxis()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/ping",
            handler: async (ctx) => {
              ctx.res.json({ hasQuery: ctx.req.query !== undefined })
            },
          },
        ],
      })

      const res = await testRequest(app, { path: "/api/ping" })
      expect(res.body).toEqual({ hasQuery: false })
    })

    it("supports array values in query params", async () => {
      const app = new Orvaxis()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/filter",
            handler: async (ctx) => {
              ctx.res.json({ tags: ctx.req.query?.tags })
            },
          },
        ],
      })

      const res = await testRequest(app, {
        path: "/api/filter",
        query: { tags: ["a", "b", "c"] },
      })
      expect(res.body).toEqual({ tags: ["a", "b", "c"] })
    })
  })

  describe("HEAD → GET fallback", () => {
    it("returns 200 and no body for HEAD when a GET route exists", async () => {
      const res = await testRequest(makeApp(), { path: "/api/ping", method: "HEAD" })
      expect(res.status).toBe(200)
      expect(res.body).toBeUndefined()
      expect(res.error).toBeUndefined()
    })

    it("preserves response headers set by the GET handler for HEAD requests", async () => {
      const app = new Orvaxis()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/versioned",
            handler: async (ctx) => {
              ctx.res.setHeader("x-version", "42")
              ctx.res.json({ version: 42 })
            },
          },
        ],
      })

      const res = await testRequest(app, { path: "/api/versioned", method: "HEAD" })
      expect(res.status).toBe(200)
      expect(res.body).toBeUndefined()
      expect(res.headers["x-version"]).toBe("42")
    })

    it("returns 404 for HEAD when no GET route matches", async () => {
      const res = await testRequest(makeApp(), { path: "/api/missing", method: "HEAD" })
      expect(res.status).toBe(404)
    })

    it("a dedicated HEAD route takes priority over the GET fallback", async () => {
      const app = new Orvaxis()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/resource",
            handler: async (ctx) => {
              ctx.res.setHeader("x-source", "get")
              ctx.res.json({})
            },
          },
          {
            method: "HEAD",
            path: "/resource",
            handler: async (ctx) => {
              ctx.res.setHeader("x-source", "head")
              ctx.res.end()
            },
          },
        ],
      })

      const res = await testRequest(app, { path: "/api/resource", method: "HEAD" })
      expect(res.headers["x-source"]).toBe("head")
    })
  })

  describe("streaming", () => {
    it("exposes chunks written via ctx.res.write and ctx.res.end", async () => {
      const app = new Orvaxis()
      app.group({
        prefix: "/stream",
        routes: [
          {
            method: "GET",
            path: "/data",
            handler: async (ctx) => {
              ctx.res.write("chunk1")
              ctx.res.write("chunk2")
              ctx.res.end("final")
            },
          },
        ],
      })

      const res = await testRequest(app, { path: "/stream/data" })
      expect(res.chunks).toEqual(["chunk1", "chunk2", "final"])
      expect(res.ended).toBe(true)
      expect(res.status).toBe(200)
    })
  })
})
