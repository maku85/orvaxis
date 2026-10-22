import express from "express"
import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import { createExpressServer } from "../http/expressAdapter"
import { createFastifyServer } from "../http/fastifyAdapter"
import type { Policy, Route } from "../types"

const allow: Policy = { name: "allow", evaluate: () => ({ allow: true }) }
const handler: Route["handler"] = (ctx) => ctx.res.json({ ok: true })

function app(options?: { denyByDefault?: boolean }) {
  const a = new Orvaxis(options)
  a.group({
    prefix: "/api",
    routes: [
      { method: "GET", path: "/guarded", handler, policies: [allow] },
      { method: "GET", path: "/open", handler, public: true },
      { method: "GET", path: "/forgotten", handler },
    ],
  })
  return a
}

describe("unprotectedRoutes / assertProtected", () => {
  it("lists only routes that are neither public nor covered", () => {
    expect(app().unprotectedRoutes()).toEqual([
      { method: "GET", path: "/api/forgotten", prefix: "/api" },
    ])
  })

  it("assertProtected names every unprotected route and the fix", () => {
    expect(() => app().assertProtected()).toThrow(/GET \/api\/forgotten.*public: true/)
  })

  it("is satisfied by a global, group or route policy that always applies", () => {
    const global = app()
    global.policy(allow)
    expect(global.unprotectedRoutes()).toEqual([])

    const grouped = new Orvaxis()
    grouped.group({
      prefix: "/g",
      policies: [allow],
      routes: [{ method: "GET", path: "/x", handler }],
    })
    expect(grouped.unprotectedRoutes()).toEqual([])
  })

  it("does not count a policy scoped to a different path or whose scope depends on the request", () => {
    const a = new Orvaxis()
    a.policy({ name: "admin-only", scope: { path: "/admin" }, evaluate: () => ({ allow: true }) })
    a.policy({
      name: "dynamic",
      scope: { path: (p: string) => p.startsWith("/api") },
      evaluate: () => ({ allow: true }),
    })
    a.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler }] })
    expect(a.unprotectedRoutes()).toHaveLength(1)
  })

  it("counts a global policy whose scope statically matches the route", () => {
    const a = new Orvaxis()
    a.policy({ name: "api", scope: { path: "/api" }, evaluate: () => ({ allow: true }) })
    a.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler }] })
    expect(a.unprotectedRoutes()).toEqual([])
  })

  it("reports public routes in inspectRoutes", () => {
    const open = app()
      .inspectRoutes()
      .find((r) => r.path === "/api/open")
    expect(open?.public).toBe(true)
  })
})

describe("denyByDefault at request time", () => {
  it("runs covered and public routes and refuses an unprotected one without running its handler", async () => {
    const a = new Orvaxis({ denyByDefault: true })
    let ran = false
    a.group({
      prefix: "/api",
      routes: [
        { method: "GET", path: "/guarded", handler, policies: [allow] },
        { method: "GET", path: "/open", handler, public: true },
        {
          method: "GET",
          path: "/forgotten",
          handler: (ctx) => {
            ran = true
            ctx.res.json({})
          },
        },
      ],
    })
    expect((await testRequest(a, { path: "/api/guarded" })).status).toBe(200)
    expect((await testRequest(a, { path: "/api/open" })).status).toBe(200)
    const refused = await testRequest(a, { path: "/api/forgotten" })
    expect(refused.status).toBe(500)
    expect(refused.error).toMatchObject({ code: "ROUTE_UNPROTECTED" })
    expect(ran).toBe(false)
  })

  it("is off by default", async () => {
    expect((await testRequest(app(), { path: "/api/forgotten" })).status).toBe(200)
  })

  it("notices a policy added after the first request", async () => {
    const a = new Orvaxis({ denyByDefault: true })
    a.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler }] })
    expect((await testRequest(a, { path: "/api/x" })).status).toBe(500)
    a.policy(allow)
    expect((await testRequest(a, { path: "/api/x" })).status).toBe(200)
  })

  it("also applies to the policy-only authorize() used by the Express guard", async () => {
    const a = new Orvaxis({ denyByDefault: true })
    a.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler }] })
    await expect(
      a.authorize(
        { path: "/api/x", method: "GET", headers: {} },
        (await import("../core/mockResponse")).createMockResponse()
      )
    ).rejects.toMatchObject({ status: 500 })
  })

  it("is not applied to public routes' global policies: public only waives the requirement", async () => {
    const a = new Orvaxis({ denyByDefault: true })
    a.policy({ name: "deny", evaluate: () => ({ allow: false, status: 401 }) })
    a.group({ prefix: "/", routes: [{ method: "GET", path: "/health", handler, public: true }] })
    expect((await testRequest(a, { path: "/health" })).status).toBe(401)
  })
})

describe("denyByDefault at startup", () => {
  it("makes the Express adapter reject listen() and name the route", async () => {
    const server = createExpressServer(app({ denyByDefault: true }), express())
    await expect(server.listen(0)).rejects.toThrow(/GET \/api\/forgotten/)
  })

  it("makes the Fastify adapter reject listen() and name the route", async () => {
    const server = createFastifyServer(app({ denyByDefault: true }), Fastify())
    await expect(server.listen(0)).rejects.toThrow(/GET \/api\/forgotten/)
  })

  it("lets a fully covered app listen", async () => {
    const a = new Orvaxis({ denyByDefault: true })
    a.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler, policies: [allow] }] })
    const server = createExpressServer(a, express())
    await server.listen(0)
    await server.close()
  })

  it("does nothing at listen() when the option is off", async () => {
    const server = createExpressServer(app(), express())
    await server.listen(0)
    await server.close()
  })
})
