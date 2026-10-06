import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { enabledFeatures, featureGate, observe, orderScenarios } from "../examples/execution-order"
import { type Middleware, Orvaxis } from "../index"
import { testRequest } from "../testing"

// These tests keep the execution guides honest: the orders printed in the documentation are
// compared with what the runtime does today, and each rule stated in prose has a check here.
const guides = ["execution-model", "routing-and-groups", "middleware-and-hooks"].map((name) => ({
  name,
  text: readFileSync(`docs/guide/${name}.md`, "utf8"),
}))

describe("observed orders in the guides", () => {
  const blocks = guides.flatMap(({ name, text }) =>
    [...text.matchAll(/<!-- observed: (\S+) -->\n```text\n([\s\S]*?)\n```/g)].map((match) => ({
      guide: name,
      id: match[1],
      printed: match[2],
    }))
  )

  it("has at least the scenarios the guides rely on", () => {
    expect(new Set(blocks.map((block) => block.id))).toEqual(
      new Set([
        "success",
        "denied",
        "unauthenticated",
        "short-circuit",
        "handler-error",
        "not-found",
        "not-found-answered",
        "method-not-allowed",
        "options",
      ])
    )
  })

  it.each(
    orderScenarios.map((scenario) => scenario.id)
  )("scenario %s matches the runtime", async (id) => {
    const scenario = orderScenarios.find((candidate) => candidate.id === id)
    if (!scenario) throw new Error("unknown scenario")
    const { events } = await observe(scenario)
    for (const block of blocks.filter((candidate) => candidate.id === id)) {
      expect(block.printed, `${block.guide} (${id})`).toBe(events.join("\n"))
    }
  })

  it("keeps the documented outcomes of each ending", async () => {
    const statuses = Object.fromEntries(
      await Promise.all(orderScenarios.map(async (s) => [s.id, (await observe(s)).status] as const))
    )
    expect(statuses).toMatchObject({
      success: 200,
      denied: 403,
      "short-circuit": 202,
      "handler-error": 500,
      head: 200,
      "not-found": 404,
      "method-not-allowed": 405,
      options: 204,
    })
    const events = async (id: string) =>
      (await observe(orderScenarios.find((s) => s.id === id) ?? orderScenarios[0])).events
    const has = (list: string[], event: string) => list.includes(event)
    for (const [id, afterHandler, afterPipeline, onError] of [
      ["success", true, true, false],
      ["denied", false, false, true],
      ["short-circuit", false, true, false],
      ["handler-error", false, false, true],
      ["not-found-answered", false, true, false],
      ["not-found", false, false, true],
    ] as const) {
      const list = await events(id)
      expect(has(list, "hook afterHandler"), `${id} afterHandler`).toBe(afterHandler)
      expect(has(list, "hook afterPipeline"), `${id} afterPipeline`).toBe(afterPipeline)
      expect(has(list, "hook onError"), `${id} onError`).toBe(onError)
    }
    // onRequest runs before any policy; beforePipeline only after the pre-validation ones.
    const success = await events("success")
    expect(success.indexOf("hook onRequest")).toBeLessThan(success.indexOf("policy global-auth"))
    expect(success.indexOf("policy route-owner")).toBeLessThan(
      success.indexOf("hook beforePipeline")
    )
    expect(success.indexOf("hook onValidation")).toBeLessThan(
      success.indexOf("policy route-post-check")
    )
    expect(success.indexOf("policy route-post-check")).toBeLessThan(
      success.indexOf("hook beforeHandler")
    )
  })
})

describe("routing rules in the guide", () => {
  const handler = (label: string) => (ctx: { res: { json(body: unknown): void } }) =>
    ctx.res.json({ label })

  it("prefers static, then param, then wildcard segments, and captures wildcards", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/users",
      routes: [
        { method: "GET", path: "/me", handler: handler("static") },
        { method: "GET", path: "/:id", handler: handler("param") },
        { method: "GET", path: "/*rest", handler: handler("wildcard") },
      ],
    })
    expect((await testRequest(app, { path: "/users/me" })).body).toEqual({ label: "static" })
    expect((await testRequest(app, { path: "/users/42" })).body).toEqual({ label: "param" })
    const deep = await testRequest(app, { path: "/users/a/b" })
    expect(deep.body).toEqual({ label: "wildcard" })
    expect(deep.ctx?.meta.route?.params).toEqual({ rest: "a/b" })
  })

  it("rejects duplicates, param name conflicts and unknown methods at registration", () => {
    const app = new Orvaxis()
    const route = (method: string, path: string) => ({
      method: method as "GET",
      path,
      handler: () => {},
    })
    app.group({ prefix: "/api", routes: [route("GET", "/users"), route("GET", "/:id")] })
    expect(() => app.group({ prefix: "/api", routes: [route("GET", "/users")] })).toThrow(
      "Duplicate route: GET /api/users"
    )
    expect(() => app.group({ prefix: "/api", routes: [route("GET", "/:userId")] })).toThrow(
      'Route conflict: GET /api/:userId — param ":userId" conflicts with ":id" already registered at this position'
    )
    expect(() => app.group({ prefix: "/api", routes: [route("FETCH", "/x")] })).toThrow(TypeError)
    expect(() => app.group({ prefix: "/api/", routes: [route("GET", "/y")] })).toThrow(TypeError)
    app.group({ prefix: "/v2", routes: [route("GET", "/users")] })
    app.group({ prefix: "/api", routes: [route("POST", "/users")] })
  })

  it("answers HEAD from GET, OPTIONS and 405 with Allow, and lets a dedicated HEAD route win", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [
        { method: "GET", path: "/users", handler: handler("get") },
        { method: "GET", path: "/both", handler: handler("get") },
        { method: "HEAD", path: "/both", handler: (ctx) => ctx.res.status(299).end() },
      ],
    })
    const head = await testRequest(app, { path: "/api/users", method: "HEAD" })
    expect(head.status).toBe(200)
    const dedicated = await testRequest(app, { path: "/api/both", method: "HEAD" })
    expect(dedicated.status).toBe(299)
    const options = await testRequest(app, { path: "/api/users", method: "OPTIONS" })
    expect(options.status).toBe(204)
    expect(options.headers.Allow).toBe("GET, HEAD")
    const wrong = await testRequest(app, { path: "/api/users", method: "POST" })
    expect(wrong.status).toBe(405)
    expect(wrong.headers.Allow).toBe("GET, HEAD")
    expect((await testRequest(app, { path: "/api/nothing" })).status).toBe(404)
  })

  it("lists routes with their full template", () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [{ method: "GET", path: "/orders/:id", handler: () => {} }],
    })
    expect(app.routes()).toEqual([{ method: "GET", path: "/api/orders/:id", prefix: "/api" }])
    expect(app.inspectRoutes()[0]).toMatchObject({
      method: "GET",
      path: "/api/orders/:id",
      policies: [],
    })
  })
})

