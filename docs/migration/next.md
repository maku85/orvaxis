# Unreleased changes after 0.4.0

> **Not in the published package.** Everything on this page exists on the `main` branch only and ships with the next release. The published version is 0.4.0. Upgrading from 0.3.1 instead? See [Migrating from 0.3.1 to 0.4.0](/migration/0.3.1-to-0.4.0) (this URL used to hold that guide).

Behavior that can affect existing code is listed first. The [changelog](https://github.com/maku85/orvaxis/blob/main/CHANGELOG.md) has the complete list under *Unreleased*.

## OpenAPI export is stricter

`generateOpenApiDocument` now raises a `TypeError` naming the route where it previously approximated or overwrote:

- **Wildcard routes** (`/files/*path`) used to appear as a path that is not a valid OpenAPI template. Exclude them explicitly: `exclude: (route) => route.path.includes("*")`.
- **Collisions** — the same operation twice, or templates differing only in parameter names (`GET /items/:id` with `POST /items/:itemId`) — are errors instead of overwriting.
- **Converter output** with local references such as `#/$defs/x` is rejected; inline it or declare it in the new `componentSchemas` option and reference `#/components/schemas/<name>`.

New, additive: a route-level `openapi` object (`operationId`, `summary`, `tags`, optional `body`, media types) and the options above. See the [reference](/reference/core-concepts#response-contracts-and-openapi).

## Disconnected clients stop work

The built-in adapters abort `ctx.req.signal` when the client disconnects, and the runtime stops before the next stage (middleware, handler) for such a request. The Express policy guard no longer calls `next()` after a disconnect, so the existing handler is not invoked late. Shutdown still lets requests in progress finish.

## Terminal policy decision survives `maxEvents`

The decision that denied the request or failed evaluation is always recorded, even past the limit, so a truncated trace still explains the stop (`maxEvents` bounds the other decisions). The 0.4.0 limitation described in the 0.4.0 guide no longer applies on `main`.

## Additions

- `policyId` and `declarationIndex` on policy decisions, matching `inspectRoutes()` IDs.
- `buildRequestReport()` for a serializable, privacy-bounded request report.
- `buildProtectionReport()` and `diffProtectionReports()` in `orvaxis/testing` for protection changes in CI.
- `formatExecutionSummary()` shows the request method, the full route template, and the status actually sent.
