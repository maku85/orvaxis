export class HttpError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown
  readonly policyName?: string

  constructor(
    status: number,
    message?: string,
    options?: ErrorOptions & { code?: string; details?: unknown; policyName?: string }
  ) {
    super(message, options)
    this.name = "HttpError"
    this.status = status
    this.code = options?.code
    this.details = options?.details
    this.policyName = options?.policyName
  }
}
