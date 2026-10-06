import type { RouteInfo, RouteInspection, SchemaField } from "../types/index.js"

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
  /**
   * Routes to leave out of the document, for example internal routes or wildcard routes that
   * OpenAPI cannot describe. This is the only way a route is omitted; it is never silent.
   */
  exclude?: (route: RouteInfo) => boolean
  /** Schema Objects that converter output may reference as `#/components/schemas/<name>`. */
  componentSchemas?: Record<string, unknown>
}

export type OpenApiDocument = {
  openapi: "3.1.0"
  info: { title: string; version: string; description?: string }
  paths: Record<string, Record<string, unknown>>
  components: { schemas: Record<string, unknown> }
}

const methods = new Set(["get", "post", "put", "delete", "patch", "head", "options"])
const MEDIA_TYPE = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/
const COMPONENT_REF = "#/components/schemas/"

type PathSegment = { kind: "static"; text: string } | { kind: "param"; name: string }

/**
 * Build an OpenAPI 3.1 document from static route metadata; it never executes app code.
 *
 * Contract:
 * - Paths: `:name` segments become `{name}`. Wildcards (`*rest`) have no OpenAPI equivalent and
 *   raise a `TypeError` unless excluded with `exclude`. Braces in static segments, empty
 *   parameter names and repeated parameter names also raise.
 * - Collisions: two operations whose templates differ only in parameter names (`/a/{id}` and
 *   `/a/{userId}`) are invalid in OpenAPI and raise, as does the same method on the same template.
 * - Converter: must return a Schema Object. `$ref` may point to `#/components/schemas/<name>`
 *   (declared in `componentSchemas`) or to an external URI, which is passed through unresolved.
 *   Local references such as `#/$defs/x` would break once the schema is inlined and raise.
 *   `params`, `query` and `headers` schemas must be objects: each property becomes one parameter
 *   with that property's schema (object and array schemas included) and `required` is honored;
 *   path parameters are always required. OpenAPI ignores `Accept`, `Content-Type` and
 *   `Authorization` header parameters.
 * - Metadata: `route.openapi` adds operation id, summary, tags, an optional body and media types.
 */
