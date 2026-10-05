import { HttpError } from "../core/HttpError.js"
import type { OrvaxisContext, OrvaxisResponse, RouteResponseSchemas } from "../types/index.js"
import type { Plugin } from "./PluginManager.js"

export type ResponseValidationMode = "strict" | "warn"

export type ResponseValidationIssue = {
  method: string
  path: string
  status: number
  kind: "invalid-response" | "stream-not-validated"
}

export type ResponseValidationOptions = {
  /** Invalid JSON responses fail with 500 in strict mode (the default), or pass through in warn mode. */
  mode?: ResponseValidationMode
  /** Receives safe metadata only; response bodies and validator error messages are never included. */
  onViolation?: (issue: ResponseValidationIssue) => void
}

/** Validate declared handler responses without buffering streamed responses. */
export function responseValidationPlugin(options: ResponseValidationOptions = {}): Plugin {
  const mode = options.mode ?? "strict"
  return {
    name: "response-validation",
    apply(runtime) {
      runtime.hooks.on("beforeHandler", (ctx) => {
        const schemas = ctx.meta.route?.route.responses
        if (!schemas || Object.keys(schemas).length === 0) return
        ctx.res = wrapResponse(ctx, ctx.res, schemas, mode, options.onViolation)
      })
    },
  }
}

function wrapResponse(
  ctx: OrvaxisContext,
  original: OrvaxisResponse,
  schemas: RouteResponseSchemas,
  mode: ResponseValidationMode,
  onViolation?: ResponseValidationOptions["onViolation"]
): OrvaxisResponse {
  const reportedStreams = new Set<number>()
  const currentSchema = () => schemas[original.statusCode]
  const baseIssue = (kind: ResponseValidationIssue["kind"]): ResponseValidationIssue => ({
    method: String(ctx.meta.route?.route.method ?? ctx.req.method),
    path: String(ctx.meta.route?.route.path ?? "<unknown route>"),
    status: original.statusCode,
    kind,
  })

  const report = (issue: ResponseValidationIssue) => {
    try {
      if (onViolation) onViolation(issue)
      else console.warn("[orvaxis] response validation issue", issue)
    } catch {
      // A diagnostic callback must not change request behavior.
    }
  }

  const streamingResponse = () => {
    if (!currentSchema()) return
    const status = original.statusCode
    if (mode === "strict") {
      const issue = baseIssue("stream-not-validated")
      throw new HttpError(
        500,
        `Streaming response for ${issue.method} ${issue.path} cannot be validated against a response schema`
      )
    }
    if (!reportedStreams.has(status)) {
      reportedStreams.add(status)
      const issue = baseIssue("stream-not-validated")
      report(issue)
    }
  }

  const validate = (value: unknown): unknown => {
    const schema = currentSchema()
    if (!schema) return value
    try {
      return schema.parse(value)
    } catch {
      const issue = baseIssue("invalid-response")
      if (mode === "strict") {
        throw new HttpError(500, `Response validation failed for status ${issue.status}`)
      }
      report(issue)
      return value
    }
  }

  const wrapped: OrvaxisResponse = {
    get statusCode() {
      return original.statusCode
    },
    set statusCode(value) {
      original.statusCode = value
    },
    get sent() {
      return original.sent
    },
    set sent(value) {
      original.sent = value
    },
    get completed() {
      return original.completed
    },
    status(code) {
      original.status(code)
      return wrapped
    },
    json(body) {
      original.json(validate(body))
    },
    send(body) {
      original.send(validate(body))
    },
    setHeader(name, value) {
      original.setHeader(name, value)
      return wrapped
    },
    write(chunk) {
      streamingResponse()
      original.write(chunk)
    },
    end(chunk?) {
      if (chunk !== undefined) streamingResponse()
      original.end(chunk)
    },
    pipe(stream) {
      streamingResponse()
      original.pipe(stream)
    },
  }
  return wrapped
}
