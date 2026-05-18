# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`PolicyScope.path` string matching is now prefix-based** — previously a string `scope.path` matched only the exact request path, so `scope: { path: '/api' }` silently skipped requests to `/api/v1/users`. The match now succeeds if `ctx.req.path === scope.path` or `ctx.req.path.startsWith(scope.path + "/")`, so a single scope entry covers the entire sub-tree without requiring a RegExp. False positives are not possible: `"/api"` does not match `"/apiv2"`. `PolicyScope.path` now also accepts a predicate function `(path: string) => boolean` for cases that need custom logic (e.g. excluding a specific sub-path). `RegExp` continues to work as before.

- **HEAD responses now include `Content-Length` and `Content-Type`** — `wrapForHead` (the internal wrapper that suppresses the response body for `HEAD → GET` fallback requests) previously called `res.end()` without computing the body size, violating RFC 9110 which requires HEAD responses to carry the same headers a GET would return. `json(body)` now serializes the body with `JSON.stringify`, sets `Content-Type: application/json`, and sets `Content-Length` to the UTF-8 byte length of the serialized string before calling `end()`. `send(body)` computes the byte length of the body (Buffer length, UTF-8 string length, or `0` for null/undefined) and sets `Content-Length` accordingly. The body itself is never written to the socket in either case.

- **`otelPlugin` now traces 404 and 405 responses** — previously the `onRequest` hook (where `otelPlugin` creates its span) fired after routing, so requests that failed to match a route exited via the error path without ever creating a span. 404 and 405 traffic — including path-scanning attacks and misconfigured clients — was invisible in traces and error dashboards. The runtime now fires `onRequest` before routing so every request gets a span. For `OPTIONS` preflight, `ctx.meta.allowedMethods` is pre-populated before `onRequest` fires so `corsPlugin` can still read it. The span name is initially set to the raw request path (`GET /users/42`); `otelPlugin` updates it to the route template (`GET /users/:id`) in the existing `beforeHandler` hook once routing has succeeded. Errors now record the HTTP status from `HttpError.status` rather than `ctx.res.statusCode`, which is still `200` at error-hook time.

### Changed

- **`testRequest` moved to `orvaxis/testing`** — `testRequest`, `TestRequestInit`, and `TestResponse` are no longer exported from the main `orvaxis` entry point. Import them from `orvaxis/testing` instead: `import { testRequest } from "orvaxis/testing"`. This keeps test-only code out of production bundles for consumers that do not use a tree-shaking bundler. `createMockResponse` and `MockResponse` were already on this sub-path; all testing utilities are now consolidated there.

### Added

- **`corsPlugin` — built-in CORS support** — a new `corsPlugin(options?)` factory handles cross-origin requests for any adapter (Express, Fastify, or custom). Register it like any other plugin: `app.register(corsPlugin())`. On every matched request `onRequest` adds `Access-Control-Allow-Origin` (and optionally `Vary: Origin`, `Access-Control-Allow-Credentials`, `Access-Control-Expose-Headers`). For unmatched `OPTIONS` preflight requests the runtime now responds `204` with `Allow` + `Access-Control-Allow-Methods` / `Access-Control-Allow-Headers` / `Access-Control-Max-Age` instead of `404`. Available options: `origin` (string / string[] / RegExp, default `"*"`), `methods`, `allowedHeaders`, `exposedHeaders`, `credentials`, `maxAge`. `corsPlugin` and `CorsOptions` are exported from the main entry point.

### Fixed

- **Validation errors now include structured `details`** — `HttpError` gains an optional `details?: unknown` field. `schemaValidationPlugin` populates it by extracting `{ path, message }` pairs from the validator's error cause (any object whose `.issues` is an array — compatible with Zod, and any library that follows the same convention). The adapter error response now carries `details` alongside `error` when present: `{ error: "Validation failed: body", details: [{ path: ["name"], message: "Required" }, ...] }`. Validators that do not expose `.issues` are unaffected — `details` is omitted. A new `buildErrorBody(err)` utility in `http/timeout.ts` consolidates response construction in both adapters; `sanitizeErrorMessage` remains exported for custom adapters.

