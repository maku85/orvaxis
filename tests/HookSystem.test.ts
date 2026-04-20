import { describe, expect, it, vi } from "vitest"
import { HookSystem } from "../core/Hook"
import type { HookName } from "../types"

const ALL_HOOKS: HookName[] = ["onRequest", "beforePipeline", "afterPipeline", "onError"]

describe("HookSystem", () => {
  it("triggers a registered hook", async () => {
    const hooks = new HookSystem()
    const fn = vi.fn()
    hooks.on("onRequest", fn)

    const ctx = { meta: {} }
    await hooks.trigger("onRequest", ctx)

    expect(fn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledWith(ctx, undefined)
  })

  it("passes error argument when triggering onError", async () => {
    const hooks = new HookSystem()
    const fn = vi.fn()
    hooks.on("onError", fn)

    const ctx = { meta: {} }
    const err = new Error("boom")
    await hooks.trigger("onError", ctx, err)

    expect(fn).toHaveBeenCalledWith(ctx, err)
  })

  it("calls multiple listeners for the same hook in order", async () => {
    const hooks = new HookSystem()
    const order: number[] = []

    hooks.on("beforePipeline", async () => {
      order.push(1)
    })
    hooks.on("beforePipeline", async () => {
      order.push(2)
    })
    hooks.on("beforePipeline", async () => {
      order.push(3)
    })

    await hooks.trigger("beforePipeline", {})
    expect(order).toEqual([1, 2, 3])
  })

  it("triggering a hook with no listeners does not throw", async () => {
    const hooks = new HookSystem()
    await expect(hooks.trigger("afterPipeline", {})).resolves.toBeUndefined()
  })

  it("isolates listeners across different hook names", async () => {
    const hooks = new HookSystem()
    const onRequest = vi.fn()
    const onError = vi.fn()

    hooks.on("onRequest", onRequest)
    hooks.on("onError", onError)

    await hooks.trigger("onRequest", {})

    expect(onRequest).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  it("supports all defined hook names", async () => {
    const hooks = new HookSystem()
    for (const name of ALL_HOOKS) {
      const fn = vi.fn()
      hooks.on(name, fn)
      await hooks.trigger(name, {})
      expect(fn).toHaveBeenCalledOnce()
    }
  })

  it("awaits async hook handlers before continuing", async () => {
    const hooks = new HookSystem()
    const log: string[] = []

    hooks.on("onRequest", async () => {
      await new Promise<void>((r) => setTimeout(r, 10))
      log.push("async-done")
    })

    await hooks.trigger("onRequest", {})
    expect(log).toEqual(["async-done"])
  })

  it("propagates errors thrown by hook listeners", async () => {
    const hooks = new HookSystem()
    hooks.on("onRequest", async () => {
      throw new Error("hook error")
    })

    await expect(hooks.trigger("onRequest", {})).rejects.toThrow("hook error")
  })
})
