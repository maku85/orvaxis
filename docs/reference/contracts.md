# Contracts API reference

Signatures and options for request validation, response contracts and OpenAPI export. The guides explain how they behave: [typed input validation](/guide/typed-validation), [response contracts](/guide/response-contracts) and [OpenAPI export](/guide/openapi).

## Schemas on a route

| Name | Description |
|---|---|
| `SchemaField<TOutput>` | `{ parse(data: unknown): TOutput }`. Any validator with a `parse` method that returns the value or throws |
| `RouteSchema` | `{ body?, params?, query?, headers? }`, each a `SchemaField` |
| `RouteResponseSchemas` | `Record<number, SchemaField>`, the contract per HTTP status |
| `Route.schema`, `Route.responses` | where a route declares them |
| `Route.openapi` | optional `RouteOpenApiMetadata` read only by OpenAPI export |

## `schemaValidationPlugin`

Register with `app.register(schemaValidationPlugin)`. In `onValidation` it parses each declared field and replaces `ctx.req.body`, `ctx.params`, `ctx.req.query` and `ctx.req.headers` with the parsed output. A failure throws a `ValidationError` (an `HttpError` with status `422`, message `Validation failed: <field>`, and `details` as `{ path, message }[]` when the validator exposes `issues`). Required by every `defineRoute()` route.

## `defineRoute(route)`

Returns the route with handler types inferred from the output of each declared validator. Forms: `defineRoute({ schema, handler, ... })` and, for existing code, `defineRoute<TBody, TState>({ ... })`; with a custom state type, `defineRoute<typeof schema, TState>({ ... })`. Without `schemaValidationPlugin` the request fails with a `500` configuration error.

## Policies with `phase: "postValidation"`

| Field | Meaning |
|---|---|
| `phase` | `"postValidation"` runs after `onValidation` |
| `requires` | non-empty list of `"body" \| "params" \| "query" \| "headers"`; each must have a schema on the route and the plugin must be registered, or the request fails with a `500` configuration error |

## `responseValidationPlugin(options?)`

| Option | Default | Meaning |
|---|---|---|
| `mode` | `"strict"` | `"strict"`: an invalid response becomes a `500`; `"warn"`: it is sent unchanged |
| `onViolation(issue)` | `console.warn` | receives `{ method, path, status, kind }` with `kind` `"invalid-response"` or `"stream-not-validated"`; never the body or validator messages |

## `generateOpenApiDocument(app, options)` from `orvaxis/openapi`

| Option | Required | Meaning |
|---|---|---|
| `title`, `version`, `description?` | `title`, `version` | the `info` object |
| `schemaConverter(validator, context)` | when any schema or response is declared | returns a Schema Object; `context` is `{ method, path, field, status? }` with `field` one of `body`, `params`, `query`, `headers`, `response` |
| `exclude(route)` | no | routes to leave out; the only way a route is omitted |
| `componentSchemas` | no | schemas that converter output may reference as `#/components/schemas/<name>`; `ErrorResponse` is reserved |

Returns `{ openapi: "3.1.0", info, paths, components }`. `RouteOpenApiMetadata` is `{ operationId?, summary?, description?, tags?, deprecated?, body?: { required?, mediaType? }, responses?: Record<status, { description?, mediaType? }> }`.

`exclude`, `componentSchemas`, `Route.openapi` and the strict path and reference checks exist since 0.5.0; see [OpenAPI export](/guide/openapi#what-changed-in-0-5-0).
