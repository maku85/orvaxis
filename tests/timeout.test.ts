import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HttpError } from "../core/HttpError"
import { buildErrorBody, sanitizeErrorMessage, withTimeout } from "../http/timeout"

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

  it("aborts the controller when the deadline expires", async () => {
    const controller = new AbortController()
    const pending = new Promise<never>(() => {})
    const race = withTimeout(pending, 500, controller).catch(() => {})
    await vi.advanceTimersByTimeAsync(501)
    await race
    expect(controller.signal.aborted).toBe(true)
  })

  it("does not abort the controller when the promise resolves before the deadline", async () => {
    const controller = new AbortController()
    const result = await withTimeout(Promise.resolve("ok"), 1000, controller)
    expect(result).toBe("ok")
    expect(controller.signal.aborted).toBe(false)
  })

  it("calls onCancel synchronously with a cancel function before the race settles", () => {
    let cancel: (() => void) | undefined
    const pending = new Promise<never>(() => {})
    withTimeout(pending, 500, undefined, (fn) => {
      cancel = fn
    }).catch(() => {})

    expect(typeof cancel).toBe("function")
  })

  it("cancelling via onCancel prevents the 408 rejection", async () => {
    let cancel: (() => void) | undefined
    const pending = new Promise<string>(() => {})
    const errors: unknown[] = []
    withTimeout(pending, 500, undefined, (fn) => {
      cancel = fn
    }).catch((e) => errors.push(e))

    expect(cancel).toBeDefined()
    if (cancel) cancel()
    await vi.advanceTimersByTimeAsync(600)
    expect(errors).toHaveLength(0)
  })

  it("works without a controller (backwards compatible)", async () => {
    const pending = new Promise<never>(() => {})
    const race = withTimeout(pending, 500).catch((e) => e)
    await vi.advanceTimersByTimeAsync(501)
    const err = await race
    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(408)
  })
})

describe("buildErrorBody", () => {
  it("always includes the error message", () => {
    expect(buildErrorBody(new HttpError(404, "Not Found"))).toMatchObject({ error: "Not Found" })
  })

  it("includes requestId when provided", () => {
    const body = buildErrorBody(new HttpError(500, "Oops"), "req-abc")
    expect(body.requestId).toBe("req-abc")
  })

  it("omits requestId when not provided", () => {
    const body = buildErrorBody(new HttpError(500, "Oops"))
    expect(body).not.toHaveProperty("requestId")
  })

  it("includes code from HttpError when set", () => {
    const body = buildErrorBody(new HttpError(403, "Forbidden", { code: "FORBIDDEN" }))
    expect(body.code).toBe("FORBIDDEN")
  })

  it("omits code when HttpError has no code", () => {
    const body = buildErrorBody(new HttpError(404, "Not Found"))
    expect(body).not.toHaveProperty("code")
  })

  it("omits code for plain Error objects", () => {
    const body = buildErrorBody(new Error("boom"))
    expect(body).not.toHaveProperty("code")
  })

  it("includes details from HttpError when set", () => {
    const details = [{ path: ["name"], message: "Required" }]
    const body = buildErrorBody(new HttpError(400, "Bad Request", { details }))
    expect(body.details).toEqual(details)
  })

  it("omits details when not set", () => {
    const body = buildErrorBody(new HttpError(500, "Oops"))
    expect(body).not.toHaveProperty("details")
  })

  it("includes all fields together", () => {
    const err = new HttpError(422, "Unprocessable", { code: "VALIDATION_ERROR", details: ["x"] })
    expect(buildErrorBody(err, "req-xyz")).toEqual({
      error: "Unprocessable",
      code: "VALIDATION_ERROR",
      requestId: "req-xyz",
      details: ["x"],
    })
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
