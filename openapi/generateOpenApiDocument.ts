import type { RouteInspection, SchemaField } from "../types/index.js"

export type OpenApiSchemaContext = {
  method: string
  path: string
  field: "body" | "params" | "query" | "headers" | "response"
  status?: number
}

/** Converts a validator into a JSON Schema/OpenAPI Schema Object. No converter is bundled. */
export type OpenApiSchemaConverter = (
  validator: SchemaField,
  context: OpenApiSchemaContext
) => Record<string, unknown>

export type OpenApiOptions = {
  title: string
  version: string
  description?: string
  schemaConverter?: OpenApiSchemaConverter
}

export type OpenApiDocument = {
  openapi: "3.1.0"
  info: { title: string; version: string; description?: string }
  paths: Record<string, Record<string, unknown>>
  components: { schemas: Record<string, unknown> }
}

const methods = new Set(["get", "post", "put", "delete", "patch", "head", "options"])

/** Build an OpenAPI 3.1 document from static route metadata; it never executes app code. */
export function generateOpenApiDocument(
  app: { inspectRoutes(): RouteInspection[] },
  options: OpenApiOptions
): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {}
  for (const route of app.inspectRoutes()) {
    const method = route.method.toLowerCase()
    if (!methods.has(method)) continue
    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    const operation: Record<string, unknown> = { responses: {} }
    const parameters: Record<string, unknown>[] = []

    if (route.schema?.body) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": { schema: convert(route.schema.body, route, "body", options) },
        },
      }
    }
    for (const field of ["params", "query", "headers"] as const) {
      const validator = route.schema?.[field]
      const names =
        field === "params"
          ? [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1])
          : []
      if (!validator && names.length === 0) continue
      const objectSchema = validator
        ? convert(validator, route, field, options)
        : {
            type: "object",
            properties: Object.fromEntries(names.map((name) => [name, { type: "string" }])),
          }
      const properties = objectSchema.properties
      if (!properties || typeof properties !== "object") {
        throw new TypeError(
          `OpenAPI ${field} schema for ${route.method} ${route.path} must have object properties`
        )
      }
      const required = Array.isArray(objectSchema.required) ? objectSchema.required : []
      const parameterIn = field === "params" ? "path" : field === "headers" ? "header" : "query"
      const parameterNames = field === "params" ? names : Object.keys(properties)
      for (const name of parameterNames) {
        const schema = (properties as Record<string, unknown>)[name]
        if (schema === undefined) {
          throw new TypeError(
            `OpenAPI path parameter '${name}' has no schema for ${route.method} ${route.path}`
          )
        }
        parameters.push({
          name,
          in: parameterIn,
          required: parameterIn === "path" || required.includes(name),
          schema,
        })
      }
    }
    if (parameters.length) operation.parameters = parameters

    const responseMap = operation.responses as Record<string, unknown>
    for (const [statusText, validator] of Object.entries(route.responses ?? {})) {
      const status = Number(statusText)
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw new TypeError(
          `Invalid response status '${statusText}' for ${route.method} ${route.path}`
        )
      }
      const response: Record<string, unknown> = { description: statusDescription(status) }
      if (status !== 204 && status !== 304) {
        response.content = {
          "application/json": {
            schema: convert(validator, route, "response", options, status),
          },
        }
      }
      responseMap[String(status)] = response
    }
    responseMap.default = {
      description: "Orvaxis error response",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
    }
    let operations = paths[path]
    if (!operations) {
      operations = {}
      paths[path] = operations
    }
    operations[method] = operation
  }
  return {
    openapi: "3.1.0",
    info: {
      title: options.title,
      version: options.version,
      ...(options.description ? { description: options.description } : {}),
    },
    paths,
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
            code: { type: "string" },
            requestId: { type: "string" },
            details: {},
          },
        },
      },
    },
  }
}

function convert(
  validator: SchemaField,
  route: RouteInspection,
  field: OpenApiSchemaContext["field"],
  options: OpenApiOptions,
  status?: number
): Record<string, unknown> {
  if (!options.schemaConverter) {
    throw new TypeError(
      `An OpenAPI schemaConverter is required for ${field} schema on ${route.method} ${route.path}`
    )
  }
  const schema = options.schemaConverter(validator, {
    method: route.method,
    path: route.path,
    field,
    ...(status === undefined ? {} : { status }),
  })
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError(
      `schemaConverter must return a JSON Schema object for ${route.method} ${route.path}`
    )
  }
  return schema
}

function statusDescription(status: number): string {
  const descriptions: Record<number, string> = {
    200: "Successful response",
    201: "Resource created",
    202: "Request accepted",
    204: "No content",
    400: "Bad request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not found",
    422: "Validation failed",
    500: "Internal server error",
  }
  return descriptions[status] ?? `HTTP ${status} response`
}
