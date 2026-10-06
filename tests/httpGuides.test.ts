import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import express from "express"
import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { type AdapterName, runLifecycle } from "../examples/http-lifecycle"
import { app as streamingApp } from "../examples/streaming"
import { createExpressServer } from "../express"
import { createFastifyServer } from "../fastify"
import { Orvaxis, type ServerAdapter } from "../index"
import { testRequest } from "../testing"

const read = (name: string) => readFileSync(`docs/guide/${name}.md`, "utf8")
const open: ServerAdapter[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => server.close()))
})

async function listen(server: ServerAdapter) {
  open.push(server)
  let port = 0
  await server.listen(0, (assigned) => {
    port = assigned
  })
  return `http://127.0.0.1:${port}`
}

function echoApp() {
  const app = new Orvaxis()
  app.group({
    prefix: "/api",
    routes: [
      { method: "GET", path: "/hello", handler: (ctx) => ctx.res.json({ from: "orvaxis" }) },
      {
        method: "POST",
        path: "/echo",
        handler: (ctx) => ctx.res.json({ body: ctx.req.body ?? null }),
      },
      { method: "GET", path: "/query", handler: (ctx) => ctx.res.json({ query: ctx.req.query }) },
    ],
  })
  return app
}

describe("observed lifecycle results printed in the guide", () => {
  it.each([
    "express",
    "fastify",
  ] as AdapterName[])("%s matches the guide's tables", async (adapter) => {
    const result = (await runLifecycle(adapter)) as Record<string, Record<string, unknown>>
    const printed = JSON.parse(
      /<!-- lifecycle -->\n```json\n([\s\S]*?)\n```/.exec(read("timeouts-and-shutdown"))?.[1] ??
        "null"
    )
    expect(printed).not.toBeNull()
    expect(result).toEqual(printed)
  }, 30_000)

  it("behaves the same on both adapters", async () => {
    expect(await runLifecycle("express")).toEqual(await runLifecycle("fastify"))
  }, 30_000)
})

describe("mounting and parsing rules in the adapters guide", () => {
  it("Express: routes registered before createExpressServer win, later ones are shadowed", async () => {
    const web = express()
    web.get("/api/hello", (_req, res) => res.json({ from: "express-before" }))
    createExpressServer(echoApp(), web)
    web.get("/api/late", (_req, res) => res.json({ from: "express-after" }))
    const url = await listenExpress(web)
    expect(await (await fetch(`${url}/api/hello`)).json()).toEqual({ from: "express-before" })
    const late = await fetch(`${url}/api/late`)
    expect(late.status).toBe(404) // Orvaxis answered: it has no such route, Express never saw it
    expect(await late.json()).toMatchObject({ error: expect.stringContaining("Not Found") })
  })

  it("Express: the body is only parsed when express.json() is registered first", async () => {
    const withParser = express()
    withParser.use(express.json())
    const parsed = await listen(createExpressServer(echoApp(), withParser))
    expect(
      await (
        await fetch(`${parsed}/api/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"a":1}',
        })
      ).json()
    ).toEqual({ body: { a: 1 } })
    const without = await listen(createExpressServer(echoApp(), express()))
    expect(
      await (
        await fetch(`${without}/api/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"a":1}',
        })
      ).json()
    ).toEqual({ body: null })
  })

  it("Fastify: routes of its own win over the catch-all and JSON is parsed by default", async () => {
    const fastify = Fastify()
    fastify.get("/health", async () => ({ from: "fastify" }))
    const url = await listen(createFastifyServer(echoApp(), fastify))
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ from: "fastify" })
    expect(
      await (
        await fetch(`${url}/api/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"a":1}',
        })
      ).json()
    ).toEqual({ body: { a: 1 } })
  })

  it("answers a body over the framework limit through the error envelope", async () => {
    const small = express()
    small.use(express.json({ limit: "10b" }))
    const url = await listen(createExpressServer(echoApp(), small))
    const response = await fetch(`${url}/api/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ big: "x".repeat(100) }),
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ requestId: expect.any(String) })
  })

  it("parses bracketed query keys differently per adapter", async () => {
    const e = await listen(createExpressServer(echoApp(), express()))
    const f = await listen(createFastifyServer(echoApp(), Fastify()))
    expect(await (await fetch(`${e}/api/query?filter[status]=active`)).json()).toEqual({
      query: { filter: { status: "active" } },
    })
    expect(await (await fetch(`${f}/api/query?filter[status]=active`)).json()).toEqual({
      query: { "filter[status]": "active" },
    })
  })

  it("echoes and generates request IDs, honoring requestIdHeader", async () => {
    const url = await listen(
      createExpressServer(echoApp(), express(), { requestIdHeader: "X-Correlation-ID" })
    )
    const echoed = await fetch(`${url}/api/hello`, { headers: { "x-correlation-id": "abc-1" } })
    expect(echoed.headers.get("x-correlation-id")).toBe("abc-1")
    const generated = await fetch(`${url}/api/hello`)
    expect(generated.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/)
    expect(generated.headers.get("x-request-id")).toBeNull()
  })

  it("keeps the documented adapter defaults and lifecycle of listen and close", async () => {
    for (const make of [
      () => createExpressServer(echoApp()),
      () => createFastifyServer(echoApp()),
    ]) {
      const server = make()
      await server.close() // not listening: resolves
      await server.listen(0)
      await expect(server.listen(0)).rejects.toThrow(
        "Server is already listening. Call close() first."
      )
      await server.close()
      await server.close() // idempotent
    }
    // An Express adapter can listen again after close(); a Fastify instance cannot be reopened.
    const again = createExpressServer(echoApp())
    await again.listen(0)
    await again.close()
    await again.listen(0)
    await again.close()
    const reused = createFastifyServer(echoApp())
    await reused.listen(0)
    await reused.close()
    await expect(reused.listen(0)).rejects.toThrow("cannot be reopened")
    const guide = read("http-adapters")
    for (const text of ["`timeout`", "30 000", "`shutdownTimeout`", "10 000", "`requestIdHeader`"])
      expect(guide).toContain(text)
  })
})

