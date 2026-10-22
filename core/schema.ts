import type { SchemaField, StandardIssue, StandardSchemaV1 } from "../types/index.js"

/**
 * Raised for a Standard Schema that returned `issues`. It carries them as `issues`, the same
 * field name Zod's error uses, so validation details are built the same way for both kinds.
 */
export class SchemaIssuesError extends Error {
  readonly issues: ReadonlyArray<StandardIssue>

  constructor(issues: ReadonlyArray<StandardIssue>) {
    super("Schema validation failed")
    this.name = "SchemaIssuesError"
    this.issues = issues
  }
}

export function isStandardSchema(schema: unknown): schema is StandardSchemaV1 {
  const props = (schema as { "~standard"?: { validate?: unknown } } | null | undefined)?.[
    "~standard"
  ]
  return typeof props === "object" && props !== null && typeof props.validate === "function"
}

function unwrap(result: unknown): unknown {
  const r = result as { value?: unknown; issues?: ReadonlyArray<StandardIssue> }
  if (r.issues) throw new SchemaIssuesError(r.issues)
  return r.value
}

/**
 * Validate with a Standard Schema (`~standard.validate`, which may be asynchronous) or, for
 * validators that only have it, a `parse` method. A Standard Schema wins when both exist.
 */
export async function parseSchema(schema: SchemaField, data: unknown): Promise<unknown> {
  if (isStandardSchema(schema)) return unwrap(await schema["~standard"].validate(data))
  return (schema as { parse(data: unknown): unknown }).parse(data)
}

/** Like `parseSchema`, for the synchronous response API; an asynchronous schema is an error. */
export function parseSchemaSync(schema: SchemaField, data: unknown): unknown {
  if (isStandardSchema(schema)) {
    const result = schema["~standard"].validate(data)
    if (result instanceof Promise) {
      // Avoid an unhandled rejection from the promise we cannot await here.
      result.catch(() => {})
      throw new TypeError(
        "A response schema must validate synchronously; this one returned a Promise"
      )
    }
    return unwrap(result)
  }
  return (schema as { parse(data: unknown): unknown }).parse(data)
}