- **405 Method Not Allowed** — when a request path is registered but the incoming HTTP method is not, the runtime now responds with `405 Method Not Allowed` instead of `404 Not Found`. The response includes an `Allow` header listing every method registered on that path; `HEAD` is added automatically whenever `GET` is registered, consistent with the existing `HEAD → GET` fallback. `Router` exposes a new `allowedMethods(path): string[]` method for adapters and tooling that need the same information.

### Added

- **`otelPlugin` — OpenTelemetry integration** — a new `otelPlugin({ tracer })` factory creates an OpenTelemetry `SERVER` span per request using the provided `@opentelemetry/api` `Tracer`. On each request: the incoming `traceparent`/`tracestate` headers are extracted via `propagation.extract` to propagate distributed trace context; a span is started with `http.request.method`, `url.path`, and `orvaxis.request_id` attributes; on success (`afterPipeline`) the response status code is set and any `traceMiddleware` events are added as OTel span events before the span is ended with `OK` status; on error (`onError`) the exception is recorded and the span is ended with `ERROR` status. Requires `@opentelemetry/api ^1.0.0` as an optional peer dependency — users configure their own SDK and exporter. `otelPlugin` and `OtelPluginOptions` are exported from the main entry point.

- **`orvaxis/testing` sub-path export** — `createMockResponse` and `MockResponse` are no longer exported from the main entry point. Import them from the new `orvaxis/testing` sub-path instead: `import { createMockResponse } from "orvaxis/testing"`. The sub-path is excluded from the production bundle and does not appear in autocomplete for users who do not import it. Both CJS (`require`) and ESM (`import`) conditions are mapped, each with their own `types` pointer.

- **`shutdownTimeout` option** — both adapters accept a new `shutdownTimeout` field in `AdapterOptions` (default `10 000 ms`). After `close()` is called, a deadline timer fires `server.closeAllConnections()` if active connections have not drained within the limit. This prevents a stalled handler from keeping the process alive indefinitely under orchestrators (Kubernetes, systemd) that would otherwise send SIGKILL after their own grace period. Set `shutdownTimeout: 0` to disable the forced close.

- **`ctx.params` shortcut** — `OrvaxisContext` now exposes a `readonly params: Record<string, string>` getter that returns `ctx.meta.route?.params ?? {}`. Handlers no longer need the verbose `ctx.meta.route!.params` pattern and the non-null assertion it requires; `ctx.params.id` is always safe inside a handler.

- **`defineRoute<TBody>()` helper** — a thin wrapper around a route definition that infers the Zod (or any `.parse()`-based) schema's body type and propagates it into `ctx.req.body` inside the handler. Eliminates `ctx.req.body as z.infer<typeof MySchema>` casts with no runtime overhead. Accepts an optional second type argument `TState` to simultaneously type `ctx.state`. Non-breaking — plain route objects continue to work unchanged.

- **SSE timeout auto-cancel** — both HTTP adapters (Express and Fastify) now automatically cancel the per-request timeout timer the first time `ctx.res.write()` is called. Long-lived streaming connections (SSE, chunked transfer) are no longer killed by the default 30 s timeout without requiring `timeout: 0` on the entire server. Normal request/response routes retain the full timeout.

### Added

- **`ctx.logs` documented as public API** — `OrvaxisContext.logs: string[]` is now explicitly documented as a request-scoped log accumulator. The framework initialises it as `[]` and leaves it entirely user-owned; hooks, middleware, and handlers can push formatted strings and read them back at any later lifecycle point. `examples/express-server.ts` is updated to demonstrate the full push-then-read pattern using `onRequest` and `afterPipeline`.

