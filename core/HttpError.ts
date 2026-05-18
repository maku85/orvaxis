export class HttpError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(status: number, message?: string, options?: ErrorOptions & { details?: unknown }) {
    super(message, options)
    this.name = "HttpError"
    this.status = status
    this.details = options?.details
  }
}
