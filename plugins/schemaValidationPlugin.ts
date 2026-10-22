import { HttpError } from "../core/HttpError.js"
import { parseSchema } from "../core/schema.js"
import type { OrvaxisContext, RouteMatch, SchemaField } from "../types/index.js"
import type { Plugin } from "./PluginManager.js"

type ValidationField = "body" | "params" | "query" | "headers"

type ValidationIssue = { path: (string | number)[]; message: string }

// Standard Schema paths may hold `{ key }` wrappers and symbols; details are plain JSON.
function pathSegment(segment: unknown): string | number {
  const key =
    typeof segment === "object" && segment !== null && "key" in segment
      ? (segment as { key: unknown }).key
      : segment
  return typeof key === "number" || typeof key === "string" ? key : String(key)
}

function extractDetails(cause: unknown): ValidationIssue[] | undefined {
  if (cause == null || typeof cause !== "object") return undefined
  const issues = (cause as Record<string, unknown>).issues
  if (!Array.isArray(issues) || issues.length === 0) return undefined
  return issues.map((issue) => {
    if (issue == null || typeof issue !== "object") return { path: [], message: String(issue) }
    const i = issue as Record<string, unknown>
    return {
      path: Array.isArray(i.path) ? i.path.map(pathSegment) : [],
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

async function validate(
  field: ValidationField,
  schema: SchemaField,
  data: unknown
): Promise<unknown> {
  try {
    return await parseSchema(schema, data)
  } catch (cause) {
    throw new ValidationError(field, cause)
  }
}

export const schemaValidationPlugin: Plugin = {
  name: "schema-validation",

  apply(runtime) {
    runtime.hooks.on("onValidation", async (ctx: OrvaxisContext) => {
      const schema = ctx.meta.route?.route.schema
      if (!schema) return

      if (schema.body !== undefined) {
        ctx.req.body = await validate("body", schema.body, ctx.req.body)
      }

      if (schema.params !== undefined) {
        const match = ctx.meta.route as RouteMatch
        match.params = (await validate("params", schema.params, match.params)) as Record<
          string,
          string
        >
      }

      if (schema.query !== undefined) {
        ctx.req.query = (await validate("query", schema.query, ctx.req.query)) as Record<
          string,
          string | string[]
        >
      }

      if (schema.headers !== undefined) {
        ctx.req.headers = (await validate("headers", schema.headers, ctx.req.headers)) as Record<
          string,
          string | string[] | undefined
        >
      }
    })
  },
}