- **`PluginContext` interface** — a new public type that describes the minimal surface a plugin's `apply` function receives. It exposes only `hooks.on`, which is the only hook-system capability plugins need. `Plugin.apply` now accepts `PluginContext` instead of `Runtime`, and `Runtime` is no longer exported from the package entry point. Existing plugins that rely on type inference (the common case) are unaffected; plugins that explicitly annotated the parameter as `Runtime` should update to `PluginContext`.

- **`OrvaxisRequest.body` field** — `body?: unknown` is now an explicit, named field on `OrvaxisRequest` instead of relying on the `[key: string]: unknown` index signature. Handlers on plain routes can now read `ctx.req.body` without a cast. `defineRoute` continues to narrow the type to the inferred schema type (`TBody`) inside the handler.

- **Dual CJS + ESM build** — the package now ships both a CommonJS build (`dist/`) and an ES Module build (`dist/esm/`). The `exports` map exposes them via the `"require"` and `"import"` conditions respectively, each with its own `types` pointer. A `dist/esm/package.json` marker (`{ "type": "module" }`) ensures Node.js treats the ESM files correctly without changing the top-level `"type"` field. Bundlers (webpack 5, Rollup, esbuild, Vite) and native ESM (`import`) consumers pick up the ESM build automatically; existing CJS consumers (`require`) are unaffected. Two new build scripts are exposed: `build:cjs` and `build:esm`.

### Fixed

- **Sub-millisecond precision for trace and debug timestamps** — `Tracer` and `Debugger` previously used `Date.now()` for every event, so multiple events within the same millisecond received identical timestamps and their relative order in `combinedTimeline` was non-deterministic. Both now record a `performance.now()` origin at the start of each request and compute each event's timestamp as `startTime + (performance.now() - startPerf)`, producing wall-clock-aligned, monotonically increasing values with sub-ms decimal precision. `Trace.startTime` and `Trace.endTime` remain `Date.now()`-based epoch milliseconds; no type changes. The `Debugger` stores its per-request origin in a private `WeakMap<DebugInfo, PerfOrigin>` so entries across the same request share one reference point without leaking memory or mutating the public `DebugInfo` type.

- **`defineRoute` internal cast scoped to handler only** — previously `defineRoute` used `route as unknown as Route<TState, TMeta>` which bypassed type checking on the entire route object. The function now destructures the route, spreads all non-handler fields (verified by TypeScript via `Omit<Route, "handler">`), and applies the `as unknown as` cast only to the handler property where it is unavoidable due to function parameter contravariance. All other `Route` fields (`method`, `path`, `schema`, `middleware`, `policies`) are now structurally verified at compile time.

- **Policy scope method matching is now case-insensitive** — `PolicyEngine.matchesScope` previously compared `ctx.req.method` against `scope.method` with a raw string equality check. Since `scope.method` is typed as `HttpMethod` (always uppercase) but `ctx.req.method` is never normalised in `validateRequest` or `createContext`, a request arriving with a lowercase method (e.g. from a custom adapter or `testRequest`) would silently bypass any policy that declared a `scope: { method: "GET" }`. The comparison now calls `.toUpperCase()` on the request method before comparing, consistent with how the router trie already handles method normalisation at match time.

- **`Object.assign` on getter-only request properties** — both adapters previously called `Object.assign(req, { path, method, ... })` directly on the framework's request object. In ECMAScript strict mode (the default for ES modules used by Vitest and modern bundlers), assigning to a property that has only a getter on the prototype throws a `TypeError`. Both adapters now use `Object.create(req)` + `Object.defineProperties` to add the orvaxis-specific fields as own properties without invoking `[[Set]]`, which correctly shadows any prototype getters (e.g. `path` on Express, `signal` on Fastify 5) without touching the underlying request object.

## [0.2.4] - 2026-05-17

### Added

- **Streaming response support** — `OrvaxisResponse` now includes three streaming methods: `write(chunk)` sends a chunk without closing the connection, `end(chunk?)` flushes an optional final chunk and closes it, and `pipe(stream)` delegates to a `node:stream.Readable` for full stream piping. Both built-in adapters (Express and Fastify) implement these methods on the underlying response. The Fastify adapter calls `reply.hijack()` before writing to bypass Fastify's own response lifecycle and writes directly to `reply.raw`. The mock response used in `testRequest` captures chunks in a `chunks: unknown[]` array and exposes an `ended: boolean` flag, so streaming handlers are fully testable without a live server.

