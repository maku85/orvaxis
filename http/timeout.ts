import { HttpError } from "../core/HttpError.js"
import { abandonRequest } from "../core/requestAbandoned.js"
import type { Logger } from "../types/index.js"

export type AdapterOptions = {
  timeout?: number
  shutdownTimeout?: number
  logger?: Logger
  /** Header used to read/propagate the request ID. Default: "X-Request-ID". */
  requestIdHeader?: string
}

export type ErrorResponse = {
  error: string
  code?: string
  requestId?: string
  details?: unknown
}

export function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message ?? "Internal Server Error"
  if (process.env.NODE_ENV !== "production") {
    return (err as { message?: string }).message || "Internal Server Error"
  }
  return "Internal Server Error"
}

export type ErrorBodyOptions = {
  /**
   * The error comes from the HTTP framework's own request handling (body parsing, size limits),
   * not from application code, so its string `code` (e.g. `FST_ERR_CTP_BODY_TOO_LARGE`) is safe to
   * expose. `details` is never taken from such errors.
   */
  frameworkError?: boolean
}

/**
 * Only `HttpError` is an intentional response, so only it contributes `code` and `details`.
 * Any other error (a database driver, an HTTP client) may carry connection strings, hosts or
 * query text in those fields, which must not reach the client.
 */
export function buildErrorBody(
  err: unknown,
  requestId?: string,
  options: ErrorBodyOptions = {}
): ErrorResponse {
  const body: ErrorResponse = { error: sanitizeErrorMessage(err) }
  const intentional = err instanceof HttpError
  if (intentional || options.frameworkError) {
    const code = (err as { code?: unknown } | null)?.code
    if (typeof code === "string") body.code = code
  }
  if (intentional) {
    const details = err.details
    if (details !== undefined) body.details = details
  }
  if (requestId !== undefined) body.requestId = requestId
  return body
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  controller?: AbortController,
  onCancel?: (cancel: () => void) => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const racePromise = Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      // Promise executor runs synchronously — timer is set before onCancel fires
      timer = setTimeout(() => {
        if (controller) abandonRequest(controller, "timeout")
        reject(new HttpError(408, "Request Timeout"))
      }, ms)
    }),
  ]).finally(() => clearTimeout(timer))
  onCancel?.(() => clearTimeout(timer))
  return racePromise
}
