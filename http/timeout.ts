import { HttpError } from "../core/HttpError"
import type { Logger } from "../types"

export type AdapterOptions = {
  timeout?: number
  shutdownTimeout?: number
  logger?: Logger
}

export function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message ?? "Internal Server Error"
  if (process.env.NODE_ENV !== "production") {
    return (err as { message?: string }).message || "Internal Server Error"
  }
  return "Internal Server Error"
}

export function buildErrorBody(err: unknown): { error: string; details?: unknown } {
  const body: { error: string; details?: unknown } = { error: sanitizeErrorMessage(err) }
  const details = (err as { details?: unknown } | null)?.details
  if (details !== undefined) body.details = details
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
        controller?.abort()
        reject(new HttpError(408, "Request Timeout"))
      }, ms)
    }),
  ]).finally(() => clearTimeout(timer))
  onCancel?.(() => clearTimeout(timer))
  return racePromise
}