async function listenExpress(web: ReturnType<typeof express>) {
  const server = web.listen(0)
  open.push({
    listen: async () => {},
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  })
  await new Promise((resolve) => server.once("listening", resolve))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

describe("streaming guide", () => {
  it("streams SSE, NDJSON and a file through testRequest without a server", async () => {
    const sse = await testRequest(streamingApp, { path: "/api/events" })
    expect(sse.chunks[0]).toBe("data: connected\n\n")
    expect(sse.ended).toBe(true)
    const ndjson = await testRequest(streamingApp, { path: "/api/records" })
    expect(ndjson.chunks.map((chunk) => JSON.parse(String(chunk)))).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Carol" },
    ])
    const file = await testRequest(streamingApp, { path: "/api/file" })
    expect(file.ended).toBe(false) // a piped stream is not ended by the handler
  })
})

describe("signal handling example from the timeouts guide", () => {
  it("closes in-flight streams and exits with status 0 on SIGTERM", async () => {
    // Run tsx's CLI directly: it starts the script in a child, whose pid the script prints.
    const child = spawn(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "examples/graceful-shutdown.ts"],
      {
        env: { ...process.env, PORT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    let output = ""
    child.stdout.on("data", (chunk) => {
      output += chunk
    })
    child.stderr.on("data", (chunk) => {
      output += chunk
    })
    try {
      const ready = await waitUntil(() => /listening on (\d+) \(pid (\d+)\)/.exec(output))
      const [, port, pid] = ready
      const response = await fetch(`http://127.0.0.1:${port}/api/events`)
      const reader = response.body?.getReader()
      const first = await reader?.read()
      expect(new TextDecoder().decode(first?.value)).toContain("connected")
      process.kill(Number(pid), "SIGTERM")
      let text = ""
      for (;;) {
        const chunk = await reader?.read()
        if (!chunk || chunk.done) break
        text += new TextDecoder().decode(chunk.value)
      }
      expect(text).toContain("event: bye")
      await waitUntil(() => (output.includes("closed") ? true : null))
      expect(output).toContain("SIGTERM received, closing")
    } finally {
      child.kill("SIGKILL")
    }
  }, 20_000)
})

async function waitUntil<T>(probe: () => T | null, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() > deadline) throw new Error("timed out waiting for the example")
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
