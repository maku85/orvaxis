# Timeouts and graceful shutdown

Three things end a request earlier than its handler intended: a **deadline** passes, the **client disconnects**, or the **server shuts down**. Orvaxis tells the handler about all three through one `AbortSignal`, `ctx.req.signal`, and the adapters add a deadline and a forced close on top. This page separates what is a notification the handler can ignore from what the adapter enforces. Every result below was observed over real sockets on both adapters with `pnpm exec tsx examples/http-lifecycle.ts`.

## Defaults

| Option | Default | Meaning |
|---|---|---|
| `timeout` | 30 000 ms | deadline for a handler to return or start writing; `0` disables it |
| `shutdownTimeout` | 10 000 ms | how long `close()` waits for connections to drain before cutting them; `0` waits indefinitely |

```ts
const server = createExpressServer(app, undefined, { timeout: 10_000, shutdownTimeout: 5_000 })
// the same options exist on createFastifyServer
```

## One signal, three reasons

`ctx.req.signal` is always set on the built-in adapters. It is aborted when:

| Reason | What the adapter does besides |
|---|---|
| the deadline passes | sends `408` with the error envelope |
| the client disconnects | nothing to send; the runtime also stops before its next stage (middleware, handler) |
| `close()` is called (shutdown) | nothing; requests already running are allowed to finish |

Pass the signal to anything that accepts one (`fetch`, `node:http`, database drivers), or listen for it:

```ts
handler: async (ctx) => {
  const response = await fetch("https://api.example.com/data", { signal: ctx.req.signal })
  ctx.res.json(await response.json())
}
```

**The signal is a notification, not a kill switch.** Nothing interrupts your code: a handler that does not look at the signal keeps running. In the observed run below, a handler that ignored the signal was answered with `408` after 100 ms, its signal was aborted, and it nevertheless ran to its end 300 ms later. Libraries that ignore `AbortSignal` are not cancelled. The only thing the adapter does by force is close connections at the shutdown deadline.

## What was observed

The same application on both adapters (timeout 100 ms, shutdown deadline 200–300 ms). The results were identical:

<!-- lifecycle -->
```json
{
  "sse-longer-than-timeout": {
    "status": 200,
    "body": "data: one\n\ndata: two\n\n"
  },
  "silent-handler": {
    "status": 408,
    "body": "{\"error\":\"Request Timeout\",\"requestId\":\"<id>\"}"
  },
  "silent-handler-after-408": {
    "signalAborted": true,
    "handlerFinished": true
  },
  "pipe-longer-than-timeout": {
    "status": 200,
    "body": "late-chunk"
  },
  "disconnect": {
    "handlerSawSignal": [
      "cooperative: stopped by signal"
    ]
  },
  "shutdown-cooperative": {
    "status": 200,
    "body": ": ping\n\nevent: bye\n\n",
    "closedWithinDeadline": true
  },
  "shutdown-stubborn": {
    "terminated": true,
    "closeWaitedForDeadline": true
  }
}
```

Read them like this:

- **`sse-longer-than-timeout`**: a handler that writes before the deadline is not cut off. The first `write` stops the request timer, so a stream that keeps going for minutes does not need `timeout: 0`. A handler that may sit idle before its first write does.
- **`silent-handler`**: no write and no return within the deadline gives `408` with `{ error: "Request Timeout", requestId }`. The handler is not stopped (`silent-handler-after-408`).
- **`pipe-longer-than-timeout`**: `ctx.res.pipe(stream)` returns at once, so the timer ends when the handler returns; the stream may take longer.
- **`disconnect`**: when the client goes away, a handler waiting on the signal stops.
- **`shutdown-cooperative`**: a stream that listens for the signal ends itself, the client receives its farewell, and `close()` returns promptly.
- **`shutdown-stubborn`**: a stream that ignores the signal is cut off at `shutdownTimeout`: `close()` waits for the deadline, then the connection is destroyed and the client sees a terminated response.

## Shutdown step by step

`close()`:

1. stops accepting new connections and closes idle keep-alive ones;
2. aborts `ctx.req.signal` of every request in flight;
3. waits for those requests to finish; connections that finish while closing are closed rather than left idle;
4. at `shutdownTimeout`, closes whatever is left, including streamed responses.

Then it resolves. A long-lived handler listens for the signal and ends itself:

```ts
handler: async (ctx) => {
  ctx.res.write(": ping\n\n")
  await new Promise<void>((resolve) => {
    ctx.req.signal?.addEventListener("abort", () => resolve(), { once: true })
  })
  // fires on a timeout, a disconnect and a shutdown: same signal, same handling
  ctx.res.write("event: bye\ndata: server shutting down\n\n")
  ctx.res.end()
}
```

## Handling SIGTERM and SIGINT

Orvaxis does not install signal handlers: the process decides. This is the whole pattern, from `examples/graceful-shutdown.ts`:

<!-- snippet: examples/graceful-shutdown.ts#shutdown -->
```ts
const server = createExpressServer(app, undefined, { timeout: 0, shutdownTimeout: 10_000 })

let closing = false
const shutdown = (signal: string) => {
  if (closing) return // a second signal must not start a second close
  closing = true
  console.log(`${signal} received, closing`)
  server.close().then(
    () => {
      console.log("closed")
      process.exit(0)
    },
    (error) => {
      console.error("close failed", error)
      process.exit(1)
    }
  )
}
process.once("SIGTERM", () => shutdown("SIGTERM"))
process.once("SIGINT", () => shutdown("SIGINT"))

server.listen(Number(process.env.PORT ?? 3006), (port) =>
  console.log(`listening on ${port} (pid ${process.pid})`)
)
```

Run it with `pnpm exec tsx examples/graceful-shutdown.ts`, open `curl -N http://localhost:3006/api/events`, then press Ctrl+C or run `kill -TERM <pid>` with the pid it prints. The stream receives `event: bye`, the process logs `closed` and exits with status 0. The tests run exactly this sequence. A second signal while closing is ignored, so it cannot start a second `close()`. Under an orchestrator, set the termination grace period longer than `shutdownTimeout`.

## Limits

- Cancellation depends on your code or your libraries honoring the signal. Nothing is cancelled by force except connections at the shutdown deadline.
- Forced closing destroys sockets: clients with a response in progress get a terminated connection, not a clean end.
- `shutdownTimeout: 0` removes the forced close; a stream that never ends then holds `close()` open forever.
- The signal does not exist on custom adapters unless they create it; see [Writing a custom adapter](./http-adapters.md#writing-a-custom-adapter). `withTimeout` and `AdapterOptions` are exported from the main entry point for that purpose.
