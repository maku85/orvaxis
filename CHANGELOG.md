# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-05-15

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
