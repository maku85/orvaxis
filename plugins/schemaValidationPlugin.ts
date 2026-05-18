import { HttpError } from "../core/HttpError"
import type { OrvaxisContext, RouteMatch, SchemaField } from "../types"
import type { Plugin } from "./PluginManager"

type ValidationField = "body" | "params" | "query" | "headers"

type ValidationIssue = { path: (string | number)[]; message: string }

function extractDetails(cause: unknown): ValidationIssue[] | undefined {
  if (cause == null || typeof cause !== "object") return undefined
  const issues = (cause as Record<string, unknown>).issues
  if (!Array.isArray(issues) || issues.length === 0) return undefined
  return issues.map((issue) => {
    if (issue == null || typeof issue !== "object") return { path: [], message: String(issue) }
    const i = issue as Record<string, unknown>
    return {
      path: Array.isArray(i.path) ? (i.path as (string | number)[]) : [],
      message: typeof i.message === "string" ? i.message : "Invalid value",
    }
  })
}

class ValidationError extends HttpError {
  readonly field: ValidationField

  constructor(field: ValidationField, cause: unknown) {
    super(422, `Validation failed: ${field}`, { cause, details: extractDetails(cause) })
    this.name = "ValidationError"
    this.field = field
  }
}

function validate(field: ValidationField, schema: SchemaField, data: unknown): unknown {
  try {
    return schema.parse(data)
  } catch (cause) {
    throw new ValidationError(field, cause)
  }
}

export const schemaValidationPlugin: Plugin = {
  name: "schema-validation",

  apply(runtime) {
    runtime.hooks.on("beforeHandler", (ctx: OrvaxisContext) => {
      const schema = ctx.meta.route?.route.schema
      if (!schema) return

      if (schema.body !== undefined) {
        ctx.req.body = validate("body", schema.body, ctx.req.body)
      }

      if (schema.params !== undefined) {
        const match = ctx.meta.route as RouteMatch
        match.params = validate("params", schema.params, match.params) as Record<string, string>
      }

      if (schema.query !== undefined) {
        ctx.req.query = validate("query", schema.query, ctx.req.query) as Record<
          string,
          string | string[]
        >
      }

      if (schema.headers !== undefined) {
        ctx.req.headers = validate("headers", schema.headers, ctx.req.headers) as Record<
          string,
          string | string[] | undefined
        >
      }
    })
  },
}
