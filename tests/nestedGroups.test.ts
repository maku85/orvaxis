import express from "express"
import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import { createExpressServer } from "../http/expressAdapter"
import { createFastifyServer } from "../http/fastifyAdapter"
import { createNodeServer } from "../http/nodeAdapter"
import type { Middleware, Policy, Route, ServerAdapter } from "../types"

const handler: Route["handler"] = (ctx) => ctx.res.json({ ok: true })

function recorder() {
  const calls: string[] = []
  const policy = (name: string, priority?: number): Policy => ({
    name,
    ...(priority === undefined ? {} : { priority }),
    evaluate: () => {
      calls.push(`policy:${name}`)
      return { allow: true }
    },
  })
  const middleware =
    (name: string): Middleware =>
    async (_ctx, next) => {
      calls.push(`mw:${name}`)
      await next()
    }
  return { calls, policy, middleware }
}

describe("nested groups", () => {
  it("joins prefixes and serves routes at every level", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [{ method: "GET", path: "/top", handler }],
      groups: [
        {
          prefix: "/v1",
          routes: [
            { method: "GET", path: "/users/:id", handler: (c) => c.res.json({ id: c.params.id }) },
          ],
          groups: [{ prefix: "/admin", routes: [{ method: "GET", path: "/stats", handler }] }],
        },
      ],
    })
    expect((await testRequest(app, { path: "/api/top" })).status).toBe(200)
    expect((await testRequest(app, { path: "/api/v1/users/7" })).body).toEqual({ id: "7" })
    expect((await testRequest(app, { path: "/api/v1/admin/stats" })).status).toBe(200)
    expect((await testRequest(app, { path: "/v1/users/7" })).status).toBe(404)
    expect(app.routes().map((r) => `${r.method} ${r.path} [${r.prefix}]`)).toEqual([
      "GET /api/top [/api]",
      "GET /api/v1/users/:id [/api/v1]",
      "GET /api/v1/admin/stats [/api/v1/admin]",
    ])
  })

  it("supports a parent with no routes, a root parent and a root child", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      groups: [
        { prefix: "/a", routes: [{ method: "GET", path: "/x", handler }] },
        { prefix: "/", routes: [{ method: "GET", path: "/same", handler }] },
      ],
    })
    expect((await testRequest(app, { path: "/a/x" })).status).toBe(200)
    expect((await testRequest(app, { path: "/same" })).status).toBe(200)
  })

  it("runs ancestor middleware and policies before the child's, then the route's", async () => {
    const { calls, policy, middleware } = recorder()
    const app = new Orvaxis()
    app.group({
      prefix: "/p",
      policies: [policy("parent")],
      middleware: [middleware("parent")],
      groups: [
        {
          prefix: "/c",
          policies: [policy("child")],
          middleware: [middleware("child")],
          routes: [
            {
              method: "GET",
              path: "/r",
              policies: [policy("route")],
              middleware: [middleware("route")],
              handler: (ctx) => {
                calls.push("handler")
                ctx.res.json({})
              },
            },
          ],
        },
      ],
    })
    await testRequest(app, { path: "/p/c/r" })
    expect(calls).toEqual([
      "policy:parent",
      "policy:child",
      "policy:route",
      "mw:parent",
      "mw:child",
      "mw:route",
      "handler",
    ])
  })

  it("does not apply a child's policies or middleware to its parent's routes or siblings", async () => {
    const { calls, policy, middleware } = recorder()
    const app = new Orvaxis()
    app.group({
      prefix: "/p",
      routes: [{ method: "GET", path: "/own", handler }],
      groups: [
        {
          prefix: "/c",
          policies: [policy("child")],
          middleware: [middleware("child")],
          routes: [{ method: "GET", path: "/r", handler }],
        },
        { prefix: "/s", routes: [{ method: "GET", path: "/r", handler }] },
      ],
    })
    await testRequest(app, { path: "/p/own" })
    await testRequest(app, { path: "/p/s/r" })
    expect(calls).toEqual([])
  })

  it("lets a higher-priority child policy run before the parent's (one layer, ordered by priority)", async () => {
    const { calls, policy } = recorder()
    const app = new Orvaxis()
    app.group({
      prefix: "/p",
      policies: [policy("parent", 0)],
      groups: [
        {
          prefix: "/c",
          policies: [policy("child", 10)],
          routes: [{ method: "GET", path: "/r", handler }],
        },
      ],
    })
    await testRequest(app, { path: "/p/c/r" })
    expect(calls).toEqual(["policy:child", "policy:parent"])
  })

  it("denies from an inherited policy and reports it in inspectRoutes", async () => {
    const app = new Orvaxis()
    const deny: Policy = { name: "deny", evaluate: () => ({ allow: false, status: 403 }) }
    app.group({
      prefix: "/p",
      policies: [deny],
      groups: [{ prefix: "/c", routes: [{ method: "GET", path: "/r", handler }] }],
    })
    expect((await testRequest(app, { path: "/p/c/r" })).status).toBe(403)
    const route = app.inspectRoutes()[0]
    expect(route.path).toBe("/p/c/r")
    expect(route.policies.map((p) => `${p.layer}:${p.name}`)).toEqual(["group:deny"])
  })

  it("counts an ancestor's policy as coverage for denyByDefault", () => {
    const app = new Orvaxis({ denyByDefault: true })
    app.group({
      prefix: "/p",
      policies: [{ name: "ok", evaluate: () => ({ allow: true }) }],
      groups: [{ prefix: "/c", routes: [{ method: "GET", path: "/r", handler }] }],
    })
    expect(app.unprotectedRoutes()).toEqual([])
  })

  it("keeps a top-level group object as declared in the match", async () => {
    const app = new Orvaxis()
    const group = { prefix: "/p", routes: [{ method: "GET" as const, path: "/r", handler }] }
    app.group(group)
    const res = await testRequest(app, { path: "/p/r" })
    expect(res.ctx?.meta.route?.group).toBe(group)
  })

  it("rejects a duplicate route across levels and invalid nested prefixes", () => {
    const dup = new Orvaxis()
    expect(() =>
      dup.group({
        prefix: "/p",
        routes: [{ method: "GET", path: "/c/r", handler }],
        groups: [{ prefix: "/c", routes: [{ method: "GET", path: "/r", handler }] }],
      })
    ).toThrow(/Duplicate route: GET \/p\/c\/r/)

    const app = new Orvaxis()
    expect(() => app.group({ prefix: "/p", groups: [{ prefix: "c", routes: [] }] })).toThrow(
      /must start with '\//
    )
    expect(() => app.group({ prefix: "/p", groups: [{ prefix: "/c/", routes: [] }] })).toThrow(
      /must not end with '\//
    )
  })
})

