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

function makeCtx(path: string, id = "req-123"): OrvaxisContext {
  return {
    req: { url: path, path, method: "GET", headers: {}, id },
    meta: {},
  } as unknown as OrvaxisContext
}

describe("loggerPlugin", () => {
  it("has name 'logger'", () => {
    expect(loggerPlugin().name).toBe("logger")
  })

  it("logs method, path, and requestId via logger.info on onRequest hook", async () => {
    const logger = makeLogger()
    const runtime = new Runtime()
    loggerPlugin({ logger }).apply(runtime)

    await runtime.hooks.trigger("onRequest", makeCtx("/test", "req-abc"))

    expect(logger.calls).toContainEqual({
      method: "info",
      args: ["[REQ]", "GET", "/test", "req-abc"],
    })
  })

  it("logs requestId and error via logger.error on onError hook", async () => {
    const logger = makeLogger()
    const runtime = new Runtime()
    loggerPlugin({ logger }).apply(runtime)

    const err = new Error("something failed")
    await runtime.hooks.trigger("onError", makeCtx("/test", "req-xyz"), err)

    expect(logger.calls).toContainEqual({ method: "error", args: ["[ERR]", "req-xyz", err] })
  })

  it("falls back to console when no logger is provided", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const runtime = new Runtime()
    loggerPlugin().apply(runtime)

    await runtime.hooks.trigger("onRequest", makeCtx("/x", "req-fallback"))

    expect(infoSpy).toHaveBeenCalledWith("[REQ]", "GET", "/x", "req-fallback")
    infoSpy.mockRestore()
  })
})
