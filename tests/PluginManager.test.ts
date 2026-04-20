import { describe, expect, it, vi } from "vitest"
import { PluginManager } from "../plugins/PluginManager"

describe("PluginManager", () => {
  it("applies a registered plugin", () => {
    const manager = new PluginManager()
    const apply = vi.fn()

    manager.register({ name: "test", apply })
    manager.applyAll({})

    expect(apply).toHaveBeenCalledOnce()
  })

  it("passes the orvaxis instance to apply()", () => {
    const manager = new PluginManager()
    const orvaxis = { hooks: {} }
    const apply = vi.fn()

    manager.register({ name: "p", apply })
    manager.applyAll(orvaxis)

    expect(apply).toHaveBeenCalledWith(orvaxis)
  })

  it("applies multiple plugins in registration order", () => {
    const manager = new PluginManager()
    const order: string[] = []

    manager.register({ name: "first", apply: () => order.push("first") })
    manager.register({ name: "second", apply: () => order.push("second") })
    manager.applyAll({})

    expect(order).toEqual(["first", "second"])
  })

  it("does nothing when no plugins are registered", () => {
    const manager = new PluginManager()
    expect(() => manager.applyAll({})).not.toThrow()
  })
})
