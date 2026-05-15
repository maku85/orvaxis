import { describe, expect, it, vi } from "vitest"
import { HookSystem } from "../core/Hook"
import type { HookName, OrvaxisContext } from "../types"

const ALL_HOOKS: HookName[] = [
  "onRequest",
  "beforePipeline",
  "beforeHandler",
  "afterHandler",
  "afterPipeline",
  "onError",
]

const emptyCtx = {} as unknown as OrvaxisContext

describe("HookSystem", () => {
  it("triggers a registered hook", async () => {
    const hooks = new HookSystem()
    const fn = vi.fn()
    hooks.on("onRequest", fn)

    const ctx = { meta: {} } as unknown as OrvaxisContext
    await hooks.trigger("onRequest", ctx)

    expect(fn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledWith(ctx, undefined)
  })

  it("passes error argument when triggering onError", async () => {
    const hooks = new HookSystem()
    const fn = vi.fn()
    hooks.on("onError", fn)

    const ctx = { meta: {} } as unknown as OrvaxisContext
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

    await hooks.trigger("beforePipeline", emptyCtx)
    expect(order).toEqual([1, 2, 3])
  })

  it("triggering a hook with no listeners does not throw", async () => {
    const hooks = new HookSystem()
    await expect(hooks.trigger("afterPipeline", emptyCtx)).resolves.toBeUndefined()
  })

  it("isolates listeners across different hook names", async () => {
    const hooks = new HookSystem()
    const onRequest = vi.fn()
    const onError = vi.fn()

    hooks.on("onRequest", onRequest)
    hooks.on("onError", onError)

    await hooks.trigger("onRequest", emptyCtx)

    expect(onRequest).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  it("supports all defined hook names", async () => {
    const hooks = new HookSystem()
    for (const name of ALL_HOOKS) {
      const fn = vi.fn()
      hooks.on(name, fn)
      await hooks.trigger(name, emptyCtx)
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

    await hooks.trigger("onRequest", emptyCtx)
    expect(log).toEqual(["async-done"])
  })

  it("propagates errors thrown by hook listeners", async () => {
    const hooks = new HookSystem()
    hooks.on("onRequest", async () => {
      throw new Error("hook error")
    })

    await expect(hooks.trigger("onRequest", emptyCtx)).rejects.toThrow("hook error")
  })

  it("throws AggregateError when multiple listeners throw, preserving all errors", async () => {
    const hooks = new HookSystem()
    hooks.on("onRequest", async () => {
      throw new Error("first")
    })
    hooks.on("onRequest", async () => {
      throw new Error("second")
    })

    const err = await hooks.trigger("onRequest", emptyCtx).catch((e) => e)
    expect(err).toBeInstanceOf(AggregateError)
    expect((err as AggregateError).errors).toHaveLength(2)
    expect((err as AggregateError).errors[0]).toBeInstanceOf(Error)
    expect(((err as AggregateError).errors[0] as Error).message).toBe("first")
    expect(((err as AggregateError).errors[1] as Error).message).toBe("second")
    expect((err as AggregateError).message).toBe("Multiple hook errors")
  })

  it("throws the original error directly when only one listener throws", async () => {
    const hooks = new HookSystem()
    const original = new Error("solo")
    hooks.on("onRequest", async () => {
      throw original
    })

    const err = await hooks.trigger("onRequest", emptyCtx).catch((e) => e)
    expect(err).toBe(original)
    expect(err).not.toBeInstanceOf(AggregateError)
  })

  it("collects errors from all throwing listeners even when a middle one succeeds", async () => {
    const hooks = new HookSystem()
    const ran: number[] = []
    hooks.on("afterPipeline", async () => {
      ran.push(1)
      throw new Error("err-1")
    })
    hooks.on("afterPipeline", async () => {
      ran.push(2)
    })
    hooks.on("afterPipeline", async () => {
      ran.push(3)
      throw new Error("err-3")
    })

    const err = await hooks.trigger("afterPipeline", emptyCtx).catch((e) => e)
    expect(ran).toEqual([1, 2, 3])
    expect(err).toBeInstanceOf(AggregateError)
    expect((err as AggregateError).errors).toHaveLength(2)
  })

  it("swallows errors thrown by onError hook listeners", async () => {
    const hooks = new HookSystem()
    hooks.on("onError", async () => {
      throw new Error("onError hook exploded")
    })

    await expect(hooks.trigger("onError", emptyCtx, new Error("original"))).resolves.toBeUndefined()
  })

  it("runs all onError hooks even if one throws", async () => {
    const hooks = new HookSystem()
    const order: number[] = []

    hooks.on("onError", async () => {
      order.push(1)
      throw new Error("first fails")
    })
    hooks.on("onError", async () => {
      order.push(2)
    })

    await hooks.trigger("onError", emptyCtx, new Error("original"))
    expect(order).toEqual([1, 2])
  })

  it("uses the injected logger when an onError hook throws", async () => {
    const errors: unknown[] = []
    const logger = { info: () => {}, error: (...args: unknown[]) => errors.push(args) }
    const hooks = new HookSystem(logger)

    hooks.on("onError", async () => {
      throw new Error("meta-error")
    })

    await hooks.trigger("onError", emptyCtx, new Error("original"))
    expect(errors).toHaveLength(1)
    expect((errors[0] as unknown[])[0]).toBe("[orvaxis] onError hook threw:")
  })
})
