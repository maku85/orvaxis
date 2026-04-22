import { describe, expect, it, vi } from "vitest"
import { Pipeline } from "../core/Pipeline"
import { createMockResponse } from "../core/mockResponse"
import type { NextFunction, OrvaxisContext } from "../types"

function makeCtx(): OrvaxisContext {
  return {
    req: { path: "", method: "", headers: {} },
    res: createMockResponse(),
    state: {},
    meta: {},
    logs: [],
  }
}

describe("Pipeline", () => {
  it("executes a single middleware", async () => {
    const pipeline = new Pipeline()
    const fn = vi.fn(async (_ctx, next) => next())
    pipeline.use(fn)

    await pipeline.execute(makeCtx())
    expect(fn).toHaveBeenCalledOnce()
  })

  it("executes middlewares in registration order", async () => {
    const pipeline = new Pipeline()
    const order: number[] = []

    pipeline.use(async (_ctx, next) => {
      order.push(1)
      await next()
    })
    pipeline.use(async (_ctx, next) => {
      order.push(2)
      await next()
    })
    pipeline.use(async (_ctx, next) => {
      order.push(3)
      await next()
    })

    await pipeline.execute(makeCtx())
    expect(order).toEqual([1, 2, 3])
  })

  it("passes the context to every middleware", async () => {
    const pipeline = new Pipeline()
    const ctx = makeCtx()
    const seen: OrvaxisContext[] = []

    pipeline.use(async (c, next) => {
      seen.push(c)
      await next()
    })
    pipeline.use(async (c, next) => {
      seen.push(c)
      await next()
    })

    await pipeline.execute(ctx)
    expect(seen[0]).toBe(ctx)
    expect(seen[1]).toBe(ctx)
  })

  it("allows middleware to mutate ctx.state", async () => {
    const pipeline = new Pipeline()
    pipeline.use(async (ctx, next) => {
      ctx.state.value = "hello"
      await next()
    })

    const ctx = makeCtx()
    await pipeline.execute(ctx)
    expect(ctx.state.value).toBe("hello")
  })

  it("stops execution when next() is not called", async () => {
    const pipeline = new Pipeline()
    const second = vi.fn()

    pipeline.use(async () => {})
    pipeline.use(second)

    await pipeline.execute(makeCtx())
    expect(second).not.toHaveBeenCalled()
  })

  it("handles an empty pipeline without error", async () => {
    const pipeline = new Pipeline()
    await expect(pipeline.execute(makeCtx())).resolves.toBeUndefined()
  })

  it("prevents double-invocation of next()", async () => {
    const pipeline = new Pipeline()
    const second = vi.fn(async (_ctx: OrvaxisContext, next: NextFunction) => next())

    pipeline.use(async (_ctx, next) => {
      await next()
      await next()
    })
    pipeline.use(second)

    await pipeline.execute(makeCtx())
    expect(second).toHaveBeenCalledOnce()
  })

  it("propagates errors thrown inside middleware", async () => {
    const pipeline = new Pipeline()
    pipeline.use(async () => {
      throw new Error("middleware error")
    })

    await expect(pipeline.execute(makeCtx())).rejects.toThrow("middleware error")
  })

  it("runs pre- and post-next logic in correct order (onion model)", async () => {
    const pipeline = new Pipeline()
    const log: string[] = []

    pipeline.use(async (_ctx, next) => {
      log.push("before-1")
      await next()
      log.push("after-1")
    })
    pipeline.use(async (_ctx, next) => {
      log.push("before-2")
      await next()
      log.push("after-2")
    })

    await pipeline.execute(makeCtx())
    expect(log).toEqual(["before-1", "before-2", "after-2", "after-1"])
  })
})
