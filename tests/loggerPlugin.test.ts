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

describe("loggerPlugin", () => {
  it("has name 'logger'", () => {
    expect(loggerPlugin().name).toBe("logger")
  })

  it("logs [REQ] via logger.info on onRequest hook", async () => {
    const logger = makeLogger()
    const runtime = new Runtime()
    loggerPlugin({ logger }).apply(runtime)

    await runtime.hooks.trigger("onRequest", {
      req: { url: "/test", path: "/test", method: "GET", headers: {} },
      meta: {},
    } as unknown as OrvaxisContext)

    expect(logger.calls).toContainEqual({ method: "info", args: ["[REQ]", "/test"] })
  })

  it("logs [ERR] via logger.error on onError hook", async () => {
    const logger = makeLogger()
    const runtime = new Runtime()
    loggerPlugin({ logger }).apply(runtime)

    const err = new Error("something failed")
    await runtime.hooks.trigger("onError", { meta: {} } as unknown as OrvaxisContext, err)

    expect(logger.calls).toContainEqual({ method: "error", args: ["[ERR]", err] })
  })

  it("falls back to console when no logger is provided", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const runtime = new Runtime()
    loggerPlugin().apply(runtime)

    await runtime.hooks.trigger("onRequest", {
      req: { path: "/x", method: "GET", headers: {} },
      meta: {},
    } as unknown as OrvaxisContext)

    expect(infoSpy).toHaveBeenCalledWith("[REQ]", "/x")
    infoSpy.mockRestore()
  })
})