### Fixed

- **`query` typed on `OrvaxisRequest`** — a new `query?: Record<string, string | string[]>` field is now part of the `OrvaxisRequest` interface. Both built-in adapters populate it from the framework's already-parsed query object (`req.query` on Express, `req.query` on Fastify). `TestRequestInit` exposes the same field so query params can be passed directly to `testRequest`. `schemaValidationPlugin` correctly assigns the validated value back to the typed field. Custom adapters can populate `req.query` by parsing `req.url` or forwarding from their underlying framework.

- **Automatic HEAD → GET fallback** — `HEAD` requests now automatically fall back to the matching `GET` route when no dedicated `HEAD` route is registered. The `GET` handler runs in full (policies, middleware, hooks), but the response body is suppressed: `json()`, `send()`, and `pipe()` call `res.end()` without writing bytes, and `write()` is a no-op. Response headers set by the handler (e.g. `Content-Type`, `X-Version`) are forwarded to the client normally. A dedicated `HEAD` route always takes priority over the fallback. The fallback also works with param and wildcard routes.

- **Graceful shutdown now drains idle keep-alive connections** — both adapters now call `server.closeIdleConnections()` (Node.js ≥ 18.2) immediately before closing, so idle HTTP/1.1 keep-alive connections are released at once rather than holding the server open indefinitely. Active in-flight requests are still allowed to complete before the close callback fires. The Express adapter additionally resets its internal server reference to `null` inside the close callback, fixing a pre-existing bug that prevented calling `listen()` again on the same adapter instance after a `close()`.

- **Hook errors after the first are no longer silently lost** — `HookSystem.trigger` previously captured only the first error thrown by a lifecycle hook listener and silently discarded any subsequent ones. It now collects all errors: if exactly one listener throws the original error is re-thrown unwrapped (no change to the common case, `instanceof HttpError` still works); if more than one listener throws, a native `AggregateError` is thrown with all errors available in `.errors[]` and the message `"Multiple hook errors"`. `onError` hook failures continue to be logged and not re-thrown.

- **`exports` field in `package.json`** — added a `"exports"` map with `"types"`, `"require"`, and `"default"` conditions pointing to `dist/index.js` and `dist/index.d.ts`. Modern bundlers (webpack 5, Rollup, esbuild, Vite) and Node.js ≥ 12.7 now resolve the package through `exports` rather than `main`, which seals the public surface: importing internal paths such as `orvaxis/core/Router` now throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. The legacy `main` and `types` fields are kept for tools that do not yet understand `exports`. No ESM build is introduced — `import()` of a CJS package works via the `"default"` fallback.

- **Fastify adapter double-listen guard** — `createFastifyServer` now tracks a `listening` flag and rejects with `"Server is already listening. Call close() first."` if `listen()` is called while the server is already bound, matching the existing behaviour of the Express adapter. The flag is reset on `close()` and also on any bind failure so that a retry after an `EADDRINUSE` error is not blocked by the guard itself.

- **Duplicate route detection** — registering two routes with the same HTTP method and path pattern now throws a `TypeError` immediately at registration time rather than silently overwriting the first route. Three cases are caught: identical static or param patterns (e.g. two `GET /api/users`), conflicting parameter names at the same trie position (e.g. `/:id` then `/:userId`), and duplicate wildcard patterns (e.g. two `GET /files/*`). Routes that share a path but differ in HTTP method, or that share a pattern across different group prefixes, are not affected.

