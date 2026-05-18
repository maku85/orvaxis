import { describe, expect, it, vi } from "vitest"
import { Runtime } from "../core/Runtime"
import { loggerPlugin } from "../plugins/loggerPlugin"
import type { Logger, OrvaxisContext } from "../types"

function makeLogger(): Logger & { calls: { method: string; args: unknown[] }[] } {
  const calls: { method: string; args: unknown[] }[] = []
  return {
    calls,
    info(...args) {
      calls.push({ method: "info", args })
    },
    error(...args) {
      calls.push({ method: "error", args })
    },
  }
}

function makeCtx(path: string, id = "req-123", statusCode = 200): OrvaxisContext {
  return {
    req: { url: path, path, method: "GET", headers: {}, id },
    res: { statusCode },
    meta: {},
  } as unknown as OrvaxisContext
}

describe("loggerPlugin", () => {
  it("has name 'logger'", () => {
    expect(loggerPlugin().name).toBe("logger")
  })

  describe("json format (default)", () => {
    it("logs structured request on onRequest hook", async () => {
      const logger = makeLogger()
      const runtime = new Runtime()
      loggerPlugin({ logger }).apply(runtime)

      await runtime.hooks.trigger("onRequest", makeCtx("/test", "req-abc"))

      expect(logger.calls).toContainEqual({
        method: "info",
        args: [{ type: "request", method: "GET", path: "/test", requestId: "req-abc" }],
      })
    })

    it("logs structured response on afterPipeline hook", async () => {
      const logger = makeLogger()
      const runtime = new Runtime()
      loggerPlugin({ logger }).apply(runtime)

      const ctx = makeCtx("/test", "req-abc", 201)
      await runtime.hooks.trigger("onRequest", ctx)
      await runtime.hooks.trigger("afterPipeline", ctx)

      expect(logger.calls).toContainEqual({
        method: "info",
        args: [
          expect.objectContaining({
            type: "response",
            method: "GET",
            path: "/test",
            status: 201,
            requestId: "req-abc",
            durationMs: expect.any(Number),
          }),
        ],
      })
    })

    it("logs structured error on onError hook", async () => {
      const logger = makeLogger()
      const runtime = new Runtime()
      loggerPlugin({ logger }).apply(runtime)

      const err = new Error("something failed")
      await runtime.hooks.trigger("onError", makeCtx("/test", "req-xyz"), err)

      expect(logger.calls).toContainEqual({
        method: "error",
        args: [{ type: "error", requestId: "req-xyz", message: "something failed", error: err }],
      })
    })

    it("falls back to console when no logger is provided", async () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
      const runtime = new Runtime()
      loggerPlugin().apply(runtime)

      await runtime.hooks.trigger("onRequest", makeCtx("/x", "req-fallback"))

      expect(infoSpy).toHaveBeenCalledWith({
        type: "request",
        method: "GET",
        path: "/x",
        requestId: "req-fallback",
      })
      infoSpy.mockRestore()
    })
  })

  describe("text format", () => {
    it("logs method, path, and requestId via logger.info on onRequest hook", async () => {
      const logger = makeLogger()
      const runtime = new Runtime()
      loggerPlugin({ logger, format: "text" }).apply(runtime)

      await runtime.hooks.trigger("onRequest", makeCtx("/test", "req-abc"))

      expect(logger.calls).toContainEqual({
        method: "info",
        args: ["[REQ]", "GET", "/test", "req-abc"],
      })
    })

    it("logs method, path, status, duration, and requestId via logger.info on afterPipeline hook", async () => {
      const logger = makeLogger()
      const runtime = new Runtime()
      loggerPlugin({ logger, format: "text" }).apply(runtime)

      const ctx = makeCtx("/test", "req-abc", 200)
      await runtime.hooks.trigger("onRequest", ctx)
      await runtime.hooks.trigger("afterPipeline", ctx)

      expect(logger.calls).toContainEqual({
        method: "info",
        args: ["[RES]", "GET", "/test", 200, expect.stringMatching(/^\d+ms$/), "req-abc"],
      })
    })

    it("logs requestId and error via logger.error on onError hook", async () => {
      const logger = makeLogger()
      const runtime = new Runtime()
      loggerPlugin({ logger, format: "text" }).apply(runtime)

      const err = new Error("something failed")
      await runtime.hooks.trigger("onError", makeCtx("/test", "req-xyz"), err)

      expect(logger.calls).toContainEqual({ method: "error", args: ["[ERR]", "req-xyz", err] })
    })
  })
})
