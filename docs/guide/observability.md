# Observability

Every request leaves a record: a trace of what the runtime did, optional debug steps, structured logs, and — for rejected requests — the policy decisions. This page says what each of them contains, what it leaves out, and what stays under your application's control. The scenarios below come from [`examples/observability.ts`](https://github.com/maku85/orvaxis/blob/main/examples/observability.ts), which runs without a server; reproduce them with `pnpm exec tsx examples/observability.ts`.

## One application, four requests

<!-- snippet: examples/observability.ts#app -->
```ts
const app = new Orvaxis()
app.debugger.enable() // optional: also record the internal lifecycle steps

// Any object with info() and error() works: pino, winston, console, or this array.
app.register(
  loggerPlugin({
    logger: {
      info: (record: Record<string, unknown>) => logs.push(["info", record]),
      error: (record: Record<string, unknown>) => logs.push(["error", record]),
    },
  })
)

app.policy({
  name: "authenticate",
  evaluate: (ctx) =>
    ctx.req.headers["x-user"]
      ? { allow: true }
      : { allow: false, status: 401, reason: "No user" },
})

app.group({
  prefix: "/api",
  middleware: [traceMiddleware()], // MIDDLEWARE:start / MIDDLEWARE:end around the layer
  routes: [
    {
      method: "GET",
      path: "/orders/:id",
      handler: async (ctx) => {
        // Custom events can come from anywhere in the call chain, including after an await.
        await loadOrder(ctx.params.id)
        ctx.res.json({ id: ctx.params.id })
      },
    },
    {
      method: "GET",
      path: "/explode",
      handler: () => {
        throw new Error("database password is hunter2")
      },
    },
    {
      // Starts a stream and returns: the runtime is done, the response is not.
      method: "GET",
      path: "/stream",
      handler: (ctx) => {
        ctx.res.write("data: first\n\n")
      },
    },
  ],
})
```

## The trace

Each request has a trace at `ctx.meta.trace`:

| Field | Meaning |
|---|---|
| `requestId` | `req.id` when the adapter or caller set one, otherwise a generated UUID |
| `events` | timestamped `TraceEvent`s: policy decisions, `traceMiddleware` events, your own events, and `RUNTIME_ERROR` when a request fails |
| `startTime`, `endTime` | wall-clock milliseconds; `endTime` marks the end of request processing, before `afterPipeline` |
| `handlerExecuted` | whether the route handler was invoked |
| `outcome` | `"success"` or `"error"` |
| `responseSentAtRuntimeEnd`, `responseCompletedAtRuntimeEnd` | a snapshot, taken when the runtime finished, of whether a response was started and whether the adapter reported it finished |

The same application produces these records for four requests. `events` lists the trace event types in order; `logs` lists what `loggerPlugin` wrote:

A request that completes. The custom `db:query` event was emitted from an async function with no `ctx` in sight:

<!-- observability: success -->
```json
{
  "status": 200,
  "runtime": "success",
  "events": [
    "POLICY_DECISION",
    "MIDDLEWARE:start",
    "MIDDLEWARE:end",
    "db:query"
  ],
  "responseSent": true,
  "responseCompleted": true,
  "terminalDecision": {
    "state": "none"
  },
  "logs": [
    "info request",
    "info response"
  ]
}
```

The handler throws. The runtime outcome is `error`, nothing had been sent, and `loggerPlugin` wrote an error record instead of a response record:

<!-- observability: handler-error -->
```json
{
  "status": 500,
  "runtime": "error",
  "events": [
    "POLICY_DECISION",
    "MIDDLEWARE:start",
    "MIDDLEWARE:end",
    "RUNTIME_ERROR"
  ],
  "responseSent": false,
  "responseCompleted": false,
  "terminalDecision": {
    "state": "none"
  },
  "logs": [
    "info request",
    "error error"
  ]
}
```

The `authenticate` policy denies it. The terminal decision is recorded and the handler never ran. A denial is an error to the runtime, so the logger writes a request record and an error record, and no response record:

<!-- observability: denied -->
```json
{
  "status": 401,
  "runtime": "error",
  "events": [
    "POLICY_DECISION",
    "RUNTIME_ERROR"
  ],
  "responseSent": false,
  "responseCompleted": false,
  "terminalDecision": {
    "state": "recorded",
    "kind": "deny",
    "policy": "authenticate",
    "policyId": "global:0",
    "layer": "global",
    "phase": "preValidation"
  },
  "logs": [
    "info request",
    "error error"
  ]
}
```

The handler starts a stream and returns:

<!-- observability: stream -->
```json
{
  "status": 200,
  "runtime": "success",
  "events": [
    "POLICY_DECISION",
    "MIDDLEWARE:start",
    "MIDDLEWARE:end"
  ],
  "responseSent": true,
  "responseCompleted": false,
  "terminalDecision": {
    "state": "none"
  },
  "logs": [
    "info request",
    "info response"
  ]
}
```

## The runtime is not the response