- **Request timeout now aborts in-flight work** — both adapters create an `AbortController` per request and pass it to `withTimeout`. When the deadline expires the controller is aborted before the 408 is sent, so the `AbortSignal` available as `ctx.req.signal` transitions to `aborted: true`. Handlers, middleware, and any downstream code (fetch, database drivers, node:http) that accept a signal are cancelled immediately rather than continuing to consume resources after the client has already received the timeout response. Custom adapters can replicate this behaviour by passing their own `AbortController` as the third argument to `withTimeout`.
- **Radix trie router** — `Router` now builds a per-method trie at registration time. Route matching is `O(d)` in the depth of the path (number of segments) rather than `O(n)` in the total number of registered routes. Static segments always take priority over param segments at the same level, with automatic backtracking when a static branch fails deeper in the tree. The public API (`Router.group`, `Router.match`, `Router.routes`) is unchanged.
- **`HttpMethod` type** — a new exported union type `"GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"` replaces the inline literal in `PolicyScope` and is now used for `Route.method` and `RouteInfo.method`. Both `validateGroup` and the router trie normalise method strings to uppercase, so registering a route with `"get"` or matching a request that carries `"get"` both work correctly. Unknown methods (e.g. `"FOOBAR"`) are rejected at registration time with a `TypeError`.
- **Wildcard / catch-all routes** — route paths may now end with `*` (unnamed, captured as `params["*"]`) or `*name` (named, captured as `params["name"]`). A wildcard segment must be the last segment in the pattern; placing it in the middle throws a `TypeError` at registration time. Priority is static > param > wildcard, so more specific routes always win. Each captured segment is URL-decoded individually before being joined with `/`. See `examples/wildcard-routing.ts` for a working demonstration.

## [0.2.3] - 2026-05-15

### Added

- **Request timeout** — both `createExpressServer` and `createFastifyServer` now accept an optional third argument `AdapterOptions`. The `timeout` field (number, milliseconds) sets a per-request deadline: when a handler takes longer than the limit, the adapter rejects with an `HttpError(408, "Request Timeout")`. Default: `30 000 ms`. Set to `0` to disable. `AdapterOptions` and `withTimeout` are exported from the main entry point for use in custom adapters.
- **Pluggable logger** — a `Logger` interface (`{ info, error }`) is now part of the public API. Pass a logger instance through three independent entry points: `new Orvaxis({ logger })` (routes it to the hook system for meta-errors), `createExpressServer / createFastifyServer` third-arg options (`{ logger }`) (routes it to post-response error logging), and `loggerPlugin({ logger })` (routes it to request and error log lines). All three default to `console` when omitted. `Logger` and `OrvaxisOptions` are exported from the main entry point.
- **Request ID propagation** — both adapters now generate a `X-Request-ID` automatically on every request and expose it on `ctx.req.id`. If the incoming request already carries a `X-Request-ID` header (e.g. from an API gateway or upstream service), that value is reused instead of generating a new one. Fastify's native request ID is used as a secondary fallback before falling back to `crypto.randomUUID()`. The header is always present in the response.

### Added

- **`combinedTimeline` in `buildExecutionSummary`** — the summary now includes a `combinedTimeline: UnifiedEvent[]` field that merges user-emitted trace events and internal debug lifecycle entries into a single array sorted by timestamp. Each entry carries `{ kind: "trace" | "debug", name, timestamp, meta }`. `UnifiedEvent` is exported from the main entry point.

### Fixed

- **Error response sanitization** — adapter error responses no longer leak internal error messages to the client when `NODE_ENV=production`. Generic errors return `{ error: "Internal Server Error" }`; `HttpError` messages are always forwarded as-is since they are intentional user-facing responses. Outside production all messages are preserved for debugging. `sanitizeErrorMessage` is exported for custom adapters.
- **Hardcoded secret in example** — `examples/policy-server.ts` now reads the admin key from `process.env.ADMIN_API_KEY` instead of the literal string `"admin-secret"`.

### Changed

- **`loggerPlugin`** — changed from a plain plugin object to a factory function `loggerPlugin(options?)`. Update call sites from `app.register(loggerPlugin)` to `app.register(loggerPlugin())`. Accepts an optional `{ logger?: Logger }` argument to inject a custom logger. Log lines now include method, path, and request ID: `[REQ] GET /api/users req-abc-123` / `[ERR] req-abc-123 Error: …`.

