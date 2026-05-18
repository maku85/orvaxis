import { describe, expect, it, vi } from "vitest"
import { Runtime } from "../core/Runtime"
import type { Plugin } from "../plugins/PluginManager"
import { PluginManager } from "../plugins/PluginManager"
import type { PluginContext } from "../types"

function makePlugin(name: string, apply = vi.fn()): Plugin {
  return { name, apply }
}

describe("PluginManager", () => {
  it("register adds the plugin to the list", () => {
    const manager = new PluginManager()
    const plugin = makePlugin("test")

    manager.register(plugin)

    expect(manager.list()).toContain(plugin)
  })

  it("list returns plugins in registration order", () => {
    const manager = new PluginManager()
    const first = makePlugin("first")
    const second = makePlugin("second")

    manager.register(first)
    manager.register(second)

    expect(manager.list()).toEqual([first, second])
  })

  it("does nothing when no plugins are registered", () => {
    const manager = new PluginManager()
    expect(manager.list()).toHaveLength(0)
  })

  it("throws TypeError when a plugin with the same name is registered twice", () => {
    const manager = new PluginManager()
    manager.register(makePlugin("my-plugin"))
    expect(() => manager.register(makePlugin("my-plugin"))).toThrow(
      'Plugin "my-plugin" is already registered'
    )
  })

  it("allows plugins with different names", () => {
    const manager = new PluginManager()
    manager.register(makePlugin("plugin-a"))
    manager.register(makePlugin("plugin-b"))
    expect(manager.list()).toHaveLength(2)
  })
})

describe("Runtime.addPlugin", () => {
  it("applies the plugin immediately", () => {
    const runtime = new Runtime()
    const apply = vi.fn()

    runtime.addPlugin({ name: "p", apply })

    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith(runtime)
  })

  it("plugin with explicit PluginContext annotation can register hooks", async () => {
    const runtime = new Runtime()
    let triggered = false

    const plugin: Plugin = {
      name: "typed",
      apply(ctx: PluginContext) {
        ctx.hooks.on("onRequest", () => {
          triggered = true
        })
      },
    }

    runtime.addPlugin(plugin)
    await runtime.hooks.trigger("onRequest", {} as Parameters<typeof runtime.hooks.trigger>[1])
    expect(triggered).toBe(true)
  })

  it("tracks the plugin in runtime.plugins", () => {
    const runtime = new Runtime()
    const plugin = makePlugin("tracked", vi.fn())

    runtime.addPlugin(plugin)

    expect(runtime.plugins.list()).toContain(plugin)
  })

  it("applies multiple plugins in registration order", () => {
    const runtime = new Runtime()
    const order: string[] = []

    runtime.addPlugin({ name: "a", apply: () => order.push("a") })
    runtime.addPlugin({ name: "b", apply: () => order.push("b") })

    expect(order).toEqual(["a", "b"])
  })
})
