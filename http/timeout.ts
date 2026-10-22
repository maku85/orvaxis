import { HttpError } from "../core/HttpError.js"
import { abandonRequest } from "../core/requestAbandoned.js"
import type { Logger } from "../types/index.js"
import type { ErrorOptions } from "./errors.js"

export type AdapterOptions = ErrorOptions & {
  timeout?: number
  /**
   * HTTP status sent when the deadline passes. Default: `503`. A server-side deadline is not
   * the client being slow, so the usual `408` would be misleading (clients may retry it blindly);
   * use `504` when Orvaxis sits behind your own gateway semantics.
   */
  timeoutStatus?: number
  shutdownTimeout?: number
  logger?: Logger
  /** Header used to read/propagate the request ID. Default: "X-Request-ID". */
  requestIdHeader?: string
  /**
   * Accept a request ID sent by the client in `requestIdHeader`. Default: `true`. An incoming ID
   * is used only when it is 1-128 characters of `A-Za-z0-9._-`; anything else is replaced by a
   * generated UUID. Set `false` when clients are not behind a proxy you control, so every request
   * gets a server-generated ID.
   */
  trustRequestId?: boolean
}

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/

/**
 * The request ID ends up in logs, traces, span attributes and the response header, so a
 * client-supplied value is length- and charset-limited (no spaces, newlines or control
 * characters) before it is trusted.
 */
export function resolveRequestId(incoming: string | string[] | undefined, trust = true): string {
  if (trust && typeof incoming === "string" && VALID_REQUEST_ID.test(incoming)) return incoming
  return crypto.randomUUID()
}

export type ErrorResponse = {
  error: string
  code?: string
  requestId?: string
  details?: unknown
}

/**
 * Rejects with 413 when a request body is over a per-route `bodyLimit`, for adapters whose
 * framework already parsed the body under its own limit. The declared `Content-Length` decides;
 * without one (chunked uploads) the serialized parsed body is measured instead.
 */
export function assertBodyWithinLimit(
  req: { headers: Record<string, string | string[] | undefined>; body?: unknown },
  limit: number
): void {
  const declared = Number(req.headers["content-length"])
  let size: number | undefined = Number.isFinite(declared) ? declared : undefined
  if (size === undefined && req.body !== undefined && req.body !== null) {
    try {
      size = Buffer.byteLength(JSON.stringify(req.body))
    } catch {
      size = undefined
    }
  }
  if (size !== undefined && size > limit) {
    throw new HttpError(413, "Request body too large", { code: "BODY_TOO_LARGE" })
  }
}

/** Run the app's plugin close handlers; a failing handler is logged and never blocks shutdown. */
export async function closeApp(app: { close(): Promise<void> }, logger: Logger): Promise<void> {
  try {
    await app.close()
  } catch (err) {
    logger.error("[orvaxis] plugin onClose failed:", err)
  }
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
  onCancel?: (cancel: () => void) => void,
  status = 503
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const racePromise = Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      // Promise executor runs synchronously — timer is set before onCancel fires
      timer = setTimeout(() => {
        if (controller) abandonRequest(controller, "timeout")
        reject(new HttpError(status, "Request Timeout"))
      }, ms)
    }),
  ]).finally(() => clearTimeout(timer))
  onCancel?.(() => clearTimeout(timer))
  return racePromise
}
