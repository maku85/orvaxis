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

export function buildErrorBody(err: unknown, requestId?: string): ErrorResponse {
  const body: ErrorResponse = { error: sanitizeErrorMessage(err) }
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === "string") body.code = code
  const details = (err as { details?: unknown } | null)?.details
  if (details !== undefined) body.details = details
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
