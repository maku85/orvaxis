import { describe, expect, it, vi } from "vitest"
import { PluginManager } from "../plugins/PluginManager"
import type { Runtime } from "../core/Runtime"

const emptyRuntime = {} as unknown as Runtime

describe("PluginManager", () => {
  it("applies a registered plugin", () => {
    const manager = new PluginManager()
    const apply = vi.fn()

    manager.register({ name: "test", apply })
    manager.applyAll(emptyRuntime)

    expect(apply).toHaveBeenCalledOnce()
  })

  it("passes the runtime instance to apply()", () => {
    const manager = new PluginManager()
    const runtime = { hooks: {} } as unknown as Runtime
    const apply = vi.fn()

    manager.register({ name: "p", apply })
    manager.applyAll(runtime)

    expect(apply).toHaveBeenCalledWith(runtime)
  })

  it("applies multiple plugins in registration order", () => {
    const manager = new PluginManager()
    const order: string[] = []

    manager.register({ name: "first", apply: () => order.push("first") })
    manager.register({ name: "second", apply: () => order.push("second") })
    manager.applyAll(emptyRuntime)

    expect(order).toEqual(["first", "second"])
  })

  it("does nothing when no plugins are registered", () => {
    const manager = new PluginManager()
    expect(() => manager.applyAll(emptyRuntime)).not.toThrow()
  })
})
