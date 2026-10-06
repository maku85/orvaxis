import { createExpressServer } from "../express"
import { Orvaxis } from "../index"

// A server that shuts down on SIGTERM/SIGINT: in-flight streams are told to finish, then the
// process exits. `pnpm exec tsx examples/graceful-shutdown.ts`, then press Ctrl+C or `kill -TERM <pid>` with the pid it prints.

const app = new Orvaxis()
app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/events",
      handler: async (ctx) => {
        ctx.res.setHeader("Content-Type", "text/event-stream")
        ctx.res.write("data: connected\n\n")
        // Stay open until the client leaves, the request times out, or the server shuts down.
        await new Promise<void>((resolve) => {
          ctx.req.signal?.addEventListener("abort", () => resolve(), { once: true })
        })
        ctx.res.write("event: bye\ndata: server shutting down\n\n")
        ctx.res.end()
      },
    },
  ],
})

// #region shutdown
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
// #endregion
