import { createServer, request } from "node:http"
import { Readable } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import { HttpError } from "../core/HttpError"
import { Orvaxis } from "../core/Orvaxis"
import { createNodeServer } from "../http/nodeAdapter"
import type { ServerAdapter } from "../types"

const adapters: ServerAdapter[] = []
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((a) => a.close()))
})

async function start(app: Orvaxis, options: Parameters<typeof createNodeServer>[1] = {}) {
  const adapter = createNodeServer(app, { timeout: 0, shutdownTimeout: 200, ...options })
  let port = 0
  await adapter.listen(0, (p) => {
    port = p
  })
  adapters.push(adapter)
  return { adapter, base: `http://127.0.0.1:${port}`, port }
}

function makeApp() {
  const app = new Orvaxis()
  app.group({
    prefix: "/api",
    routes: [
      { method: "GET", path: "/hello", handler: (ctx) => ctx.res.json({ hello: "world" }) },
      {
        method: "POST",
        path: "/echo",
        handler: (ctx) => ctx.res.json({ body: ctx.req.body ?? null }),
      },
      { method: "GET", path: "/query", handler: (ctx) => ctx.res.json(ctx.req.query) },
      { method: "GET", path: "/users/:id", handler: (ctx) => ctx.res.json({ id: ctx.params.id }) },
      {
        method: "GET",
        path: "/boom",
        handler: () => {
          throw Object.assign(new Error("db password=hunter2"), { code: "ER_X", details: { a: 1 } })
        },
      },
      {
        method: "GET",
        path: "/teapot",
        handler: () => {
          throw new HttpError(418, "I'm a teapot", { code: "TEAPOT" })
        },
      },
      { method: "GET", path: "/text", handler: (ctx) => ctx.res.send("plain") },
      { method: "GET", path: "/bytes", handler: (ctx) => ctx.res.send(Buffer.from([1, 2, 3])) },
      { method: "GET", path: "/object", handler: (ctx) => ctx.res.send({ a: 1 }) },
      {
        method: "GET",
        path: "/cookies",
        handler: (ctx) => {
          ctx.res.setHeader("Set-Cookie", ["a=1", "b=2"])
          ctx.res.json({})
        },
      },
      {
        method: "GET",
        path: "/stream",
        handler: (ctx) => {
          ctx.res.setHeader("Content-Type", "text/plain")
          ctx.res.write("one,")
          ctx.res.write("two")
          ctx.res.end()
        },
      },
      {
        method: "GET",
        path: "/pipe",
        handler: (ctx) => {
          ctx.res.pipe(Readable.from(["a", "b", "c"]))
        },
      },
      {
        method: "GET",
        path: "/raw",
        handler: (ctx) => ctx.res.json({ hasRaw: typeof ctx.req.raw === "object" }),
      },
    ],
  })
  return app
}

