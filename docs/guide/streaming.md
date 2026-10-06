# Streaming

`ctx.res` can stream a response instead of sending one value: server-sent events, newline-delimited JSON, or a file. This page shows the three methods, the three common shapes (all in [`examples/streaming.ts`](https://github.com/maku85/orvaxis/blob/main/examples/streaming.ts)), and how streaming interacts with timeouts, disconnects, shutdown and response contracts.

## The three methods

| Method | Behaviour |
|---|---|
| `ctx.res.write(chunk)` | sends a chunk and keeps the connection open |
| `ctx.res.end(chunk?)` | sends an optional final chunk and closes the response |
| `ctx.res.pipe(stream)` | pipes a `node:stream.Readable` to the response and ends it when the stream ends |

Set headers (`Content-Type`, `Cache-Control`) and the status before the first `write` or `pipe`: they cannot change afterwards. Call `end()` yourself after `write`; `pipe` ends the response for you.

## Server-sent events, NDJSON and a file

<!-- snippet: examples/streaming.ts#routes -->
```ts
export const app = new Orvaxis()

app.group({
  prefix: "/api",
  routes: [
    // SSE: write multiple chunks then close
    {
      method: "GET",
      path: "/events",
      handler: async (ctx) => {
        ctx.res.setHeader("Content-Type", "text/event-stream")
        ctx.res.setHeader("Cache-Control", "no-cache")
        ctx.res.setHeader("Connection", "keep-alive")

        ctx.res.write("data: connected\n\n")

        for (let i = 1; i <= 5; i++) {
          ctx.res.write(`data: ${JSON.stringify({ id: i, time: Date.now() })}\n\n`)
        }

        ctx.res.end()
      },
    },

    // NDJSON: newline-delimited JSON chunks
    {
      method: "GET",
      path: "/records",
      handler: async (ctx) => {
        ctx.res.setHeader("Content-Type", "application/x-ndjson")

        const records = [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
          { id: 3, name: "Carol" },
        ]

        for (const record of records) {
          ctx.res.write(`${JSON.stringify(record)}\n`)
        }

        ctx.res.end()
      },
    },

    // File streaming via pipe
    {
      method: "GET",
      path: "/file",
      handler: async (ctx) => {
        ctx.res.setHeader("Content-Type", "application/octet-stream")
        ctx.res.pipe(createReadStream(resolve(process.cwd(), "examples/fixtures/sample.txt")))
      },
    },
  ],
})
```

Run it with `pnpm exec tsx examples/streaming.ts` (port 3000) and try:

```bash
curl -N http://localhost:3000/api/events    # server-sent events
curl -N http://localhost:3000/api/records   # one JSON object per line
curl -i http://localhost:3000/api/file      # a fixed fixture file
```

The same handlers work on the Fastify adapter; only the server creation differs ([HTTP adapters](./http-adapters.md)).

## Timeouts, disconnects and shutdown

- **The request timer stops at the first `write`.** A stream that starts writing within the deadline is not cut off at 30 s, so you do not need `timeout: 0` for it. If a handler can idle before its first write, or you prefer no deadline at all, set `timeout: 0`.
- **`pipe` is not limited by the timer** either: it returns at once, and the stream may run for as long as its source does.
- **A disconnect aborts `ctx.req.signal`.** A long-running producer should watch it and stop; writing to a closed connection does nothing useful.
- **Shutdown also aborts the signal.** A stream that listens ends itself and `close()` returns promptly; one that does not is cut off at `shutdownTimeout`. See [Timeouts and graceful shutdown](./timeouts-and-shutdown.md) for the observed results on both adapters.

## Streaming and response contracts

Streams are never buffered, so a declared response schema cannot validate them. With [`responseValidationPlugin`](./response-contracts.md), a route that streams a status for which it declares a schema fails with a `500` in `strict` mode and reports `stream-not-validated` in `warn` mode. Leave streaming routes without a response schema and document their media type separately in [OpenAPI](./openapi.md).

## Testing streams

`testRequest` captures chunks without a server: `result.chunks` holds everything written and `result.ended` says whether the handler ended the response. A piped stream is not ended by the handler, so `ended` stays `false` for `/api/file`. See [Testing](./testing.md).
