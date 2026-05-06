export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message?: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "HttpError"
    this.status = status
  }
}
