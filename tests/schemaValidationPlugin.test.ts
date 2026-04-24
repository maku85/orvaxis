import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { schemaValidationPlugin } from "../plugins/schemaValidationPlugin"
import { testRequest } from "../core/testHarness"
import type { SchemaField } from "../types"

// Minimal schema helpers — no external library required
const pass = (value?: unknown): SchemaField => ({ parse: (d) => value ?? d })
const coerce = (fn: (d: unknown) => unknown): SchemaField => ({ parse: fn })
const fail = (msg = "invalid"): SchemaField => ({
  parse: () => {
    throw new Error(msg)
  },
})

function makeApp() {
  const app = new Orvaxis()
  app.register(schemaValidationPlugin)
  return app
}

describe("schemaValidationPlugin", () => {
  describe("no-op when schema is absent", () => {
    it("does not interfere with routes that have no schema", async () => {
      const app = makeApp()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/ping",
            handler: async (ctx) => ctx.res.json({ ok: true }),
          },
        ],
      })

      const res = await testRequest(app, { path: "/api/ping" })
      expect(res.status).toBe(200)
      expect(res.error).toBeUndefined()
    })
  })

  describe("body validation", () => {
    it("passes the parsed body value back onto ctx.req.body", async () => {
      const app = makeApp()
      let seen: unknown

      app.group({
        prefix: "/api",
        routes: [
          {
            method: "POST",
            path: "/items",
            schema: { body: coerce((d) => ({ ...( d as object), extra: true })) },
            handler: async (ctx) => {
              seen = ctx.req.body
              ctx.res.json({ ok: true })
            },
          },
        ],
      })

      await testRequest(app, { path: "/api/items", method: "POST", body: { name: "x" } })
      expect(seen).toEqual({ name: "x", extra: true })
    })

    it("returns 422 with field='body' when body validation fails", async () => {
      const app = makeApp()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "POST",
            path: "/items",
            schema: { body: fail("bad body") },
            handler: async (ctx) => ctx.res.json({ ok: true }),
          },
        ],
      })

      const res = await testRequest(app, { path: "/api/items", method: "POST", body: {} })
      expect(res.status).toBe(422)
      expect((res.error as { field?: string })?.field).toBe("body")
      expect(res.error?.message).toMatch(/body/)
    })
  })

  describe("params validation", () => {
    it("passes the parsed params back onto ctx.meta.route.params", async () => {
      const app = makeApp()
      let seen: unknown

      app.group({
        prefix: "/users",
        routes: [
          {
            method: "GET",
            path: "/:id",
            schema: { params: pass({ id: "coerced" }) },
            handler: async (ctx) => {
              seen = ctx.meta.route?.params
              ctx.res.json({ ok: true })
            },
          },
        ],
      })

      await testRequest(app, { path: "/users/42" })
      expect(seen).toEqual({ id: "coerced" })
    })

    it("returns 422 with field='params' when params validation fails", async () => {
      const app = makeApp()
      app.group({
        prefix: "/users",
        routes: [
          {
            method: "GET",
            path: "/:id",
            schema: { params: fail("bad params") },
            handler: async (ctx) => ctx.res.json({ ok: true }),
          },
        ],
      })

      const res = await testRequest(app, { path: "/users/abc" })
      expect(res.status).toBe(422)
      expect((res.error as { field?: string })?.field).toBe("params")
    })
  })

  describe("query validation", () => {
    it("passes the parsed query back onto ctx.req.query", async () => {
      const app = makeApp()
      let seen: unknown

      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/search",
            schema: { query: coerce((d) => ({ ...( d as object), page: 1 })) },
            handler: async (ctx) => {
              seen = ctx.req.query
              ctx.res.json({ ok: true })
            },
          },
        ],
      })

      await testRequest(app, { path: "/api/search", query: { q: "test" } })
      expect(seen).toEqual({ q: "test", page: 1 })
    })

    it("returns 422 with field='query' when query validation fails", async () => {
      const app = makeApp()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/search",
            schema: { query: fail("bad query") },
            handler: async (ctx) => ctx.res.json({ ok: true }),
          },
        ],
      })

      const res = await testRequest(app, { path: "/api/search" })
      expect(res.status).toBe(422)
      expect((res.error as { field?: string })?.field).toBe("query")
    })
  })

  describe("headers validation", () => {
    it("passes when headers are valid", async () => {
      const app = makeApp()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/secure",
            schema: { headers: pass() },
            handler: async (ctx) => ctx.res.json({ ok: true }),
          },
        ],
      })

      const res = await testRequest(app, {
        path: "/api/secure",
        headers: { authorization: "Bearer token" },
      })
      expect(res.status).toBe(200)
    })

    it("returns 422 with field='headers' when headers validation fails", async () => {
      const app = makeApp()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/secure",
            schema: { headers: fail("missing authorization") },
            handler: async (ctx) => ctx.res.json({ ok: true }),
          },
        ],
      })

      const res = await testRequest(app, { path: "/api/secure" })
      expect(res.status).toBe(422)
      expect((res.error as { field?: string })?.field).toBe("headers")
    })
  })

  describe("cause forwarding", () => {
    it("attaches the original validation error as cause", async () => {
      const originalError = new Error("schema mismatch")
      const app = makeApp()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "POST",
            path: "/items",
            schema: {
              body: {
                parse: () => {
                  throw originalError
                },
              },
            },
            handler: async (ctx) => ctx.res.json({ ok: true }),
          },
        ],
      })

      const res = await testRequest(app, { path: "/api/items", method: "POST", body: {} })
      expect((res.error as { cause?: unknown })?.cause).toBe(originalError)
    })
  })

  describe("plugin not registered", () => {
    it("schema on route is silently ignored when plugin is not registered", async () => {
      const app = new Orvaxis() // no schemaValidationPlugin
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "POST",
            path: "/items",
            schema: { body: fail("should not run") },
            handler: async (ctx) => ctx.res.json({ ok: true }),
          },
        ],
      })

      const res = await testRequest(app, { path: "/api/items", method: "POST", body: {} })
      expect(res.status).toBe(200)
      expect(res.error).toBeUndefined()
    })
  })
})
