# OpenTelemetry

`otelPlugin` turns each request into OpenTelemetry spans. It needs the optional peer `@opentelemetry/api` and a tracer. **Orvaxis includes no SDK, exporter, collector or tracing backend:** your application configures those, once, at startup. Until it does, `trace.getTracer(...)` returns a no-op tracer and nothing is exported.

## Install and register

```bash
npm install orvaxis @opentelemetry/api
# plus the SDK and exporter you choose, for example @opentelemetry/sdk-node and an OTLP exporter
```

```ts
import { trace } from "@opentelemetry/api"
import { Orvaxis } from "orvaxis"
import { otelPlugin } from "orvaxis/otel"

// Initialize your OpenTelemetry SDK and exporter before this line (outside Orvaxis).
const app = new Orvaxis()
app.register(otelPlugin({ tracer: trace.getTracer("my-service") }))
```

## What a request produces

<!-- snippet: examples/otel-local.ts#app -->
```ts
const app = new Orvaxis()
app.register(otelPlugin({ tracer })) // tracer comes from trace.getTracer("my-service") in real use
app.group({
  prefix: "/api",
  middleware: [traceMiddleware()],
  policies: [
    {
      name: "tenant",
      evaluate: (ctx) =>
        ctx.req.headers["x-tenant"] ? { allow: true } : { allow: false, reason: "no tenant" },
    },
  ],
  routes: [
    {
      method: "GET",
      path: "/users/:id",
      handler: (ctx) => {
        traceEvent("db:query", { table: "users" })
        ctx.res.json({ id: ctx.params.id })
      },
    },
  ],
})
```

The plugin was run against a recording tracer, with no SDK or exporter, so the structure can be read locally (`pnpm exec tsx examples/otel-local.ts`). A completed request produces a root span and two child spans:

<!-- spans: success -->
```text
GET /api/users/:id  status: OK  events: POLICY_DECISION, MIDDLEWARE:start, MIDDLEWARE:end, db:query
  orvaxis.pipeline
  orvaxis.handler
```

| Span | Window | Covers |
|---|---|---|
| root, `GET /api/users/:id` | `onRequest` → `afterPipeline` or `onError` | the whole request; kind `SERVER` |
| `orvaxis.pipeline` | `beforePipeline` → `beforeHandler` | middleware, validation and post-validation policies |
| `orvaxis.handler` | `beforeHandler` → `afterHandler` | the route handler |

The root span carries these attributes (the values are from the request above):

<!-- attributes: success -->
```json
{
  "http.request.method": "GET",
  "url.path": "/api/users/42",
  "orvaxis.request_id": "req-1",
  "http.response.status_code": 200,
  "orvaxis.runtime.outcome": "success",
  "orvaxis.response.sent": true,
  "orvaxis.response.completed_at_runtime_end": true
}
```

- Root span events are the trace events: policy decisions, `traceMiddleware` events, and your `traceEvent` calls, with the event `meta` as attributes. Anything you put in event `meta` is exported.
- The span is named `METHOD /raw/path` at first and renamed to the route template just before the handler runs, so parameterized routes group in your backend. Requests that never reach a handler keep the raw path as their name (and in `url.path`), which can make span names high-cardinality for 404s and early denials; configure sampling or span-name processing in your SDK if that matters.
- `orvaxis.request_id` is the request ID, which an adapter may take from a client-supplied header.

## Failed and rejected requests

<!-- spans: denied -->
```text
GET /api/users/42  status: ERROR  events: POLICY_DECISION, RUNTIME_ERROR  exception: PolicyDeniedError: Policy denied: tenant
```

A failed request marks the root span `ERROR`, records the exception, closes any open child span and sets the status code. A **policy denial** is recorded as `PolicyDeniedError: Policy denied: <policy name>` so the denial reason is not exported; other errors are recorded as they are, including their message, which can contain private data. Requests that fail before routing produce only the root span:

<!-- spans: not-found -->
```text
GET /api/nope  status: ERROR  events: RUNTIME_ERROR  exception: HttpError: Not Found: /api/nope
```

`orvaxis.runtime.outcome`, `orvaxis.response.sent` and `orvaxis.response.completed_at_runtime_end` copy the trace snapshot, so for streams the span records that the runtime finished, not that the client received everything ([the runtime is not the response](/guide/observability#the-runtime-is-not-the-response)).

## Context propagation

An incoming `traceparent` / `tracestate` header is extracted, so the root span joins the caller's trace. The root span is the active parent for spans you start during the request: a span created in a handler with the same tracer nests under it (see [`examples/otel-plugin.ts`](https://github.com/maku85/orvaxis/blob/main/examples/otel-plugin.ts), which adds a `redis:get` child).

## Local run versus export

| | What you need | What you get |
|---|---|---|
| Local, as above | `@opentelemetry/api` only (a recording tracer in the example) | the span structure, readable in a terminal or a test |
| Export | an SDK, an exporter and a collector or backend that you run | spans in Jaeger, Zipkin, Tempo or any OTLP backend |

`examples/otel-plugin.ts` is the export example: it starts a server and assumes your SDK and collector are configured; it does not set them up.
