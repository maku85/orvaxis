import { createReadStream } from "node:fs"
import { basename, resolve } from "node:path"
import { createExpressServer } from "../express"
import { Orvaxis } from "../index"

// #region routes
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
// #endregion

if (basename(process.argv[1] ?? "") === "streaming.ts") {
  // The request timeout stops counting at the first write, so it can stay at its default for
  // streams that start promptly; use `timeout: 0` if a handler may idle before its first write.
  createExpressServer(app).listen(3000, (port) => console.log(`Streaming server on port ${port}`))
}
