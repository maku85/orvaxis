export class HttpError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown

  constructor(
    status: number,
    message?: string,
    options?: ErrorOptions & { code?: string; details?: unknown }
  ) {
    super(message, options)
    this.name = "HttpError"
    this.status = status
    this.code = options?.code
    this.details = options?.details
  }
}
