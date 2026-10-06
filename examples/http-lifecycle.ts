import { basename } from "node:path"
import { Readable } from "node:stream"
import express from "express"
import Fastify from "fastify"
import { createExpressServer } from "../express"
import { createFastifyServer } from "../fastify"
import { Orvaxis, type ServerAdapter } from "../index"

// What the adapters do on timeout, disconnect and shutdown, observed over real sockets. The
// application is the same for both adapters; each scenario starts its own short-lived server.

export type AdapterName = "express" | "fastify"
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type Probe = { aborted: string[]; finished: string[] }

function createApp(probe: Probe) {
  const app = new Orvaxis()
  app.group({
    prefix: "/t",
    routes: [
      {
        // Writes at once, then keeps going for longer than the request timeout.
        method: "GET",
        path: "/sse",
        handler: async (ctx) => {
          ctx.res.setHeader("Content-Type", "text/event-stream")
          ctx.res.write("data: one\n\n")
          await sleep(300)
          ctx.res.write("data: two\n\n")
          ctx.res.end()
        },
      },
      {
        // Does not write for longer than the timeout and ignores the signal.
        method: "GET",
        path: "/silent",
        handler: async (ctx) => {
          ctx.req.signal?.addEventListener("abort", () => probe.aborted.push("silent"), {
            once: true,
          })
          await sleep(300)
          probe.finished.push("silent")
          if (!ctx.res.sent) ctx.res.json({ late: true })
        },
      },
      {
        // Same, but gives up when the signal fires.
        method: "GET",
        path: "/cooperative",
        handler: async (ctx) => {
          await new Promise<void>((resolve) => {
            ctx.req.signal?.addEventListener("abort", () => resolve(), { once: true })
            setTimeout(resolve, 2000)
          })
          probe.finished.push(
            ctx.req.signal?.aborted
              ? "cooperative: stopped by signal"
              : "cooperative: ran to the end"
          )
        },
      },
      {
        // Returns at once with a stream that produces its data later.
        method: "GET",
        path: "/pipe",
        handler: async (ctx) => {
          ctx.res.setHeader("Content-Type", "text/plain")
          ctx.res.pipe(
            Readable.from(
              (async function* () {
                await sleep(300)
                yield "late-chunk"
              })()
            )
          )
        },
      },
      {
        // A stream that ends itself when told to shut down.
        method: "GET",
        path: "/graceful",
        handler: async (ctx) => {
          ctx.res.write(": ping\n\n")
          await new Promise<void>((resolve) => {
            ctx.req.signal?.addEventListener("abort", () => resolve(), { once: true })
          })
          ctx.res.write("event: bye\n\n")
          ctx.res.end()
        },
      },
      {
        // A stream that ignores the signal and outlives the shutdown deadline.
        method: "GET",
        path: "/stubborn",
        handler: async (ctx) => {
          ctx.res.write(": ping\n\n")
          await sleep(3000)
          if (!ctx.res.completed) {
            ctx.res.write("too late\n")
            ctx.res.end()
          }
        },
      },
    ],
  })
  return app
}

async function start(adapter: AdapterName, options: { timeout: number; shutdownTimeout: number }) {
  const probe: Probe = { aborted: [], finished: [] }
  const app = createApp(probe)
  const adapterOptions = { ...options, logger: { info() {}, error() {} } }
  const server: ServerAdapter =
    adapter === "express"
      ? createExpressServer(app, express(), adapterOptions)
      : createFastifyServer(app, Fastify(), adapterOptions)
  let port = 0
  await server.listen(0, (assigned) => {
    port = assigned
  })
  return { server, probe, url: (path: string) => `http://127.0.0.1:${port}/t${path}` }
}

type Outcome = { status: number; body: string } | { terminated: true }

async function read(url: string, signal?: AbortSignal): Promise<Outcome> {
  try {
    const response = await fetch(url, { signal })
    return { status: response.status, body: await response.text() }
  } catch {
    return { terminated: true }
  }
}

/** The error envelope without its volatile request ID. */
const plain = (outcome: Outcome) =>
  "terminated" in outcome
    ? outcome
    : {
        status: outcome.status,
        body: outcome.body.replace(/"requestId":"[^"]*"/, '"requestId":"<id>"'),
      }

export async function runLifecycle(adapter: AdapterName) {
  const result: Record<string, unknown> = {}

  // Timeout: 100 ms deadline.
  {
    const { server, probe, url } = await start(adapter, { timeout: 100, shutdownTimeout: 200 })
    result["sse-longer-than-timeout"] = plain(await read(url("/sse")))
    result["silent-handler"] = plain(await read(url("/silent")))
    await sleep(350)
    result["silent-handler-after-408"] = {
      signalAborted: probe.aborted.includes("silent"),
      handlerFinished: probe.finished.includes("silent"),
    }
    result["pipe-longer-than-timeout"] = plain(await read(url("/pipe")))
    await server.close()
  }

  // Disconnect: the client goes away while the handler waits.
  {
    const { server, probe, url } = await start(adapter, { timeout: 0, shutdownTimeout: 200 })
    const controller = new AbortController()
    const pending = read(url("/cooperative"), controller.signal)
    await sleep(100)
    controller.abort()
    await pending
    await sleep(100)
    result.disconnect = { handlerSawSignal: probe.finished }
    await server.close()
  }

  // Shutdown: a cooperative stream, then a stubborn one.
  {
    const { server, url } = await start(adapter, { timeout: 0, shutdownTimeout: 300 })
    const graceful = read(url("/graceful"))
    await sleep(100)
    const started = Date.now()
    await server.close()
    result["shutdown-cooperative"] = {
      ...plain(await graceful),
      closedWithinDeadline: Date.now() - started < 250,
    }
  }
  {
    const { server, url } = await start(adapter, { timeout: 0, shutdownTimeout: 300 })
    const stubborn = read(url("/stubborn"))
    await sleep(100)
    const started = Date.now()
    await server.close()
    const waited = Date.now() - started
    result["shutdown-stubborn"] = {
      ...plain(await stubborn),
      closeWaitedForDeadline: waited >= 250 && waited < 1500,
    }
  }
  return result
}

if (basename(process.argv[1] ?? "") === "http-lifecycle.ts") {
  ;(async () => {
    for (const adapter of ["express", "fastify"] as const) {
      console.log(`=== ${adapter} ===\n${JSON.stringify(await runLifecycle(adapter), null, 2)}\n`)
    }
    process.exit(0)
  })()
}
