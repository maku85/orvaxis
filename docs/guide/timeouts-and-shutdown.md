# Timeouts and graceful shutdown

Per-request deadlines, cancellation through `ctx.req.signal`, and shutting a server down without cutting off in-flight work.

## Timeout

Both adapters accept an optional `AdapterOptions` third argument:

```ts
import { createExpressServer } from "orvaxis/express"

// default: 30 000 ms
const server = createExpressServer(app)

// custom deadline
const server = createExpressServer(app, undefined, { timeout: 10_000 })

// disabled (long-running handlers, streaming, etc.)
const server = createExpressServer(app, undefined, { timeout: 0 })
```

When the deadline expires the adapter sends a 408 response and sets `ctx.req.signal` to aborted, so any downstream work that accepts an `AbortSignal` is cancelled immediately:

```ts
handler: async (ctx) => {
  // fetch is aborted if the request times out
  const res = await fetch("https://api.example.com/data", { signal: ctx.req.signal })
  ctx.res.json(await res.json())
}
```

The same signal is aborted when the client disconnects before the response finishes. The runtime stops before its next stage (middleware, handler) for such a request instead of running work nobody will receive; the Express policy guard likewise does not call `next()`. Graceful shutdown aborts the signal too but lets requests already in progress run to completion.

`ctx.req.signal` is always defined when using the built-in adapters. Pass it to `node:http` requests, database drivers (pg, mongodb, prisma), or any API that accepts an `AbortSignal` to stop work the client will never see. The same option is available on `createFastifyServer`.

`withTimeout` and `AdapterOptions` are exported from the main entry point so custom adapters can reuse them:

```ts
import { withTimeout, type AdapterOptions } from "orvaxis"
```

## Graceful shutdown

When `close()` is called (e.g. on `SIGTERM`), the adapter stops accepting new connections and waits for active requests to finish. A `shutdownTimeout` cap (default `10 000 ms`) forces `closeAllConnections()` if active connections do not drain in time, so the process always exits cleanly under Kubernetes, systemd, and other orchestrators.

**In-flight requests are notified via the same `ctx.req.signal` used for timeouts.** Before waiting for connections to drain, `close()` aborts the `AbortSignal` of every request still in flight. A long-lived handler — an SSE loop, a chunked NDJSON stream — can listen for this exactly like it already does for timeouts, and end itself cleanly (send a final message, call `ctx.res.end()`) instead of being cut off by `shutdownTimeout`:

```ts
handler: async (ctx) => {
  ctx.res.write(": ping\n\n")
  await new Promise<void>((resolve) => {
    ctx.req.signal?.addEventListener("abort", resolve, { once: true })
  })
  // fires both on a request timeout and on server shutdown — same signal, same handling
  ctx.res.write("event: bye\ndata: server shutting down\n\n")
  ctx.res.end()
}
```

If a handler doesn't listen for the signal, nothing changes: `shutdownTimeout` still forces the connection closed as before. This is a notification, not a kill switch.

```ts
// default: 10 000 ms forced-close deadline
const server = createExpressServer(app)

// custom deadline
const server = createExpressServer(app, undefined, { shutdownTimeout: 5_000 })

// disable forced close (wait indefinitely — not recommended in production)
const server = createExpressServer(app, undefined, { shutdownTimeout: 0 })
```

Typical SIGTERM handler:

```ts
const server = createExpressServer(app, undefined, { shutdownTimeout: 10_000 })
await server.listen(3000)

process.once("SIGTERM", () => server.close())
process.once("SIGINT",  () => server.close())
```