describe("route settings", () => {
  it("resolves timeout and bodyLimit from route, then nearest group, then parent", () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/p",
      timeout: 1000,
      bodyLimit: 100,
      routes: [{ method: "GET", path: "/own", handler }],
      groups: [
        {
          prefix: "/c",
          timeout: 2000,
          routes: [
            { method: "GET", path: "/inherit", handler },
            { method: "GET", path: "/override", handler, timeout: 0, bodyLimit: 5 },
          ],
        },
      ],
    })
    expect(app.routeSettings({ method: "GET", path: "/p/own" })).toEqual({
      timeout: 1000,
      bodyLimit: 100,
    })
    expect(app.routeSettings({ method: "GET", path: "/p/c/inherit" })).toEqual({
      timeout: 2000,
      bodyLimit: 100,
    })
    expect(app.routeSettings({ method: "GET", path: "/p/c/override" })).toEqual({
      timeout: 0,
      bodyLimit: 5,
    })
    expect(app.routeSettings({ method: "GET", path: "/missing" })).toBeUndefined()
    expect(app.routeSettings({ method: "HEAD", path: "//p//own" })).toEqual({
      timeout: 1000,
      bodyLimit: 100,
    })
  })

  it("is undefined when nothing is configured", () => {
    const app = new Orvaxis()
    app.group({ prefix: "/p", routes: [{ method: "GET", path: "/r", handler }] })
    expect(app.routeSettings({ method: "GET", path: "/p/r" })).toBeUndefined()
  })

  it("rejects invalid values at registration", () => {
    const app = new Orvaxis()
    expect(() => app.group({ prefix: "/p", timeout: -1, routes: [] })).toThrow(/group.timeout/)
    expect(() =>
      app.group({
        prefix: "/q",
        routes: [{ method: "GET", path: "/r", handler, bodyLimit: Number.NaN }],
      })
    ).toThrow(/route.bodyLimit.*GET \/r/)
    expect(() =>
      app.group({ prefix: "/n", groups: [{ prefix: "/c", bodyLimit: "1" as never, routes: [] }] })
    ).toThrow(/group.bodyLimit.*\/n\/c/)
  })
})

