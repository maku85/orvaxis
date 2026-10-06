# Examples

The examples are executable repository sources. They are not copied into this page, so the commands and implementation can be reviewed together.

| Problem | Source or guide | Command and expected result |
|---|---|---|
| Protect a route with an owner policy | [Quickstart source](https://github.com/maku85/orvaxis/blob/main/examples/quickstart.ts) | `pnpm exec tsx examples/quickstart.ts`; requests show 403 for a different owner and 200 for the owner |
| Add authorization to an existing Express handler | [Integration guide](/guide/integrate-existing-route), [working source](https://github.com/maku85/orvaxis/blob/main/examples/express-existing-route.ts) | `pnpm exec tsx examples/express-existing-route.ts` on port 3005; owner header returns 200 and another identity returns 403 |
| Tell apart a denial, a policy error, a validation failure, a handler error and a truncated trace | [Interactive trace demo](/demo/policy-traces), [diagnostics source](https://github.com/maku85/orvaxis/blob/main/examples/policy-diagnostics.ts) | `pnpm exec tsx examples/policy-diagnostics.ts`; prints sanitized summaries for six scenarios (200, 403, 500 policy error, 422, 500 handler error, truncated 403). Add a scenario id, e.g. `policy-error` or `tenant:bob:task-1`, for one scenario with its JSON request report |
| Test ownership, tenant boundaries, and admin access | [Multi-tenant guide](/guide/multi-tenant-demo), [server source](https://github.com/maku85/orvaxis/blob/main/examples/tenant-tasks-server.ts) | `pnpm check:tenant-demo`; server: `pnpm exec tsx examples/tenant-tasks-server.ts` on port 3002; fixture requests return 200, 401, or 403 |
| Check route policy declarations and request outcomes | [CI policy example](https://github.com/maku85/orvaxis/blob/main/examples/policy-ci-check.ts), [permission matrix](https://github.com/maku85/orvaxis/blob/main/examples/policy-matrix.ts) | `pnpm exec tsx examples/policy-ci-check.ts` and `pnpm exec tsx examples/policy-matrix.ts`; missing requirements or unexpected results fail |
| Review which protections a change adds or removes | [Protection report source](https://github.com/maku85/orvaxis/blob/main/examples/protection-report.ts), [CI article](/articles/authorization-requirements-in-ci) | `pnpm check:protection`; prints the diff against the committed baseline and fails if a policy was removed or weakened; `pnpm update:protection-baseline` accepts an intended change |
| Export an OpenAPI 3.1 document | [OpenAPI example](https://github.com/maku85/orvaxis/blob/main/examples/openapi-export.ts), [reference](/reference/core-concepts#response-contracts-and-openapi) | `pnpm exec tsx examples/openapi-export.ts`; prints a document with parameters, 204/304, media types and operation metadata; tests validate it as OpenAPI 3.1 |
| Validate responses, post-validation policies and 422 errors | [Contract guides](/guide/response-contracts), [source](https://github.com/maku85/orvaxis/blob/main/examples/contracts.ts) | `pnpm exec tsx examples/contracts.ts`; prints thirteen request scenarios with status, error envelope, body and recorded events |
| Shut a server down without cutting off streams | [Timeouts and shutdown](/guide/timeouts-and-shutdown), [source](https://github.com/maku85/orvaxis/blob/main/examples/graceful-shutdown.ts) | `pnpm exec tsx examples/graceful-shutdown.ts` on port 3006 (`PORT` to change); `curl -N http://localhost:3006/api/events`, then Ctrl+C: the stream gets `event: bye` and the process exits 0 |
| See what timeouts, disconnects and shutdown do on both adapters | [Timeouts and shutdown](/guide/timeouts-and-shutdown), [source](https://github.com/maku85/orvaxis/blob/main/examples/http-lifecycle.ts) | `pnpm exec tsx examples/http-lifecycle.ts`; starts short-lived local servers and prints the observed results for Express and Fastify |
| Validate and coerce request input | [Schema validation example](https://github.com/maku85/orvaxis/blob/main/examples/schema-validation.ts) | `pnpm exec tsx examples/schema-validation.ts` on port 3003; valid input returns 201 and invalid input returns 422 |
| Inspect middleware and request tracing | [Tracing example](https://github.com/maku85/orvaxis/blob/main/examples/debug-trace.ts) | `pnpm exec tsx examples/debug-trace.ts` on port 3003; `curl -i http://localhost:3003/api/users` returns the sample users and prints a timeline |
| Stream server-sent events or a fixed file | [Streaming example](https://github.com/maku85/orvaxis/blob/main/examples/streaming.ts) | `pnpm exec tsx examples/streaming.ts` on port 3000; `curl -N http://localhost:3000/api/events` streams events, and `curl -i http://localhost:3000/api/file` streams a fixed fixture |
| Export request events to OpenTelemetry | [OpenTelemetry example](https://github.com/maku85/orvaxis/blob/main/examples/otel-plugin.ts) | `pnpm exec tsx examples/otel-plugin.ts` on port 3004; after configuring an SDK/exporter and collector, request `http://localhost:3004/api/users/42` |
| Compare execution overhead | [Benchmarks](/benchmarks) | `pnpm bench:run`; reports local microbenchmark results |

The examples target the current repository API and Node.js 22.13 or later. Express and Fastify server examples require the matching optional peer dependency. Run commands from the repository root after `pnpm install`; local servers and their ports are listed above or in their source files.

For actual request validation responses, start `pnpm exec tsx examples/schema-validation.ts`, then run:

```bash
curl -i -H 'content-type: application/json' -d '{"name":"Alice","age":30}' http://localhost:3003/api/users
curl -i -H 'content-type: application/json' -d '{"name":"","age":-1}' http://localhost:3003/api/users
```

The responses are 201 and 422. Run one server example at a time when examples share a port. The multi-tenant task server uses in-memory fixtures, has no persistent storage, and accepts only the demonstration keys listed in its guide. No example requires a real API key; the OpenTelemetry sample needs a separately initialized SDK/exporter and collector to export spans.

The Express demo uses in-memory fixtures and demonstration credentials. Do not treat them as production authentication, authorization data, or persistent storage.