The trace describes the runtime's work. A handler can return after starting a server-sent-events or file stream, so `outcome: "success"` and `responseSentAtRuntimeEnd: true` can sit beside `responseCompletedAtRuntimeEnd: false`, as in the last record. These fields are a snapshot at the end of request processing; they do not change when the network stream later finishes, and `afterPipeline` and `loggerPlugin`'s `response` record also run at that moment, not when the client has received everything. Custom adapters may leave `responseCompletedAtRuntimeEnd` undefined.

## Custom events

`traceEvent(type, meta?)` adds an event to the current request's trace from anywhere in the call chain, including after an `await`; it does nothing outside a request.

<!-- snippet: examples/observability.ts#custom-event -->
```ts
async function loadOrder(id: string) {
  await Promise.resolve() // stands in for I/O
  traceEvent("db:query", { table: "orders", id }) // no ctx needed; a no-op outside a request
}
```

`traceMiddleware()` records `MIDDLEWARE:start` and `MIDDLEWARE:end` (with the elapsed milliseconds) around the middleware layer it is attached to. Event `meta` is yours: put identifiers and values you are comfortable exporting, because the trace is forwarded to [OpenTelemetry](/guide/opentelemetry) span events as is.

## The debug layer

`app.debugger.enable()` records a timeline of lifecycle steps (`REQUEST_START`, `POLICY_START`, `PIPELINE_DONE`, `HANDLER_EXECUTED`, `ERROR`, ...) in `ctx.meta.debug`; `disable()` stops it. `app.debugger.enabled` is read-only and assigning to it throws. `buildExecutionSummary(ctx)` merges trace and debug data (`traceEvents`, `policyDecisions`, `stoppedByPolicy`, `notReachedStages`, `debugSteps`, `combinedTimeline`, `policyTrace`); it works without the debugger, with fewer steps. In the records above the `debugSteps` of the failed request end in `ERROR` instead of `HANDLER_EXECUTED`.

## Policy decisions: what is recorded, and what is not

Policy decisions are recorded automatically as `POLICY_DECISION` trace events:

| `policyTrace.mode` | Recorded per decision |
|---|---|
| `"summary"` (default) | policy name, declaration ID, layer, phase, order, priority, duration, outcome |
| `"detailed"` | the same plus the scope and the denial reason, **after your redactor** (`redact` is required) |
| `"off"` | nothing; reports then say the terminal decision is unknown rather than guessing |

At most `maxEvents` (default 100, up to 1,000) non-terminal decisions are kept; the decision that stopped the request is always kept, and `buildExecutionSummary().policyTrace` says how many were dropped. So the trace is a bounded record, not a complete log of everything. Decisions never include request bodies, headers, cookies, identity values or exception messages. See [Diagnose a 403](/guide/diagnose-403) for reading them, and the [request report](/reference/core-concepts#request-report) for a JSON form that is safe to attach to an issue.

## Logging and request IDs

`loggerPlugin({ logger?, format? })` writes three kinds of record, as objects (`format: "json"`, the default) or text:

| Record | Written | Fields |
|---|---|---|
| `request` | `onRequest` | `method`, `path`, `requestId` |
| `response` | `afterPipeline` | `method`, `path`, `status`, `durationMs`, `requestId` |
| `error` | `onError` | `requestId`, `message`, `error`, `durationMs`, `runtimeOutcome`, `responseSent`, `responseCompleted` |

The `logger` is any object with `info` and `error` (`console`, pino, winston). **What is logged is not redacted.** `path` is the real URL path, so identifiers in it are logged; the `error` record carries the error's message and the error object, which can contain private data (the handler error above says so). Orvaxis redacts policy-decision data, summaries and reports; it does not rewrite what your logger receives. Choose a logger, a log level and a retention policy accordingly, or log from `onError` yourself with the fields you want.

The request ID comes from the adapter: the `X-Request-ID` request header when present, otherwise a generated UUID, and it is echoed in the response header (configurable with `requestIdHeader`; see [HTTP adapters](/guide/http-adapters)). Treat an incoming value as untrusted client input. In tests, pass `id` to `testRequest`. The same logger can be given to `new Orvaxis({ logger })` to receive hook meta-errors and to the adapter options to receive errors after a response was sent.

## What is collected and who controls it

| Data | Collected by | Contains | You control |
|---|---|---|---|
| Trace (`ctx.meta.trace`) | the runtime, always | event types, timings, request ID, outcome | event `meta` you emit |
| Policy decisions | the runtime, by mode | names, IDs, layers, outcomes | `policyTrace` mode, `maxEvents`, `redact` |
| Debug timeline | the runtime, when enabled | lifecycle step names | `enable()` / `disable()` |
| Logs | `loggerPlugin` | method, raw path, status, error message | the logger and what it keeps |
| Spans | `otelPlugin` | see [OpenTelemetry](/guide/opentelemetry) | the SDK, exporter and sampling |
| `ctx.logs` | nothing — it is yours | what you push | see [request context](/guide/request-context) |