### Chore

- **`.gitattributes`** — added `* text=auto eol=lf` to enforce consistent LF line endings across Windows and Linux development environments, preventing Biome formatter failures in CI.

## [0.2.1] - 2026-05-06

### Added

- **`HttpError`** — new exported class (`extends Error`) for throwing errors with an explicit HTTP status code. Accepts `status`, an optional `message`, and an optional `ErrorOptions` third argument for error chaining (`{ cause }`). Replaces all internal `Object.assign(new Error(), { status })` usages. Supports `instanceof` checks in `onError` hooks.

### Fixed

- **`schemaValidationPlugin`** — `headers` schema validation result is now applied back to `ctx.req.headers`. Previously the parsed/transformed value was discarded.
- **`HookSystem.trigger`** — all hooks in a trigger call now run even when an earlier one throws. The first error is collected and re-thrown after the loop completes, preventing cleanup hooks from being silently skipped.
- **`createExpressServer`** — errors caught after the response is already sent are now logged via `console.error` instead of being silently swallowed. `listen()` now rejects immediately if the server is already listening, and resets the internal reference on bind failure, preventing a leaked server from blocking future calls.
- **`createFastifyServer`** — same silent-error fix applied to the catch block.

### Changed

- Extracted `mergeSafe` and `UNSAFE_KEYS` into `core/utils.ts` to eliminate the duplicate definitions that existed in both `PolicyEngine` and `Runtime`.
- **`peerDependencies`** — Express range updated to `^4.20.0 || ^5.0.0`. The lower bound was raised from `4.19.0` to exclude versions affected by GHSA-rv95-896h-c2vc (Open Redirect) and GHSA-qw6h-vgh9-j6wx (XSS via `response.redirect()`), both fixed in `4.20.0`. Express 5 is now officially supported.
- **`tsconfig.json`** — `module` and `moduleResolution` updated from `CommonJS`/`node` to `node16`, removing the TypeScript 6 deprecation warning.

### Dependencies

- `@biomejs/biome` 1.9.4 → 2.4.14 (major — config migrated via `biome migrate`)
- `@types/express` 4.17.25 → 5.0.6
- `typescript` 5.9.3 → 6.0.3
- `zod` 4.3.6 → 4.4.3

## [0.2.0] - 2026-04-24

### Added

- **Test harness** — `testRequest(app, init)` helper runs the full execution cycle (policies, pipeline, middleware, handler) against an `Orvaxis` instance without an HTTP server. Returns `{ status, body, headers, ctx, error }`. Never throws. New types: `TestRequestInit`, `TestResponse`.
- **Route introspection** — `app.routes()` returns a flat `RouteInfo[]` listing all registered routes with their full path and group prefix, enabling OpenAPI generation and admin tooling.
- **`beforeHandler` / `afterHandler` hooks** — two new lifecycle events that fire immediately before and after the route handler, independent from the global pipeline. `afterHandler` does not fire when the handler throws. New values added to `HookName`.
- **`schemaValidationPlugin`** — opt-in plugin for declarative request validation via a `route.schema` field. Validates and coerces `body`, `params`, and `query`; validates `headers`. Library-agnostic: any object with a `.parse(data)` method works (Zod, TypeBox, custom). Throws status 422 with `field` and `cause` on failure.
- New public types: `SchemaField`, `RouteSchema`, `RouteInfo`, `TestRequestInit`, `TestResponse`.
- `zod` added as devDependency for examples and benchmarks.

### Changed

- `Route` type extended with optional `schema?: RouteSchema` field (backwards-compatible).
- Execution model updated: `beforeHandler` fires at step 7 and `afterHandler` at step 9, wrapping the route handler between middleware and trace finalization.
- Test coverage raised to 100% statements, branches, functions, and lines.

## [0.1.0] - 2026-04-21

### Added

- Initial release
