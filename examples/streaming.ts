import { createReadStream } from "node:fs"
import { Orvaxis, createExpressServer } from "../index"

const app = new Orvaxis()

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
      path: "/file/*filepath",
      handler: async (ctx) => {
        const filepath = ctx.meta.route?.params.filepath
        ctx.res.setHeader("Content-Type", "application/octet-stream")
        ctx.res.pipe(createReadStream(filepath))
      },
    },
  ],
})

// Disable the timeout for long-lived streaming connections
const server = createExpressServer(app, undefined, { timeout: 0 })
server.listen(3000, (port) => console.log(`Streaming server on port ${port}`))
