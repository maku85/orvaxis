import { HttpError } from "../core/HttpError"

export type AdapterOptions = {
  timeout?: number
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HttpError(408, "Request Timeout")), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
