# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
