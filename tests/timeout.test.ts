import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HttpError } from "../core/HttpError"
import { sanitizeErrorMessage, withTimeout } from "../http/timeout"

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves with the promise value when it settles before the deadline", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000)
    expect(result).toBe("ok")
  })

  it("rejects with HttpError 408 when the deadline expires", async () => {
    const pending = new Promise<never>(() => {})
    const race = withTimeout(pending, 500)
    const errPromise = race.catch((e) => e)
    await vi.advanceTimersByTimeAsync(501)
    const err = await errPromise
    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(408)
    expect(err.message).toBe("Request Timeout")
  })

  it("does not fire the timeout when the promise resolves early", async () => {
    const fireTimeout = vi.fn()
    const pending = new Promise<string>((resolve) => {
      setTimeout(() => resolve("done"), 100)
    })
    const race = withTimeout(pending, 1000)
    setTimeout(fireTimeout, 1001)
    await vi.advanceTimersByTimeAsync(101)
    await race
    // advance past the timeout deadline — fireTimeout fires but withTimeout timer was cleared
    await vi.advanceTimersByTimeAsync(1000)
    expect(fireTimeout).toHaveBeenCalledOnce()
  })

  it("propagates the original rejection without wrapping it", async () => {
    const original = new Error("boom")
    const err = await withTimeout(Promise.reject(original), 1000).catch((e) => e)
    expect(err).toBe(original)
  })

  it("clears the timer after the promise resolves to avoid dangling timers", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")
    await withTimeout(Promise.resolve("done"), 5000)
    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })
})

describe("sanitizeErrorMessage", () => {
  it("always exposes the message of an HttpError regardless of NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(sanitizeErrorMessage(new HttpError(403, "Forbidden"))).toBe("Forbidden")
    vi.unstubAllEnvs()
  })

  it("exposes the message of a generic Error in non-production", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(sanitizeErrorMessage(new Error("DB connection failed"))).toBe("DB connection failed")
    vi.unstubAllEnvs()
  })

  it("replaces the message of a generic Error in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(sanitizeErrorMessage(new Error("DB connection failed"))).toBe("Internal Server Error")
    vi.unstubAllEnvs()
  })

  it("falls back to 'Internal Server Error' when the error has no message", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(sanitizeErrorMessage(new Error())).toBe("Internal Server Error")
    vi.unstubAllEnvs()
  })

  it("falls back to 'Internal Server Error' for non-Error values in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(sanitizeErrorMessage({ code: 42 })).toBe("Internal Server Error")
    vi.unstubAllEnvs()
  })
})
