import { HttpError } from "../core/HttpError"
import type { Logger } from "../types"

export type AdapterOptions = {
  timeout?: number
  logger?: Logger
}

export function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message ?? "Internal Server Error"
  if (process.env.NODE_ENV !== "production") {
    return (err as { message?: string }).message || "Internal Server Error"
  }
  return "Internal Server Error"
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  controller?: AbortController
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort()
        reject(new HttpError(408, "Request Timeout"))
      }, ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