type Make = (
  app: Orvaxis,
  adapterOptions: { timeout: number; shutdownTimeout: number }
) => ServerAdapter
const makers: [string, Make][] = [
  ["node", (app, o) => createNodeServer(app, o)],
  ["express", (app, o) => createExpressServer(app, express(), { ...o, bodyParser: {} })],
  ["fastify", (app, o) => createFastifyServer(app, Fastify(), o)],
]

describe.each(makers)("per-route options on the %s adapter", (_name, make) => {
  async function run<T>(app: Orvaxis, adapterTimeout: number, fn: (base: string) => Promise<T>) {
    const adapter = make(app, { timeout: adapterTimeout, shutdownTimeout: 100 })
    let port = 0
    await adapter.listen(0, (p) => {
      port = p
    })
    try {
      return await fn(`http://127.0.0.1:${port}`)
    } finally {
      await adapter.close()
    }
  }

  const slow: Route["handler"] = async (ctx) => {
    await new Promise((r) => setTimeout(r, 150))
    if (!ctx.res.sent) ctx.res.json({ done: true })
  }

  it("applies a route timeout shorter and longer than the adapter's, and 0 to disable", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      routes: [
        { method: "GET", path: "/default", handler: slow },
        { method: "GET", path: "/short", handler: slow, timeout: 30 },
        { method: "GET", path: "/long", handler: slow, timeout: 2000 },
        { method: "GET", path: "/off", handler: slow, timeout: 0 },
      ],
    })
    await run(app, 60, async (base) => {
      expect((await fetch(`${base}/default`)).status).toBe(503)
      expect((await fetch(`${base}/short`)).status).toBe(503)
      expect((await fetch(`${base}/long`)).status).toBe(200)
      expect((await fetch(`${base}/off`)).status).toBe(200)
    })
  })

  it("lowers the body limit for a route and answers 413 before the handler runs", async () => {
    let ran = 0
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      routes: [
        {
          method: "POST",
          path: "/small",
          bodyLimit: 20,
          handler: (ctx) => {
            ran++
            ctx.res.json({})
          },
        },
        { method: "POST", path: "/open", handler: (ctx) => ctx.res.json({}) },
      ],
    })
    await run(app, 0, async (base) => {
      const post = (path: string, body: string) =>
        fetch(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        })
      const big = JSON.stringify({ pad: "x".repeat(100) })
      const rejected = await post("/small", big)
      expect(rejected.status).toBe(413)
      expect(await rejected.json()).toMatchObject({ code: "BODY_TOO_LARGE" })
      expect(ran).toBe(0)
      expect((await post("/small", '{"a":1}')).status).toBe(200)
      expect((await post("/open", big)).status).toBe(200)
    })
  })
})

describe("node adapter per-route bodyLimit above the default", () => {
  it("accepts a larger body on a route that raises the limit and refuses it elsewhere", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      routes: [
        {
          method: "POST",
          path: "/upload",
          bodyLimit: 4096,
          handler: (c) => c.res.json({ n: JSON.stringify(c.req.body).length }),
        },
        { method: "POST", path: "/other", handler: (c) => c.res.json({}) },
      ],
    })
    const adapter = createNodeServer(app, { timeout: 0, bodyLimit: 64 })
    let port = 0
    await adapter.listen(0, (p) => {
      port = p
    })
    try {
      const body = JSON.stringify({ pad: "x".repeat(1000) })
      const post = (path: string) =>
        fetch(`http://127.0.0.1:${port}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        })
      expect((await post("/upload")).status).toBe(200)
      expect((await post("/other")).status).toBe(413)
    } finally {
      await adapter.close()
    }
  })
})
