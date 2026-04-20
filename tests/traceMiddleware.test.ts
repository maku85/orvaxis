import { describe, expect, it, vi } from "vitest"
import { traceMiddleware } from "../middleware/traceMiddleware"

function makeCtx(withTracer = true) {
  const events: { type: string; meta?: any }[] = []
  return {
    meta: withTracer
      ? {
          tracer: {
            event: (type: string, meta?: any) => events.push({ type, meta }),
          },
        }
      : {},
    _events: events,
  }
}

describe("traceMiddleware", () => {
  it("returns a middleware function", () => {
    expect(typeof traceMiddleware()).toBe("function")
  })

  it("calls next()", async () => {
    const mw = traceMiddleware()
    const next = vi.fn(async () => {})
    await mw(makeCtx() as any, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it("records MIDDLEWARE:start before next", async () => {
    const mw = traceMiddleware()
    const ctx = makeCtx()
    const log: string[] = []

    await mw(ctx as any, async () => {
      log.push("next")
    })

    const startIdx = ctx._events.findIndex((e) => e.type === "MIDDLEWARE:start")
    expect(startIdx).toBe(0)
    expect(log[0]).toBe("next")
  })

  it("records MIDDLEWARE:end after next with a duration", async () => {
    const mw = traceMiddleware()
    const ctx = makeCtx()

    await mw(ctx as any, async () => {})

    const end = ctx._events.find((e) => e.type === "MIDDLEWARE:end")
    expect(end).toBeDefined()
    expect(typeof end?.meta?.duration).toBe("number")
    expect(end!.meta.duration).toBeGreaterThanOrEqual(0)
  })

  it("does not throw when ctx.meta.tracer is absent", async () => {
    const mw = traceMiddleware()
    const ctx = makeCtx(false)
    await expect(mw(ctx as any, async () => {})).resolves.toBeUndefined()
  })
})
