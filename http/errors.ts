import { STATUS_CODES } from "node:http"
import type { Logger, OrvaxisResponse } from "../types/index.js"
import { buildErrorBody } from "./timeout.js"

/** How the built-in adapters write error responses. */
export type ErrorFormat =
  /** `{ error, code?, details?, requestId }` as `application/json`. The default. */
  | "envelope"
  /** RFC 9457 Problem Details as `application/problem+json`. */
  | "problem"

/** What `mapError` may change about an error response; anything omitted keeps its default. */
export type ErrorMapping = {
  status?: number
  /** The human-readable message: `error` in the envelope, `detail` in Problem Details. */
  message?: string
  code?: string
  details?: unknown
  /** Problem Details `type` (a URI reference); ignored by the envelope. */
  type?: string
  /** Problem Details `title`; ignored by the envelope. */
  title?: string
  /** Response headers to add, for example `Retry-After` or `WWW-Authenticate`. */
  headers?: Record<string, string>
  /** Extra members of the body. They never replace a standard member. */
  extensions?: Record<string, unknown>
}

export type ErrorInfo = {
  requestId: string
  /** The status the adapter would send without a mapping. */
  status: number
  method?: string
  path?: string
  /** The error came from Express or Fastify while handling the request, not from application code. */
  frameworkError: boolean
}

/** Central place to turn any error into a response; return `undefined` to keep the default. */
export type ErrorMapper = (err: unknown, info: ErrorInfo) => ErrorMapping | undefined | void

export type ErrorOptions = {
  /** Default: `"envelope"`. */
  errorFormat?: ErrorFormat
  /**
   * Prefix that turns an error `code` into a Problem Details `type`, for example
   * `"https://api.example.com/problems/"`. Without it `type` is `"about:blank"`.
   */
  problemTypeBase?: string
  mapError?: ErrorMapper
}

export type RenderedError = {
  status: number
  /** Set when the body is not plain `application/json`. */
  contentType?: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

const PROBLEM_MEDIA_TYPE = "application/problem+json"
const ENVELOPE_KEYS = new Set(["error", "code", "details", "requestId"])
const PROBLEM_KEYS = new Set(["type", "title", "status", "detail", "instance", ...ENVELOPE_KEYS])

function validStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : undefined
}

function defaultStatus(err: unknown, frameworkError: boolean): number {
  const e = err as { status?: unknown; statusCode?: unknown } | null
  return validStatus(e?.status) ?? (frameworkError ? validStatus(e?.statusCode) : undefined) ?? 500
}

function extensionsOf(
  mapping: ErrorMapping | undefined,
  reserved: ReadonlySet<string>
): Record<string, unknown> {
  const extensions: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(mapping?.extensions ?? {})) {
    if (!reserved.has(key) && key !== "__proto__") extensions[key] = value
  }
  return extensions
}

/**
 * The single place where adapters turn an error into status, headers and body. The message and
 * the `code` and `details` exposure rules are those of `buildErrorBody`; `mapError` may override
 * them, and `errorFormat` picks the shape.
 */
export function renderError(
  err: unknown,
  requestId: string,
  options: ErrorOptions & { logger?: Logger } = {},
  context: { frameworkError?: boolean; method?: string; path?: string } = {}
): RenderedError {
  const frameworkError = context.frameworkError === true
  const base = buildErrorBody(err, requestId, { frameworkError })
  const baseStatus = defaultStatus(err, frameworkError)

  let mapping: ErrorMapping | undefined
  if (options.mapError) {
    try {
      mapping =
        options.mapError(err, {
          requestId,
          status: baseStatus,
          frameworkError,
          ...(context.method ? { method: context.method } : {}),
          ...(context.path ? { path: context.path } : {}),
        }) ?? undefined
    } catch (mapperError) {
      // A broken mapper must not turn one failure into another: fall back to the default.
      ;(options.logger ?? console).error(
        "[orvaxis] mapError threw, using the default:",
        mapperError
      )
    }
  }

  const status = validStatus(mapping?.status) ?? baseStatus
  const message = mapping?.message ?? base.error
  const code = mapping?.code ?? base.code
  const details = mapping && "details" in mapping ? mapping.details : base.details
  const headers = { ...(mapping?.headers ?? {}) }

  if (options.errorFormat !== "problem") {
    return {
      status,
      headers,
      body: {
        error: message,
        ...(code !== undefined ? { code } : {}),
        ...(details !== undefined ? { details } : {}),
        requestId,
        ...extensionsOf(mapping, ENVELOPE_KEYS),
      },
    }
  }

  const type =
    mapping?.type ??
    (code !== undefined && options.problemTypeBase ? options.problemTypeBase + code : "about:blank")
  const title = mapping?.title ?? STATUS_CODES[status] ?? "Error"
  return {
    status,
    contentType: PROBLEM_MEDIA_TYPE,
    headers,
    body: {
      type,
      title,
      status,
      // `detail` repeating the title adds nothing, so it is left out.
      ...(message !== title ? { detail: message } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
      requestId,
      ...extensionsOf(mapping, PROBLEM_KEYS),
    },
  }
}

/** Write a rendered error through the adapter-neutral response. */
export function sendRenderedError(res: OrvaxisResponse, rendered: RenderedError): void {
  res.status(rendered.status)
  for (const [name, value] of Object.entries(rendered.headers)) res.setHeader(name, value)
  if (rendered.contentType) res.setHeader("Content-Type", rendered.contentType)
  res.json(rendered.body)
}