describe("middleware and hook rules in the guide", () => {
  const layered = (events: string[]) => {
    const mk =
      (name: string): Middleware =>
      async (_ctx, next) => {
        events.push(`${name} before`)
        await next()
        events.push(`${name} after`)
      }
    const app = new Orvaxis()
    app.use(mk("global-1"))
    app.use(mk("global-2"))
    app.group({
      prefix: "/",
      middleware: [mk("group-1"), mk("group-2")],
      routes: [
        {
          method: "GET",
          path: "/x",
          middleware: [mk("route-1")],
          handler: (ctx) => {
            events.push("handler")
            ctx.res.json({})
          },
        },
      ],
    })
    return app
  }

  it("runs each layer as its own chain, with the handler outside every next()", async () => {
    const events: string[] = []
    await testRequest(layered(events), { path: "/x" })
    expect(events.join(", ")).toBe(
      "global-1 before, global-2 before, global-2 after, global-1 after, group-1 before, group-2 before, group-2 after, group-1 after, route-1 before, route-1 after, handler"
    )
  })

  it("treats a second next() as a no-op and lets middleware recover within its layer", async () => {
    const events: string[] = []
    const twice = new Orvaxis()
    twice.use(async (_ctx, next) => {
      await next()
      await next()
      events.push("twice")
    })
    twice.use(async (_ctx, next) => {
      events.push("inner")
      await next()
    })
    twice.group({
      prefix: "/",
      routes: [{ method: "GET", path: "/x", handler: (ctx) => ctx.res.json({}) }],
    })
    expect((await testRequest(twice, { path: "/x" })).status).toBe(200)
    expect(events).toEqual(["inner", "twice"])

    const recovered: string[] = []
    const app = new Orvaxis()
    app.use(async (ctx, next) => {
      try {
        await next()
      } catch (error) {
        recovered.push(`caught ${(error as Error).message}`)
        ctx.res.status(500).json({ recovered: true })
      }
    })
    app.use(async () => {
      throw new Error("boom")
    })
    app.on("onError", () => {
      recovered.push("onError")
    })
    app.on("afterPipeline", () => {
      recovered.push("afterPipeline")
    })
    app.group({ prefix: "/", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
    await testRequest(app, { path: "/x" })
    expect(recovered).toEqual(["caught boom", "afterPipeline"])
  })

  it("reports hook failures, keeps onError failures out of the result and rejects duplicate plugins", async () => {
    const seen: string[] = []
    const app = new Orvaxis()
    app.on("afterHandler", () => {
      throw new Error("hook broke")
    })
    app.on("afterHandler", () => {
      throw new Error("second broke")
    })
    app.on("onError", (_ctx, error) => {
      seen.push(`onError ${error?.constructor.name}`)
    })
    app.group({
      prefix: "/",
      routes: [{ method: "GET", path: "/x", handler: (ctx) => ctx.res.json({}) }],
    })
    const result = await testRequest(app, { path: "/x" })
    expect(result.status).toBe(200)
    expect(seen).toEqual(["onError AggregateError"])

    const answering = new Orvaxis()
    answering.on("onError", (ctx) => {
      ctx.res.status(418).json({ from: "onError" })
    })
    answering.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/x",
          handler: () => {
            throw new Error("boom")
          },
        },
      ],
    })
    const answered = await testRequest(answering, { path: "/x" })
    expect(answered.status).toBe(418)
    expect(answered.error?.message).toBe("boom")

    const plugins = new Orvaxis()
    plugins.register({ name: "p", apply: () => {} })
    expect(() => plugins.register({ name: "p", apply: () => {} })).toThrow(
      'Plugin "p" is already registered'
    )
  })

  it("expresses a feature gate as a policy", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/reports",
          policies: [featureGate("reports")],
          handler: (ctx) => ctx.res.json({ ok: true }),
        },
      ],
    })
    expect((await testRequest(app, { path: "/reports" })).status).toBe(200)
    enabledFeatures.delete("reports")
    try {
      const off = await testRequest(app, { path: "/reports" })
      expect(off.status).toBe(404)
      expect(off.ctx?.meta.trace?.handlerExecuted).toBe(false)
    } finally {
      enabledFeatures.add("reports")
    }
  })
})
