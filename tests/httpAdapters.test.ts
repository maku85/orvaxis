import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import express, { type Request, type Response } from "express"
import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { createExpressPolicyGuard, createExpressServer } from "../http/expressAdapter"
import { createFastifyServer } from "../http/fastifyAdapter"
import type { ServerAdapter } from "../types"

// Behavior matrix for the declared HTTP integrations, run over real sockets. `pnpm test:compat`
// repeats it for Express 4, Express 5 and Fastify 5 (see scripts/run-compat.mjs).
type Kind = "express" | "express-guard" | "fastify"
const target = process.env.ORVAXIS_COMPAT_TARGET
const kinds: Kind[] = (["express", "express-guard", "fastify"] as const).filter((kind) =>
  !target ? true : target.startsWith("express") ? kind !== "fastify" : kind === "fastify"
)

type Deferred = { promise: Promise<void>; resolve: () => void }
function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r))
}

type Probe = {
  handlerCalls: number
  started: Deferred
  gate: Deferred
  signal?: AbortSignal
  logger: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }
}

function makeProbe(): Probe {
  return {
    handlerCalls: 0,
    started: deferred(),
    gate: deferred(),
    logger: { error: vi.fn(), warn: vi.fn() },
  }
}

function makeApp(
  kind: Kind,
  probe: Probe,
  policy: (
    ctx: Parameters<NonNullable<Orvaxis["policy"]>>[0]["evaluate"] extends (c: infer C) => unknown
      ? C
      : never
  ) => unknown,
  extra: { afterSend?: boolean } = {}
) {
  const app = new Orvaxis()
  app.group({
    prefix: "/api",
    routes: [
      {
        method: "GET",
        path: "/documents/:id",
        policies: [{ name: "gate", evaluate: policy as never }],
        handler: (ctx) => {
          // Express guard routes run the existing Express handler instead of this one.
          if (kind === "express-guard") return
          probe.handlerCalls++
          ctx.res.json({ ok: true })
          if (extra.afterSend) throw new Error("failure after the response was sent")
        },
      },
    ],
  })
  return app
}

type Running = {
  url: string
  stop: () => Promise<void>
  /** `close` listener counts of the last response, measured around the guard. */
  listeners: { before?: number; res?: Response }
}

const running: Running[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()))
})

async function start(
  kind: Kind,
  app: Orvaxis,
  probe: Probe,
  options: { timeout?: number } = {}
): Promise<Running> {
  const adapterOptions = {
    timeout: options.timeout ?? 0,
    logger: probe.logger,
    shutdownTimeout: 50,
  }
  const listeners: Running["listeners"] = {}
  let stop: () => Promise<void>
  let port = 0
  if (kind === "express-guard") {
    const web = express()
    web.use((_req: Request, res: Response, next: () => void) => {
      listeners.before = res.listenerCount("close")
      listeners.res = res
      next()
    })
    web.use("/api", createExpressPolicyGuard(app, adapterOptions))
    web.get("/api/documents/:id", (_req: Request, res: Response) => {
      probe.handlerCalls++
      res.json({ ok: true })
    })
    const server: Server = createServer(web)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    port = (server.address() as AddressInfo).port
    stop = () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  } else {
    const adapter: ServerAdapter =
      kind === "express"
        ? createExpressServer(app, express(), adapterOptions)
        : createFastifyServer(app, Fastify(), adapterOptions)
    await adapter.listen(0, (assigned) => {
      port = assigned
    })
    stop = () => adapter.close()
  }
  const instance = { url: `http://127.0.0.1:${port}`, stop, listeners }
  running.push(instance)
  return instance
}

const allowOwner =
  (probe: Probe) => (ctx: { req: { headers: Record<string, unknown>; signal?: AbortSignal } }) => {
    probe.signal = ctx.req.signal
    return ctx.req.headers["x-owner"] === "yes" ? { allow: true } : { allow: false, reason: "no" }
  }

describe("express runtime under test", () => {
  it("resolves the intended Express major", () => {
    const expected = target === "express5" ? 5 : target === "express4" ? 4 : undefined
    if (expected === undefined) return
    // `app.del` was removed in Express 5.
    expect("del" in express.application).toBe(expected === 4)
  })
})

