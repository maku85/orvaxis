# HTTP adapters

Express and Fastify adapters, request parsing, body limits, error responses, request IDs and custom adapters.

Orvaxis is not tied to any specific HTTP framework. The core runtime is framework-agnostic — adapters are thin wrappers that normalize the incoming request and delegate to the runtime.

Two adapters are included out of the box:

| Adapter | Import | Peer dependency |
|---|---|---|
| Express | `createExpressServer` from `orvaxis/express` | `express ^4.20 \|\| ^5` |
| Fastify | `createFastifyServer` from `orvaxis/fastify` | `fastify ^5` |

Install only the framework you intend to use — both peer dependencies are optional. Each adapter lives on its own subpath (`orvaxis/express`, `orvaxis/fastify`) precisely so that importing the main `orvaxis` entry point never requires either peer dependency to be installed. Importing `orvaxis/express`, `orvaxis/fastify` or `orvaxis/otel` without its peer (`express`, `fastify`, `@opentelemetry/api`) fails immediately with a module-not-found error that names the missing package; `orvaxis`, `orvaxis/testing` and `orvaxis/openapi` never need a peer.

Both full-runtime adapters mount Orvaxis as a catch-all handler and delegate routing, lifecycle hooks, and declared validation to the Orvaxis runtime. Express routes within that mount are handled by Orvaxis's router. With Fastify, those endpoints use Orvaxis routing and validation instead of Fastify's native route trie and compiled schema validation. Choose the adapter for the HTTP transport and surrounding framework integrations; benchmark your application before drawing performance conclusions.

### Add Orvaxis policies to one existing Express route

For a route whose handler should stay in Express, follow the [existing route integration guide](./integrate-existing-route.md). It covers middleware placement, identity mapping, the mirrored route declaration, and validation boundaries.

## Query string parsing differs between adapters

`ctx.req.query` is typed as `Record<string, string | string[]>` on both adapters, but Express's default query parser (`qs`, in "extended" mode) does not actually guarantee that shape: bracket notation is parsed into **nested objects**.

```
GET /search?filter[status]=active
```

| Adapter | `ctx.req.query.filter` |
|---|---|
| Express (default) | `{ status: "active" }` — an object, not a string |
| Fastify (default) | `"active"` under the literal key `"filter[status]"` — brackets are not special |

Code that reads a query value directly and assumes it's a string (`ctx.req.query.filter.toUpperCase()`) compiles under the declared type but can throw at runtime on Express if a client sends bracketed keys. Two ways to avoid this:

