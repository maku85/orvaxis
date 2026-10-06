# OpenAPI export

`orvaxis/openapi` builds an OpenAPI 3.1 document from your route declarations: paths, parameters, request bodies and the response contracts you declared. It reads metadata only — it never runs handlers, policies or scope predicates — and it adds no dependency to the core. Orvaxis does not bundle a validator, so you supply the function that turns a validator into a JSON Schema.

## A minimal example

<!-- snippet: examples/openapi-export.ts#app -->
```ts
export function buildExampleApp() {
  const app = new Orvaxis()
  app.group({
    prefix: "/api",
    routes: [
      {
        method: "GET",
        path: "/items/:id",
        schema: {
          params: z.object({ id: z.string() }),
          query: z.object({ verbose: z.string().optional() }),
        },
        responses: {
          200: z.object({ id: z.string(), owner: z.looseObject({}).optional() }),
          304: z.object({}),
        },
        openapi: { operationId: "getItem", summary: "Fetch one item", tags: ["items"] },
        handler: noop,
      },
      {
        method: "PUT",
        path: "/items/:id",
        schema: { params: z.object({ id: z.string() }), body: z.object({ name: z.string() }) },
        responses: { 200: z.object({ id: z.string() }), 204: z.object({}) },
        openapi: {
          operationId: "replaceItem",
          tags: ["items"],
          body: { required: false },
          responses: { 204: { description: "Replaced without a body" } },
        },
        handler: noop,
      },
      {
        method: "POST",
        path: "/imports",
        schema: { body: z.string() },
        responses: { 202: z.object({ jobId: z.string() }) },
        openapi: { operationId: "startImport", body: { mediaType: "text/csv" } },
        handler: noop,
      },
      // A wildcard has no OpenAPI path template; it is excluded explicitly below.
      { method: "GET", path: "/files/*path", handler: noop },
    ],
  })
  return app
}
```

<!-- snippet: examples/openapi-export.ts#document -->
```ts
export function buildExampleDocument() {
  return generateOpenApiDocument(buildExampleApp(), {
    title: "Items API",
    version: "1.0.0",
    schemaConverter: (validator) => z.toJSONSchema(validator as z.ZodType),
    exclude: (route) => route.path.includes("/*"),
  })
}
```

Needed beyond Orvaxis: a validator and its converter. This example uses Zod 4, whose `z.toJSONSchema` is the converter; with another validator, pass the equivalent function. Run it from a repository checkout and read the document on stdout:

```bash
pnpm exec tsx examples/openapi-export.ts
```

The document has two paths, `/api/items/{id}` and `/api/imports`. For `GET /api/items/{id}`, the path and query parameters come from the `params` and `query` schemas:

<!-- openapi: /api/items/{id} get parameters -->
```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "string"
    }
  },
  {
    "name": "verbose",
    "in": "query",
    "required": false,
    "schema": {
      "type": "string"
    }
  }
]
```

A `304` response is declared in `responses`, so it appears without content, as `204` and `304` always do:

<!-- openapi: /api/items/{id} get responses.304 -->
```json
{
  "description": "HTTP 304 response"
}
```

The `PUT` operation declares `body: { required: false }`, so its request body is optional (`requestBody.required` is `false`). In the repository's tests this example is validated against the OpenAPI 3.1 schema with a development-only validator.

## What the generator accepts

**Paths.** `:name` segments become `{name}` (any name without braces). Wildcards such as `/files/*path` have no OpenAPI template, so the call raises a `TypeError` naming the route unless you exclude it with `exclude: (route) => route.path.includes("*")` — the only way a route is left out. Braces in static segments, empty parameter names, a parameter repeated in one path and HTTP methods OpenAPI lacks also raise. Two operations are never merged silently: the same method on the same template, or templates that differ only in parameter names (`GET /items/:id` with `POST /items/:itemId`, which OpenAPI forbids) raise a collision error.

**The converter.** `schemaConverter(validator, { method, path, field, status })` must return a Schema Object, or the call fails naming the route and field. A `$ref` may point to `#/components/schemas/<name>` declared in `componentSchemas`, or to an external URI (passed through, not resolved). A local reference such as `#/$defs/x` raises, because it stops resolving once the schema is placed in the document: inline it or move it into `componentSchemas`. For `params`, `query` and `headers` the result must be an object schema: each property becomes one parameter carrying that property's schema, `required` is honored, and path parameters are always required. OpenAPI tools ignore `Accept`, `Content-Type` and `Authorization` header parameters.

**Optional metadata.** A `parse` method cannot tell whether a body is optional or which media type it uses, so none of this is inferred. Declare it on the route with `openapi`:

| Field | Effect |
|---|---|
| `operationId` | the operation's ID; must be unique across the document |
| `summary`, `description`, `tags`, `deprecated` | copied to the operation |
| `body: { required, mediaType }` | optional request body and its media type (default: required `application/json`) |
| `responses: { [status]: { description, mediaType } }` | per-status description and media type for responses already in `responses`; a status not in `responses` raises; a media type on `204`/`304` raises |

Every operation also gets a `default` response referencing the shared `ErrorResponse` schema that describes the adapters' error envelope.

## What 0.4.0 does and what is on `main`

> **Unreleased.** The strict checks, `exclude`, `componentSchemas`, converter reference validation and `route.openapi` metadata exist only on `main`. They ship with the release after 0.4.0; see [Unreleased changes](/migration/next).

| | 0.4.0 (published) | `main` |
|---|---|---|
| Parameters | `:name` rewritten with a regular expression that recognizes only letters, digits and `_` (`:user-id` becomes `{user}-id`) | segment-based; any name without braces |
| Wildcards, collisions | not detected | `TypeError`, or `exclude` |
| Request body | always required `application/json` | configurable with `openapi.body` |
| Operation metadata | none | `operationId`, `summary`, `tags`, ... |
| Converter `$ref` | not checked | local refs rejected; `componentSchemas` |
| Always | reads metadata only; `204`/`304` without content; a default error response; Zod or any validator through your converter | same |

See also [Response contracts](/guide/response-contracts) for the declarations that feed the document, and the [contracts API reference](/reference/contracts).
