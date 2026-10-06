# HTTP adapters

An adapter connects Orvaxis to a Node.js HTTP framework: it turns the incoming request into an `OrvaxisRequest`, runs the lifecycle, and writes the response. Two are included, for Express and Fastify. This page covers choosing and installing one, creating a server, how it sits next to your framework, request parsing and limits, error responses, request IDs, and writing your own. Deadlines, cancellation and shutdown have their own page: [Timeouts and graceful shutdown](/guide/timeouts-and-shutdown); streamed responses are in [Streaming](/guide/streaming).

## Choose and install

| Adapter | Create with | Peer dependency | Tested against |
|---|---|---|---|
| Express | `createExpressServer` from `orvaxis/express` | `express ^4.20 \|\| ^5` (types: `@types/express`) | Express 4.22 and 5.2 |
| Fastify | `createFastifyServer` from `orvaxis/fastify` | `fastify ^5` | Fastify 5.8 |

```bash
npm install orvaxis express           # or: npm install orvaxis fastify
npm install -D @types/express         # TypeScript projects using Express
```

Install only the framework you use. Both peers are optional, and each adapter has its own subpath so that importing `orvaxis` never needs either; `orvaxis`, `orvaxis/testing` and `orvaxis/openapi` need neither, and importing `orvaxis/express` or `orvaxis/fastify` without its peer fails with a module-not-found error that names the package. Node.js 22.13 or later is required. The adapter tests run on every change against the versions in the last column (`pnpm test:compat`); the lowest declared versions (Express 4.20, Fastify 5.0) are not tested separately.

## Create and run a server

Both adapters take your `Orvaxis` app, an optional framework instance, and options, and return `{ listen, close }`:

```ts
import express from "express"
import Fastify from "fastify"
import { createExpressServer } from "orvaxis/express"
import { createFastifyServer } from "orvaxis/fastify"

const expressServer = createExpressServer(app)                       // creates its own Express app
const fastifyServer = createFastifyServer(app, Fastify(), { timeout: 10_000 }) // or bring your instance

await expressServer.listen(3000, (port) => console.log(`listening on ${port}`))
// listen(0) picks a free port; onListen receives the one actually bound
await expressServer.close()
```

Run a complete example from a checkout: `pnpm exec tsx examples/express-server.ts` (Express, port 3000) or `pnpm exec tsx examples/fastify-server.ts` (Fastify, port 3004), then `curl -i http://localhost:3000/api/hello`.

| Option (`AdapterOptions`) | Default | Meaning |
|---|---|---|
| `timeout` | 30 000 ms | per-request deadline; `0` disables it. See [Timeouts](/guide/timeouts-and-shutdown) |
| `shutdownTimeout` | 10 000 ms | how long `close()` waits before cutting connections; `0` waits indefinitely |
| `logger` | `console` | receives errors that happen after a response was sent |
| `requestIdHeader` | `X-Request-ID` | header read for the request ID and set on the response |

`listen` rejects with `Server is already listening. Call close() first.` if called twice, and `close()` resolves even when nothing is listening, so calling it twice is safe. An Express adapter can `listen` again after `close()`; a Fastify instance cannot be reopened (Fastify throws), so create a new `Fastify()` and adapter to restart.

## Full runtime or Express guard

| | Full-runtime adapter | Express policy guard |
|---|---|---|
| Handler | declared in Orvaxis | stays in Express |
| What runs | the whole lifecycle | pre-validation policies only |
| Frameworks | Express, Fastify | Express only |
| Guide | this page | [Integrate an existing route](./integrate-existing-route.md) |

The guard is `createExpressPolicyGuard` from `orvaxis/express`. There is no Fastify guard.

## Mounting next to your framework

A full-runtime adapter mounts Orvaxis as a catch-all, so routing, hooks and declared validation come from the Orvaxis runtime for everything it receives. How it coexists with the framework's own routes differs, and both rules were checked:

- **Express.** The adapter registers one middleware on the Express app and never calls `next()`. Routes and middleware you registered **before** `createExpressServer` run first and can answer; anything registered **after** it is never reached, because Orvaxis answers every request (a path Orvaxis does not know gets its `404` envelope). Register `express.json()` and similar before the adapter.
- **Fastify.** Orvaxis is a catch-all route (`/*`), so routes you declare on the Fastify instance win for their own paths (a `/health` route keeps working) and Orvaxis handles the rest. Fastify's own schema validation applies to Fastify routes; Orvaxis routes use their Orvaxis [schemas](./typed-validation.md).

Neither framework's route trie or compiled validation is used for Orvaxis routes. Choose the adapter for the HTTP transport and the integrations you need; measure your own application before drawing performance conclusions.

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

- Validate query params with `route.schema.query` (see [Typed input validation](./typed-validation.md)) — this reshapes and checks `ctx.req.query` at the boundary regardless of adapter.
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

## Where validation happens

Two layers can reject a request and they answer differently. The framework's body parser runs first: a malformed or oversized body is rejected with the framework's status (for example `413`) before Orvaxis routes it, and the adapter still wraps that in the standard error envelope (below). Orvaxis then validates declared fields with `route.schema` and answers `422` ([Typed input validation](./typed-validation.md)). In Express, a body that no parser read is `undefined` in `ctx.req.body`; Fastify parses JSON by default.

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