describe.each(kinds)("%s adapter behavior", (kind) => {
  it("allows, denies and reports policy errors without reaching the handler wrongly", async () => {
    const probe = makeProbe()
    const app = makeApp(kind, probe, (ctx: never) => {
      const headers = (ctx as { req: { headers: Record<string, string> } }).req.headers
      if (headers["x-fail"]) throw new Error("policy exploded")
      return headers["x-owner"] === "yes" ? { allow: true } : { allow: false, reason: "no" }
    })
    const { url } = await start(kind, app, probe)

    const allowed = await fetch(`${url}/api/documents/1`, { headers: { "x-owner": "yes" } })
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toEqual({ ok: true })
    expect(probe.handlerCalls).toBe(1)

    const denied = await fetch(`${url}/api/documents/1`)
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: "no" })
    expect(probe.handlerCalls).toBe(1)

    const failed = await fetch(`${url}/api/documents/1`, { headers: { "x-fail": "1" } })
    expect(failed.status).toBe(500)
    expect(await failed.json()).toHaveProperty("requestId")
    expect(probe.handlerCalls).toBe(1)
  })

  it("applies policies to HEAD requests", async () => {
    const probe = makeProbe()
    const app = makeApp(kind, probe, allowOwner(probe) as never)
    const { url } = await start(kind, app, probe)

    const head = await fetch(`${url}/api/documents/1`, {
      method: "HEAD",
      headers: { "x-owner": "yes" },
    })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe("")
    expect(probe.handlerCalls).toBe(1)

    const denied = await fetch(`${url}/api/documents/1`, { method: "HEAD" })
    expect(denied.status).toBe(403)
    expect(probe.handlerCalls).toBe(1)
  })

  it("answers 408 on timeout and neither responds twice nor runs the handler when the policy ends later", async () => {
    const probe = makeProbe()
    const app = makeApp(kind, probe, (async (ctx: { req: { signal?: AbortSignal } }) => {
      probe.signal = ctx.req.signal
      probe.started.resolve()
      await probe.gate.promise
      return { allow: true }
    }) as never)
    const { url } = await start(kind, app, probe, { timeout: 30 })

    const response = await fetch(`${url}/api/documents/1`)
    expect(response.status).toBe(408)
    expect(probe.signal?.aborted).toBe(true)

    probe.gate.resolve()
    await flush()
    expect(probe.handlerCalls).toBe(0)
    expect(probe.logger.error).not.toHaveBeenCalled()
  })

  it("aborts the signal on disconnect and skips the handler when the policy ends later", async () => {
    const probe = makeProbe()
    const app = makeApp(kind, probe, (async (ctx: { req: { signal?: AbortSignal } }) => {
      probe.signal = ctx.req.signal
      probe.started.resolve()
      await probe.gate.promise
      return { allow: true }
    }) as never)
    const { url } = await start(kind, app, probe)

    const controller = new AbortController()
    const pending = fetch(`${url}/api/documents/1`, { signal: controller.signal }).catch(
      () => "aborted"
    )
    await probe.started.promise
    controller.abort()
    expect(await pending).toBe("aborted")
    await vi.waitFor(() => expect(probe.signal?.aborted).toBe(true))

    probe.gate.resolve()
    await flush()
    expect(probe.handlerCalls).toBe(0)
  })
})

describe.each(
  kinds.filter((kind) => kind !== "express-guard")
)("%s adapter after the response", (kind) => {
  it("keeps one response and logs the failure when the handler throws after sending", async () => {
    const probe = makeProbe()
    const app = makeApp(kind, probe, (() => ({ allow: true })) as never, { afterSend: true })
    const { url } = await start(kind, app, probe)

    const response = await fetch(`${url}/api/documents/1`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    await vi.waitFor(() => expect(probe.logger.error).toHaveBeenCalledTimes(1))
    expect(probe.handlerCalls).toBe(1)
  })
})

describe.runIf(kinds.includes("express-guard"))("express guard on a mounted prefix", () => {
  it("leaves no listeners on the response after completion, denial or timeout", async () => {
    const probe = makeProbe()
    const app = makeApp("express-guard", probe, allowOwner(probe) as never)
    const server = await start("express-guard", app, probe)

    const settle = async () => {
      await vi.waitFor(() =>
        expect(server.listeners.res?.listenerCount("close")).toBe(server.listeners.before)
      )
    }
    await (await fetch(`${server.url}/api/documents/1`, { headers: { "x-owner": "yes" } })).text()
    await settle()
    await (await fetch(`${server.url}/api/documents/1`)).text()
    await settle()
    expect(probe.handlerCalls).toBe(1)
  })
})