- Validate query params with `route.schema.query` (see [Plugins → `schemaValidationPlugin`](../reference/core-concepts.md#plugins)) — this reshapes and checks `ctx.req.query` at the boundary regardless of adapter.
- Or, if you don't use query schemas and want the declared type to actually hold, switch Express to the non-nesting parser: `expressApp.set("query parser", "simple")` before passing it to `createExpressServer`. This affects the whole Express app instance, including any routes you mount outside Orvaxis, so prefer it only when you control the entire app.

## Body size limits

Orvaxis does not enforce its own body size limit. The ceiling is set entirely by the body-parsing layer of the underlying framework, **before** the request reaches the Orvaxis runtime.

**Express** — body parsing is opt-in. Pass a `limit` to `express.json()` (default `"100kb"`):

```ts
import express from "express"
import { createExpressServer } from "orvaxis/express"

const server = express()
server.use(express.json({ limit: "256kb" }))
server.use(express.urlencoded({ limit: "256kb", extended: true }))

const adapter = createExpressServer(app, server)
```

**Fastify** — the `bodyLimit` constructor option applies globally (default: `1048576` = 1 MB):

```ts
import Fastify from "fastify"
import { createFastifyServer } from "orvaxis/fastify"

const fastify = Fastify({ bodyLimit: 256 * 1024 })   // 256 KB

const adapter = createFastifyServer(app, fastify)
```

**Custom adapters and `testRequest`** — neither enforces a body size limit. For custom adapters, implement the check at the stream level before forwarding the parsed body to `app.handle`. The `testRequest` helper is for unit tests where body size is controlled by the test author.

---

## Error responses

Every error response from the built-in adapters follows a standard `ErrorResponse` envelope:

```ts
import type { ErrorResponse } from "orvaxis"
// { error: string; code?: string; requestId?: string; details?: unknown }
```

Fields populated on every response:

| Field | Source | Always present |
|---|---|---|
| `error` | `sanitizeErrorMessage(err)` | yes |
| `code` | `err.code` when set on `HttpError` | no |
| `requestId` | request's `X-Request-ID` value | yes |
| `details` | `err.details` when set on `HttpError` | no |

Message sanitization depends on `NODE_ENV`:

| Environment | Generic `Error` | `HttpError` |
|---|---|---|
| `production` | `"Internal Server Error"` | original message |
| anything else | original message | original message |

`HttpError` messages are always forwarded because they are intentional user-facing responses. All other error messages are hidden in production to avoid leaking internal details such as stack traces, file paths, or database error text.

**This includes errors that never reach the Orvaxis runtime.** A malformed JSON body rejected by `express.json()`, or a request over Fastify's `bodyLimit`, happens in the underlying framework's own parsing layer, before Orvaxis's routing and policies ever run. Both adapters register a dedicated error handler for this case (a 4-arg middleware on Express, `fastify.setErrorHandler` on Fastify) so these responses go through the same `ErrorResponse` envelope and carry the same `requestId` — instead of Express's default HTML error page or Fastify's native `{ statusCode, code, error, message }` shape.

The built-in router applies this rule to its own 404: outside production the message includes the unmatched path (`"Not Found: /api/users/42"`) to make debugging faster; in production it falls back to the generic `"Not Found"` to avoid reflecting user-controlled input in the response body.

`buildErrorBody` and `sanitizeErrorMessage` are exported for custom adapters:

```ts
import { buildErrorBody } from "orvaxis"

// in a custom adapter's catch block — produces the full ErrorResponse envelope:
res.status(err.status ?? 500).json(buildErrorBody(err, requestId))
```

## Request ID

Both adapters automatically assign a request ID on every request and return it in the `X-Request-ID` response header. The ID is also available as `ctx.req.id` throughout the entire execution lifecycle.

Priority order for the ID value:

1. `X-Request-ID` header from the incoming request — honours upstream propagation (API gateway, service mesh, distributed tracing)
2. Fastify's native request ID (Fastify adapter only)
3. `crypto.randomUUID()` — generated if none of the above is present

```ts
app.on("afterPipeline", (ctx) => {
  console.log(ctx.req.id) // always defined — e.g. "550e8400-e29b-41d4-a716-446655440000"
})
```

The header name is configurable via `requestIdHeader` on `AdapterOptions`, for stacks that use a different convention (`X-Correlation-ID`, `X-Trace-ID`, …). It applies to both reading the incoming header and setting the outgoing one — the default remains `X-Request-ID`:

```ts
const server = createExpressServer(app, undefined, { requestIdHeader: "X-Correlation-ID" })
// same option name on createFastifyServer
```

`loggerPlugin` automatically includes the ID in every structured log:

```
{ type: "request", method: "GET", path: "/api/users", requestId: "550e8400-e29b-41d4-a716-446655440000" }
{ type: "response", method: "GET", path: "/api/users", status: 200, durationMs: 8, requestId: "550e8400-e29b-41d4-a716-446655440000" }
```

## Writing a custom adapter

Any adapter needs to:
1. Ensure `req.path` is a plain path string (no query string)
2. Create an `AbortController`, attach its `signal` to the request, and pass the controller as the third argument to `withTimeout` so that in-flight work is cancelled when the deadline expires
3. Enforce a body size limit at the stream level before forwarding the parsed body to `app.handle` — Orvaxis does not apply any limit of its own
4. Call `app.handle(req, res)` (wrapped in `withTimeout` if a deadline is needed) and catch thrown errors, using `buildErrorBody(err, requestId)` to build the response body
5. Return `{ listen(port, onListen?), close() }` to satisfy the `ServerAdapter` interface
6. In `close()`, call `server.closeIdleConnections()` before `server.close()` to release idle keep-alive connections immediately, then set a `setTimeout(() => server.closeAllConnections(), shutdownTimeout)` deadline (default 10 s) that force-closes remaining connections if they do not drain in time; clear the timer in the close callback so it never fires when shutdown completes cleanly

---
