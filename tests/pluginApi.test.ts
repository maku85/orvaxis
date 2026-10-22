import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { Runtime } from "../core/Runtime"
import { testRequest } from "../core/testHarness"
import type { Plugin } from "../plugins/PluginManager"

function app() {
  const a = new Orvaxis()
  a.group({
    prefix: "/api",
    routes: [{ method: "GET", path: "/x", handler: (ctx) => ctx.res.json({ ok: true }) }],
  })
  return a
}

describe("plugin context", () => {
  it("lets a plugin add a global policy and a global middleware", async () => {
    const calls: string[] = []
    const plugin: Plugin = {
      name: "guard",
      apply(ctx) {
        ctx.addPolicy({
          name: "from-plugin",
          evaluate: () => {
            calls.push("policy")
            return { allow: true }
          },
        })
        ctx.use(async (_c, next) => {
          calls.push("middleware")
          await next()
        })
      },
    }
    const a = app().register(plugin)
    expect((await testRequest(a, { path: "/api/x" })).status).toBe(200)
    expect(calls).toEqual(["policy", "middleware"])
    expect(a.inspectRoutes()[0].policies.map((p) => p.name)).toEqual(["from-plugin"])
  })

  it("a policy added by a plugin can deny", async () => {
    const a = app().register({
      name: "deny-all",
      apply: (ctx) => ctx.addPolicy({ name: "deny", evaluate: () => ({ allow: false }) }),
    })
    expect((await testRequest(a, { path: "/api/x" })).status).toBe(403)
  })

  it("does not hand the runtime itself to the plugin", () => {
    let received: object | undefined
    new Runtime().addPlugin({
      name: "probe",
      apply(ctx) {
        received = ctx
      },
    })
    expect(received).not.toHaveProperty("router")
    expect(received).not.toHaveProperty("plugins")
    expect(Object.keys(received ?? {}).sort()).toEqual(["addPolicy", "hooks", "onClose", "use"])
  })
})

describe("plugin dependencies", () => {
  it("rejects a plugin whose dependency is not registered, without applying it", () => {
    let applied = false
    const a = new Orvaxis()
    expect(() =>
      a.register({
        name: "child",
        dependsOn: ["parent"],
        apply() {
          applied = true
        },
      })
    ).toThrow('Plugin "child" depends on "parent", which must be registered first')
    expect(applied).toBe(false)
  })

  it("accepts it once the dependency is registered", () => {
    const a = new Orvaxis()
    a.register({ name: "parent", apply() {} })
    expect(() => a.register({ name: "child", dependsOn: ["parent"], apply() {} })).not.toThrow()
  })

  it("does not list a plugin whose apply throws, so it can be fixed and registered again", () => {
    const runtime = new Runtime()
    expect(() =>
      runtime.addPlugin({
        name: "broken",
        apply() {
          throw new Error("bad config")
        },
      })
    ).toThrow("bad config")
    expect(runtime.plugins.has("broken")).toBe(false)
  })
})

describe("onClose", () => {
  it("runs handlers in reverse registration order, once", async () => {
    const order: string[] = []
    const a = new Orvaxis()
    for (const name of ["a", "b", "c"]) {
      a.register({ name, apply: (ctx) => ctx.onClose(() => void order.push(name)) })
    }
    await a.close()
    await a.close()
    expect(order).toEqual(["c", "b", "a"])
  })

  it("runs every handler even when one throws, then reports the failure", async () => {
    const order: string[] = []
    const a = new Orvaxis()
    a.register({
      name: "ok",
      apply: (ctx) => ctx.onClose(() => void order.push("ok")),
    })
    a.register({
      name: "bad",
      apply: (ctx) =>
        ctx.onClose(() => {
          throw new Error("flush failed")
        }),
    })
    await expect(a.close()).rejects.toThrow("flush failed")
    expect(order).toEqual(["ok"])
  })
})
