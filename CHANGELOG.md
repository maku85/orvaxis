# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
