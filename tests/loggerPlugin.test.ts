import { describe, expect, it, vi } from "vitest"
import { Runtime } from "../core/Runtime"
import { loggerPlugin } from "../plugins/loggerPlugin"

describe("loggerPlugin", () => {
  it("has name 'logger'", () => {
    expect(loggerPlugin.name).toBe("logger")
  })

  it("logs [REQ] on onRequest hook", async () => {
    const runtime = new Runtime()
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})

    loggerPlugin.apply(runtime)
    await runtime.hooks.trigger("onRequest", { req: { url: "/test" }, meta: {} })

    expect(spy).toHaveBeenCalledWith("[REQ]", "/test")
    spy.mockRestore()
  })

  it("logs [ERR] on onError hook", async () => {
    const runtime = new Runtime()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    loggerPlugin.apply(runtime)
    const err = new Error("something failed")
    await runtime.hooks.trigger("onError", { meta: {} }, err)

    expect(spy).toHaveBeenCalledWith("[ERR]", err)
    spy.mockRestore()
  })
})