export function generateOpenApiDocument(
  app: { inspectRoutes(): RouteInspection[] },
  options: OpenApiOptions
): OpenApiDocument {
  const componentSchemas = { ...(options.componentSchemas ?? {}) }
  if ("ErrorResponse" in componentSchemas) {
    throw new TypeError("componentSchemas must not redefine the built-in 'ErrorResponse' schema")
  }
  const known = new Set(["ErrorResponse", ...Object.keys(componentSchemas)])
  const paths: OpenApiDocument["paths"] = {}
  const claimed = new Map<string, string>()
  const templates = new Map<string, string>()
  const operationIds = new Map<string, string>()

  for (const route of app.inspectRoutes()) {
    if (options.exclude?.(route)) continue
    const label = `${route.method} ${route.path}`
    const method = route.method.toLowerCase()
    if (!methods.has(method)) {
      throw new TypeError(`OpenAPI cannot describe the HTTP method of ${label}`)
    }
    const segments = parsePath(route.path, label)
    const path = segments.length === 0 ? "/" : `/${segments.map(toTemplate).join("/")}`

    const shape = segments
      .map((segment) => (segment.kind === "param" ? "{}" : segment.text))
      .join("/")
    const taken = claimed.get(`${method} ${shape}`)
    if (taken) {
      throw new TypeError(
        `OpenAPI path collision: ${label} and ${taken} describe the same operation`
      )
    }
    claimed.set(`${method} ${shape}`, label)
    const existing = templates.get(shape)
    if (existing !== undefined && existing !== path) {
      throw new TypeError(
        `OpenAPI path collision: ${label} (${path}) and ${existing} differ only in parameter names, which OpenAPI forbids`
      )
    }
    templates.set(shape, path)

    const meta = route.openapi
    const operation: Record<string, unknown> = {}
    if (meta?.operationId !== undefined) {
      const owner = operationIds.get(meta.operationId)
      if (!meta.operationId || owner) {
        throw new TypeError(
          owner
            ? `OpenAPI operationId '${meta.operationId}' on ${label} is already used by ${owner}`
            : `OpenAPI operationId on ${label} must be a non-empty string`
        )
      }
      operationIds.set(meta.operationId, label)
      operation.operationId = meta.operationId
    }
    if (meta?.summary !== undefined) operation.summary = meta.summary
    if (meta?.description !== undefined) operation.description = meta.description
    if (meta?.tags !== undefined) {
      if (!meta.tags.every((tag) => typeof tag === "string" && tag !== "")) {
        throw new TypeError(`OpenAPI tags on ${label} must be non-empty strings`)
      }
      operation.tags = [...meta.tags]
    }
    if (meta?.deprecated !== undefined) operation.deprecated = meta.deprecated
    operation.responses = {}
    const parameters: Record<string, unknown>[] = []

    if (route.schema?.body) {
      const mediaType = meta?.body?.mediaType ?? "application/json"
      assertMediaType(mediaType, label)
      operation.requestBody = {
        required: meta?.body?.required ?? true,
        content: {
          [mediaType]: { schema: convert(route.schema.body, route, "body", options, known) },
        },
      }
    } else if (meta?.body) {
      throw new TypeError(`OpenAPI body metadata on ${label} requires a body schema`)
    }
    for (const field of ["params", "query", "headers"] as const) {
      const validator = route.schema?.[field]
      const names =
        field === "params"
          ? segments.flatMap((segment) => (segment.kind === "param" ? [segment.name] : []))
          : []
      if (!validator && names.length === 0) continue
      const objectSchema = validator
        ? convert(validator, route, field, options, known)
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
    for (const status of Object.keys(meta?.responses ?? {})) {
      if (!(status in (route.responses ?? {}))) {
        throw new TypeError(
          `OpenAPI response metadata for status ${status} on ${label} has no matching entry in responses`
        )
      }
    }
    for (const [statusText, validator] of Object.entries(route.responses ?? {})) {
      const status = Number(statusText)
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw new TypeError(
          `Invalid response status '${statusText}' for ${route.method} ${route.path}`
        )
      }
      const responseMeta = meta?.responses?.[status]
      const response: Record<string, unknown> = {
        description: responseMeta?.description ?? statusDescription(status),
      }
      if (status === 204 || status === 304) {
        if (responseMeta?.mediaType !== undefined) {
          throw new TypeError(
            `OpenAPI ${status} responses have no body; remove mediaType on ${label}`
          )
        }
      } else {
        const mediaType = responseMeta?.mediaType ?? "application/json"
        assertMediaType(mediaType, label)
        response.content = {
          [mediaType]: { schema: convert(validator, route, "response", options, known, status) },
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
        ...componentSchemas,
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

function parsePath(path: string, label: string): PathSegment[] {
  const names = new Set<string>()
  return path
    .split("/")
    .filter(Boolean)
    .map((segment): PathSegment => {
      if (segment.startsWith("*")) {
        throw new TypeError(
          `OpenAPI cannot describe the wildcard segment '${segment}' of ${label}; exclude the route with the 'exclude' option and document it separately`
        )
      }
      if (segment.startsWith(":")) {
        const name = segment.slice(1)
        if (!name || /[{}]/.test(name)) {
          throw new TypeError(
            `OpenAPI cannot express the parameter segment '${segment}' of ${label}`
          )
        }
        if (names.has(name)) {
          throw new TypeError(`OpenAPI path parameter '${name}' appears twice in ${label}`)
        }
        names.add(name)
        return { kind: "param", name }
      }
      if (/[{}]/.test(segment)) {
        throw new TypeError(
          `OpenAPI would read the braces in segment '${segment}' of ${label} as a template`
        )
      }
      return { kind: "static", text: segment }
    })
}

function toTemplate(segment: PathSegment): string {
  return segment.kind === "param" ? `{${segment.name}}` : segment.text
}

function assertMediaType(mediaType: string, label: string): void {
  if (!MEDIA_TYPE.test(mediaType)) {
    throw new TypeError(`'${mediaType}' is not a valid media type for ${label}`)
  }
}

function assertReferences(
  value: unknown,
  known: ReadonlySet<string>,
  where: string,
  seen = new Set<unknown>()
): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return
  seen.add(value)
  const ref = (value as { $ref?: unknown }).$ref
  if (typeof ref === "string" && ref.startsWith("#")) {
    const name = ref.startsWith(COMPONENT_REF) ? ref.slice(COMPONENT_REF.length) : undefined
    if (name === undefined || !known.has(name)) {
      throw new TypeError(
        `schemaConverter returned the local reference '${ref}' for ${where}; it cannot be resolved in the generated document. Inline it or declare it in componentSchemas and reference ${COMPONENT_REF}<name>`
      )
    }
  }
  for (const child of Object.values(value)) assertReferences(child, known, where, seen)
}

function convert(
  validator: SchemaField,
  route: RouteInspection,
  field: OpenApiSchemaContext["field"],
  options: OpenApiOptions,
  known: ReadonlySet<string>,
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
  assertReferences(schema, known, `${field} schema on ${route.method} ${route.path}`)
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
