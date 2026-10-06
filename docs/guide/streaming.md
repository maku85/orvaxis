# Streaming

Server-sent events, files and other streamed responses.

`ctx.res` exposes three methods for streaming responses:

| Method | Behaviour |
|--------|-----------|
| `ctx.res.write(chunk)` | Sends a chunk to the client without closing the connection |
| `ctx.res.end(chunk?)` | Sends an optional final chunk and closes the connection |
| `ctx.res.pipe(stream)` | Pipes a `node:stream.Readable` directly to the response |

```ts
app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/events",
      handler: async (ctx) => {
        ctx.res.setHeader("Content-Type", "text/event-stream")
        ctx.res.setHeader("Cache-Control", "no-cache")

        ctx.res.write("data: connected\n\n")

        // send a few events then close
        for (let i = 1; i <= 3; i++) {
          ctx.res.write(`data: event ${i}\n\n`)
        }

        ctx.res.end()
      },
    },
    {
      method: "GET",
      path: "/file/:name",
      handler: async (ctx) => {
        const { createReadStream } = await import("node:fs")
        const stream = createReadStream(`/data/${ctx.meta.route!.params.name}`)
        ctx.res.pipe(stream)
      },
    },
  ],
})
```

When using the built-in adapters, disable the default 30 s timeout for long-lived streaming connections:

```ts
const server = createExpressServer(app, undefined, { timeout: 0 })
```

For testing, `testRequest` captures all chunks in `result.chunks` and exposes `result.ended`, so streaming handlers do not require a live server.