describe("createNodeServer", () => {
  it("serves JSON routes, params and 404/405 through the error envelope", async () => {
    const { base } = await start(makeApp())
    expect(await (await fetch(`${base}/api/hello`)).json()).toEqual({ hello: "world" })
    expect(await (await fetch(`${base}/api/users/a%20b`)).json()).toEqual({ id: "a b" })
    const missing = await fetch(`${base}/api/nope`)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ requestId: expect.any(String) })
    const wrong = await fetch(`${base}/api/hello`, { method: "DELETE" })
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get("allow")).toContain("GET")
  })

  it("parses a JSON body, rejects malformed JSON with 400, and ignores other content types", async () => {
    const { base } = await start(makeApp())
    const post = (body: string, type = "application/json") =>
      fetch(`${base}/api/echo`, { method: "POST", headers: { "content-type": type }, body })
    expect(await (await post('{"x":1}')).json()).toEqual({ body: { x: 1 } })
    expect(await (await post('{"x":1}', "application/vnd.api+json")).json()).toEqual({
      body: { x: 1 },
    })
    const bad = await post("{nope")
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ code: "INVALID_JSON" })
    expect(await (await post("x=1", "application/x-www-form-urlencoded")).json()).toEqual({
      body: null,
    })
    expect(await (await post("")).json()).toEqual({ body: null })
  })

  it("enforces bodyLimit for declared and undeclared lengths with 413", async () => {
    const { base, port } = await start(makeApp(), { bodyLimit: 16 })
    const big = JSON.stringify({ pad: "x".repeat(100) })
    const declared = await fetch(`${base}/api/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: big,
    })
    expect(declared.status).toBe(413)
    expect(await declared.json()).toMatchObject({ code: "BODY_TOO_LARGE" })

    // Chunked upload: no content-length to check up front.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          port,
          path: "/api/echo",
          method: "POST",
          headers: { "content-type": "application/json" },
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on("error", reject)
      req.write(big.slice(0, 40))
      req.end(big.slice(40))
    })
    expect(status).toBe(413)
  })

  it("parses the query string, keeps repeated keys as arrays and drops prototype keys", async () => {
    const { base } = await start(makeApp())
    const query = await (await fetch(`${base}/api/query?a=1&b=2&b=3&c=x%20y&__proto__=1`)).json()
    expect(query).toEqual({ a: "1", b: ["2", "3"], c: "x y" })
    expect(Object.getPrototypeOf(query)).toBe(Object.prototype)
  })

  it("generates a request ID, accepts a valid one and replaces an invalid one", async () => {
    const { base } = await start(makeApp())
    expect((await fetch(`${base}/api/hello`)).headers.get("x-request-id")).toMatch(
      /^[0-9a-f-]{36}$/
    )
    const ok = await fetch(`${base}/api/hello`, { headers: { "x-request-id": "client-1" } })
    expect(ok.headers.get("x-request-id")).toBe("client-1")
    const bad = await fetch(`${base}/api/hello`, { headers: { "x-request-id": "a b" } })
    expect(bad.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("honors trustRequestId: false", async () => {
    const { base } = await start(makeApp(), { trustRequestId: false })
    const res = await fetch(`${base}/api/hello`, { headers: { "x-request-id": "client-1" } })
    expect(res.headers.get("x-request-id")).not.toBe("client-1")
  })

  it("answers errors with the envelope and never leaks code or details of plain errors", async () => {
    const { base } = await start(makeApp())
    const boom = await fetch(`${base}/api/boom`)
    expect(boom.status).toBe(500)
    const body = await boom.json()
    expect(body).not.toHaveProperty("code")
    expect(body).not.toHaveProperty("details")
    const teapot = await fetch(`${base}/api/teapot`)
    expect(teapot.status).toBe(418)
    expect(await teapot.json()).toMatchObject({ error: "I'm a teapot", code: "TEAPOT" })
  })

  it("sends text, bytes and objects with the right content type", async () => {
    const { base } = await start(makeApp())
    const text = await fetch(`${base}/api/text`)
    expect(text.headers.get("content-type")).toContain("text/plain")
    expect(await text.text()).toBe("plain")
    const bytes = await fetch(`${base}/api/bytes`)
    expect(bytes.headers.get("content-type")).toBe("application/octet-stream")
    expect([...new Uint8Array(await bytes.arrayBuffer())]).toEqual([1, 2, 3])
    const object = await fetch(`${base}/api/object`)
    expect(object.headers.get("content-type")).toContain("application/json")
    expect(await object.json()).toEqual({ a: 1 })
  })

  it("sends each Set-Cookie as its own header", async () => {
    const { base } = await start(makeApp())
    const res = await fetch(`${base}/api/cookies`)
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"])
  })

  it("streams with write/end and pipe, and answers HEAD without a body", async () => {
    const { base } = await start(makeApp())
    expect(await (await fetch(`${base}/api/stream`)).text()).toBe("one,two")
    expect(await (await fetch(`${base}/api/pipe`)).text()).toBe("abc")
    const head = await fetch(`${base}/api/hello`, { method: "HEAD" })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe("")
  })

  it("exposes the IncomingMessage as ctx.req.raw", async () => {
    const { base } = await start(makeApp())
    expect(await (await fetch(`${base}/api/raw`)).json()).toEqual({ hasRaw: true })
  })

  it("rejects listen() twice and treats close() as idempotent", async () => {
    const { adapter } = await start(makeApp())
    await expect(adapter.listen(0)).rejects.toThrow("already listening")
    await adapter.close()
    await adapter.close()
  })

  it("can listen again after close()", async () => {
    const adapter = createNodeServer(makeApp(), { timeout: 0 })
    await adapter.listen(0)
    await adapter.close()
    await adapter.listen(0)
    await adapter.close()
  })

  it("attaches to a server you provide", async () => {
    const server = createServer()
    const { base } = await start(makeApp(), { server })
    expect((await fetch(`${base}/api/hello`)).status).toBe(200)
  })

  it("rejects listen() under denyByDefault when a route is unprotected", async () => {
    const app = new Orvaxis({ denyByDefault: true })
    app.group({
      prefix: "/api",
      routes: [{ method: "GET", path: "/x", handler: (ctx) => ctx.res.json({}) }],
    })
    await expect(createNodeServer(app).listen(0)).rejects.toThrow(/GET \/api\/x/)
  })

  it("answers 503 on timeout and aborts the request signal", async () => {
    const app = new Orvaxis()
    let signal: AbortSignal | undefined
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/slow",
          handler: async (ctx) => {
            signal = ctx.req.signal
            await new Promise((r) => setTimeout(r, 300))
          },
        },
      ],
    })
    const { base } = await start(app, { timeout: 50 })
    const res = await fetch(`${base}/slow`)
    expect(res.status).toBe(503)
    expect(signal?.aborted).toBe(true)
  })

  it("aborts in-flight requests when close() starts and runs plugin close handlers", async () => {
    const app = new Orvaxis()
    const closed: string[] = []
    app.register({ name: "p", apply: (ctx) => ctx.onClose(() => void closed.push("p")) })
    let started!: () => void
    const ready = new Promise<void>((r) => {
      started = r
    })
    let aborted = false
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/sse",
          handler: async (ctx) => {
            ctx.res.setHeader("Content-Type", "text/event-stream")
            ctx.res.write("data: hi\n\n")
            started()
            await new Promise<void>((resolve) =>
              ctx.req.signal?.addEventListener("abort", () => {
                aborted = true
                resolve()
              })
            )
            ctx.res.end()
          },
        },
      ],
    })
    const { adapter, base } = await start(app)
    const pending = fetch(`${base}/sse`).then((r) => r.text())
    await ready
    await adapter.close()
    expect(aborted).toBe(true)
    expect(await pending).toContain("data: hi")
    expect(closed).toEqual(["p"])
  })
})
