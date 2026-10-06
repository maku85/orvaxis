# Examples

Every example is an executable source in the repository's `examples/` directory, shown by command rather than copied here, so the code and the way you run it can be reviewed together. The catalog is grouped by what you want to learn. Each row says what to run, on which port, what you should see, and what it needs.

**How to read the rows.** Run every command from the repository root after `pnpm install`; the examples use the repository's sources, Node.js 22.13 or later, and the repository's development dependencies (`zod` for validation, `express`, `fastify` and `@opentelemetry/api` as the adapters' peers). A port is the default; set `PORT` to change it, so two examples never have to fight over one. Servers keep running until you stop them (Ctrl+C). **main** marks an example that relies on behavior that exists on the `main` branch but not in the published 0.4.0 package (see [Unreleased changes](/migration/next)); the others work with 0.4.0. Fixtures (users, API keys, tenants, tasks) are in-memory demonstration data: they have no persistence, reset on restart, and are not real authentication or authorization data.

The commands and outputs below are not taken on trust: `pnpm test:examples` starts these examples and checks that they answer as stated, and `pnpm check:snippets` keeps the code shown in the guides identical to the examples.

## Start

| Example | Run it | You should see | Needs |
|---|---|---|---|
| [`quickstart.ts`](https://github.com/maku85/orvaxis/blob/main/examples/quickstart.ts), the [Get started](/guide/getting-started) guide | `pnpm exec tsx examples/quickstart.ts` on port 3000 | `curl -H 'x-user-id: alice' localhost:3000/api/reports/alice` → 200; with `bob` → 403; with no header → 401 | Express |

## Execution: lifecycle, routing, hooks and plugins

| Example | Run it | You should see | Needs |
|---|---|---|---|
| [`execution-order.ts`](https://github.com/maku85/orvaxis/blob/main/examples/execution-order.ts), [How a request runs](/guide/execution-model) | `pnpm exec tsx examples/execution-order.ts` | one block per scenario listing hooks, policies and middleware in the order they ran | none |
| [`wildcard-routing.ts`](https://github.com/maku85/orvaxis/blob/main/examples/wildcard-routing.ts), [Routing and groups](/guide/routing-and-groups) | `pnpm exec tsx examples/wildcard-routing.ts` on port 3005 | `curl localhost:3005/files/docs/readme.md` → `{"filepath":"docs/readme.md"}`; `/api/status` → `{"status":"ok"}`; anything else → the catch-all 404 | Express |
| [`hooks-and-plugins.ts`](https://github.com/maku85/orvaxis/blob/main/examples/hooks-and-plugins.ts), [Middleware and hooks](/guide/middleware-and-hooks) | `pnpm exec tsx examples/hooks-and-plugins.ts` on port 3002 | `curl localhost:3002/api/fast` → `{"response":"immediate"}` and `[REQ]`, `[HANDLER]`, `[RES]` lines on the server's console; an unknown path → a branded 404 | Express |
| [`custom-plugin.ts`](https://github.com/maku85/orvaxis/blob/main/examples/custom-plugin.ts), [Plugins](/guide/plugins) | `pnpm exec tsx examples/custom-plugin.ts` | `request.duration_ms=<ms>` and `request.error.get=1` | none |

## Policies and authorization

| Example | Run it | You should see | Needs |
|---|---|---|---|
| [`policy-server.ts`](https://github.com/maku85/orvaxis/blob/main/examples/policy-server.ts) | `pnpm exec tsx examples/policy-server.ts` on port 3001 | `/api/hello` without `x-api-key` → 403; with any key → 200; `/api/admin` needs the key in `ADMIN_API_KEY` | Express |
| [`express-existing-route.ts`](https://github.com/maku85/orvaxis/blob/main/examples/express-existing-route.ts), [Integrate an existing route](/guide/integrate-existing-route) (**main** for the policy ID in the explanation) | `pnpm exec tsx examples/express-existing-route.ts` on port 3005 | `curl -H 'x-user-id: alice' localhost:3005/api/documents/alice` → 200; with `bob` → 403 | Express |
| [`policy-diagnostics.ts`](https://github.com/maku85/orvaxis/blob/main/examples/policy-diagnostics.ts), the [trace demo](/demo/policy-traces) and [Diagnose a 403](/guide/diagnose-403) (**main**) | `pnpm exec tsx examples/policy-diagnostics.ts` (add a scenario id such as `policy-error` for one scenario and its JSON report) | six scenarios (200, 403, policy error, 422, handler error, truncated trace), each with `Stopped by:` where a policy decided | none |
| [`tenant-tasks-server.ts`](https://github.com/maku85/orvaxis/blob/main/examples/tenant-tasks-server.ts), [Multi-tenant demo](/guide/multi-tenant-demo) | `pnpm exec tsx examples/tenant-tasks-server.ts` on port 3002 | `curl -H 'x-api-key: key-alice' localhost:3002/api/tenants/acme/tasks/task-1` → 200; `key-bob` → 403; no key → 401 | Express; demo keys `key-alice`, `key-bob`, `key-maya`, `key-admin` |

## Types and contracts

| Example | Run it | You should see | Needs |
|---|---|---|---|
| [`typed-schema.ts`](https://github.com/maku85/orvaxis/blob/main/examples/typed-schema.ts), [Typed input validation](/guide/typed-validation) | `pnpm exec tsx examples/typed-schema.ts` | `200 { quantity: 3, id: 42, page: 2, userHeaderLength: 5 }`: the processed values of one `defineRoute` request | zod |
| [`schema-validation.ts`](https://github.com/maku85/orvaxis/blob/main/examples/schema-validation.ts) | `pnpm exec tsx examples/schema-validation.ts` on port 3003 | `curl -H 'content-type: application/json' -d '{"name":"Alice","age":30}' localhost:3003/api/users` → 201; `{"name":"","age":-1}` → 422 | Express, zod |
| [`contracts.ts`](https://github.com/maku85/orvaxis/blob/main/examples/contracts.ts), [Response contracts](/guide/response-contracts) | `pnpm exec tsx examples/contracts.ts` | thirteen request scenarios with status, error envelope, body and recorded events, then two configuration errors | zod |
| [`openapi-export.ts`](https://github.com/maku85/orvaxis/blob/main/examples/openapi-export.ts), [OpenAPI export](/guide/openapi) (**main** for `exclude` and metadata) | `pnpm exec tsx examples/openapi-export.ts` | an OpenAPI 3.1 document with two paths on stdout | zod |

## Observability

| Example | Run it | You should see | Needs |
|---|---|---|---|
| [`observability.ts`](https://github.com/maku85/orvaxis/blob/main/examples/observability.ts), [Observability](/guide/observability) (**main**) | `pnpm exec tsx examples/observability.ts` | the trace, debug steps, request report and log records of four requests | none |
| [`debug-trace.ts`](https://github.com/maku85/orvaxis/blob/main/examples/debug-trace.ts) | `pnpm exec tsx examples/debug-trace.ts` on port 3003 | `curl localhost:3003/api/users` → the sample users, and a JSON execution summary on the server's console | Express |
| [`typed-context.ts`](https://github.com/maku85/orvaxis/blob/main/examples/typed-context.ts), [Request context](/guide/request-context) (**main** for typed `app.group`) | `pnpm exec tsx examples/typed-context.ts` on port 3004 | `curl localhost:3004/api/me` → 401; with `-H 'x-api-key: k-1'` → `{"id":"u-1","apiKey":"k-1"}` | Express |
| [`otel-local.ts`](https://github.com/maku85/orvaxis/blob/main/examples/otel-local.ts), [OpenTelemetry](/guide/opentelemetry) | `pnpm exec tsx examples/otel-local.ts` | the span tree for a completed, a denied and a not-found request, with no SDK or collector | `@opentelemetry/api` |
| [`otel-plugin.ts`](https://github.com/maku85/orvaxis/blob/main/examples/otel-plugin.ts) | `pnpm exec tsx examples/otel-plugin.ts` on port 3004 | `curl localhost:3004/api/users/42` → 200. **Spans are exported only if you configure an SDK, exporter and collector**; without them the tracer is a no-op | Express, `@opentelemetry/api`, your own SDK and backend to see spans |

## HTTP and streaming

| Example | Run it | You should see | Needs |
|---|---|---|---|
| [`express-server.ts`](https://github.com/maku85/orvaxis/blob/main/examples/express-server.ts), [HTTP adapters](/guide/http-adapters) | `pnpm exec tsx examples/express-server.ts` on port 3000 | `curl localhost:3000/api/hello` → `{"message":"Hello from Orvaxis"}`; `ctx.logs` printed on the console | Express |
| [`fastify-server.ts`](https://github.com/maku85/orvaxis/blob/main/examples/fastify-server.ts) | `pnpm exec tsx examples/fastify-server.ts` on port 3004 | `curl -H 'x-api-key: demo' localhost:3004/api/users` → the sample users; without the header → 403 | Fastify |
| [`streaming.ts`](https://github.com/maku85/orvaxis/blob/main/examples/streaming.ts), [Streaming](/guide/streaming) | `pnpm exec tsx examples/streaming.ts` on port 3000 | `curl -N localhost:3000/api/events` → server-sent events; `/api/records` → three JSON lines; `/api/file` → the fixture file | Express |
| [`graceful-shutdown.ts`](https://github.com/maku85/orvaxis/blob/main/examples/graceful-shutdown.ts), [Timeouts and shutdown](/guide/timeouts-and-shutdown) | `pnpm exec tsx examples/graceful-shutdown.ts` on port 3006 | `curl -N localhost:3006/api/events`, then Ctrl+C or `kill -TERM <pid>`: the stream receives `event: bye`, the process logs `closed` and exits 0 | Express |
| [`http-lifecycle.ts`](https://github.com/maku85/orvaxis/blob/main/examples/http-lifecycle.ts), [Timeouts and shutdown](/guide/timeouts-and-shutdown) (**main**: two shutdown fixes) | `pnpm exec tsx examples/http-lifecycle.ts` | starts short-lived local servers and prints the same results for Express and Fastify (takes several seconds) | Express, Fastify |
| [`realistic-express.ts`](https://github.com/maku85/orvaxis/blob/main/examples/realistic-express.ts) | `pnpm exec tsx examples/realistic-express.ts` on port 3000 | a task API: `curl -H 'x-api-key: key-alice' localhost:3000/api/v1/tasks` → 200, no key → 401; keys `key-alice`, `key-bob`, `key-admin`; in-memory store | Express, zod |
| [`realistic-fastify.ts`](https://github.com/maku85/orvaxis/blob/main/examples/realistic-fastify.ts) | `pnpm exec tsx examples/realistic-fastify.ts` on port 3001 | the same API on Fastify | Fastify, zod |

## Testing and CI

| Example | Run it | You should see | Needs |
|---|---|---|---|
| [`examples/testing/`](https://github.com/maku85/orvaxis/tree/main/examples/testing), [Testing](/guide/testing) | `pnpm exec vitest run examples/testing` | eight passing tests: `testRequest`, a permission matrix, a static requirement, and the case the static check cannot catch | zod |
| [`policy-matrix.ts`](https://github.com/maku85/orvaxis/blob/main/examples/policy-matrix.ts) | `pnpm exec tsx examples/policy-matrix.ts` | `Policy matrix: PASS` with five anonymous/owner/other-user/other-tenant/admin cases | none |
| [`policy-ci-check.ts`](https://github.com/maku85/orvaxis/blob/main/examples/policy-ci-check.ts), [CI article](/articles/authorization-requirements-in-ci) | `pnpm exec tsx examples/policy-ci-check.ts` | `Policy requirements: PASS` (with one `UNVERIFIABLE` conditional scope and one `EXCLUDED` exception) and `Policy matrix: PASS`; exits non-zero on failure | none |
| [`tenant-tasks-check.ts`](https://github.com/maku85/orvaxis/blob/main/examples/tenant-tasks-check.ts) | `pnpm check:tenant-demo` | static requirements and a seven-case matrix for the multi-tenant demo, plus two traces | none |
| [`protection-report.ts`](https://github.com/maku85/orvaxis/blob/main/examples/protection-report.ts), [CI article](/articles/authorization-requirements-in-ci) (**main**) | `pnpm check:protection` | `No changes against the baseline.`; fails if a policy was removed or weakened | none |
| [Benchmarks](/benchmarks) | `pnpm bench:run` | local microbenchmark tables for each layer | none |

For actual request validation responses, start `pnpm exec tsx examples/schema-validation.ts`, then run:

```bash
curl -i -H 'content-type: application/json' -d '{"name":"Alice","age":30}' http://localhost:3003/api/users
curl -i -H 'content-type: application/json' -d '{"name":"","age":-1}' http://localhost:3003/api/users
```

The responses are 201 and 422. The example registers `express.json()` before the adapter; without a body parser every body would be `undefined` and fail validation. No example needs a real API key or credential; the OpenTelemetry sample only exports spans if you initialize an SDK and exporter and run a collector.
