import { get, request } from "node:http"
import type { AddressInfo } from "node:net"
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { createFastifyServer } from "../http/fastifyAdapter"

function makeApp() {
  const app = new Orvaxis()
  app.group({
    prefix: "/",
    routes: [
      { method: "GET", path: "/health", handler: async (ctx) => ctx.res.json({ ok: true }) },
    ],
  })
  return app
}

describe("createFastifyServer — listen() guard", () => {
  it("rejects with a clear message when listen() is called while already listening", async () => {
    const server = createFastifyServer(makeApp(), Fastify())
    await server.listen(0)
    try {
      await expect(server.listen(0)).rejects.toThrow(
        "Server is already listening. Call close() first."
      )
    } finally {
      await server.close()
    }
  })

  it("resets the listening flag when fastify.listen() throws so a retry is allowed", async () => {
    let callCount = 0
    const mockFastify = {
      all: () => {},
      setErrorHandler: () => {},
      listen: async () => {
        callCount++
        if (callCount === 1) throw new Error("bind EADDRINUSE")
      },
      close: async () => {},
    } as unknown as ReturnType<typeof Fastify>

    const server = createFastifyServer(makeApp(), mockFastify)

    await expect(server.listen(3000)).rejects.toThrow("bind EADDRINUSE")
    await expect(server.listen(3000)).resolves.toBeUndefined()
  })

  it("close() resolves even when the server is not listening", async () => {
    const server = createFastifyServer(makeApp(), Fastify())
    await expect(server.close()).resolves.toBeUndefined()
  })

  it("calls closeIdleConnections() on the underlying server when closing", async () => {
    const fastifyInstance = Fastify()
    const server = createFastifyServer(makeApp(), fastifyInstance)
    await server.listen(0)
    const spy = vi.spyOn(fastifyInstance.server, "closeIdleConnections")
    await server.close()
    expect(spy).toHaveBeenCalled()
  })

  it("invokes the onListen callback with the OS-assigned port when listen(0) is used", async () => {
    const server = createFastifyServer(makeApp(), Fastify())
    const ports: number[] = []
    await server.listen(0, (p) => ports.push(p))
    try {
      expect(ports).toHaveLength(1)
      expect(ports[0]).toBeGreaterThan(0)
    } finally {
      await server.close()
    }
  })

  it("invokes the onListen callback with the requested port when a specific port is given", async () => {
    const { createServer } = await import("node:http")
    const finder = createServer()
    await new Promise<void>((resolve) => finder.listen(0, resolve))
    const port = (finder.address() as AddressInfo).port
    await new Promise<void>((resolve) => finder.close(() => resolve()))

    const server = createFastifyServer(makeApp(), Fastify())
    const ports: number[] = []
    await server.listen(port, (p) => ports.push(p))
    try {
      expect(ports).toEqual([port])
    } finally {
      await server.close()
    }
  })
})

describe("createFastifyServer — shutdown deadline", () => {
  it("calls closeAllConnections() after shutdownTimeout when connections do not drain", async () => {
    const fastifyInstance = Fastify()
    const server = createFastifyServer(makeApp(), fastifyInstance, { shutdownTimeout: 50 })
    await server.listen(0)

    const closeAllSpy = vi
      .spyOn(fastifyInstance.server, "closeAllConnections")
      .mockImplementation(() => {})
    vi.spyOn(fastifyInstance.server, "closeIdleConnections").mockImplementation(() => {})
    vi.spyOn(fastifyInstance, "close").mockImplementation(() => new Promise<void>(() => {}))

    void server.close() // never resolves — simulates connections that won't drain
    await new Promise<void>((r) => setTimeout(r, 150))

    expect(closeAllSpy).toHaveBeenCalled()
  }, 1000)

  it("does not call closeAllConnections() when shutdown completes before the deadline", async () => {
    const fastifyInstance = Fastify()
    const server = createFastifyServer(makeApp(), fastifyInstance, { shutdownTimeout: 5_000 })
    await server.listen(0)
    const spy = vi.spyOn(fastifyInstance.server, "closeAllConnections")
    await server.close() // no active connections — fires immediately, clears the deadline
    expect(spy).not.toHaveBeenCalled()
  })

  it("does not call closeAllConnections() when shutdownTimeout is 0", async () => {
    const fastifyInstance = Fastify()
    const server = createFastifyServer(makeApp(), fastifyInstance, { shutdownTimeout: 0 })
    await server.listen(0)

    const closeAllSpy = vi
      .spyOn(fastifyInstance.server, "closeAllConnections")
      .mockImplementation(() => {})
    vi.spyOn(fastifyInstance.server, "closeIdleConnections").mockImplementation(() => {})
    vi.spyOn(fastifyInstance, "close").mockImplementation(() => new Promise<void>(() => {}))

    void server.close()
    await new Promise<void>((r) => setTimeout(r, 100))

    expect(closeAllSpy).not.toHaveBeenCalled()
  }, 500)
})

describe("createFastifyServer — pipe() streaming", () => {
  it("streams response body via pipe() from a Readable", async () => {
    const { get } = await import("node:http")
    const { Readable } = await import("node:stream")

    const orvaxisApp = new Orvaxis()
    orvaxisApp.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/pipe",
          handler: async (ctx) => {
            ctx.res.setHeader("Content-Type", "text/plain")
            ctx.res.pipe(Readable.from(["hello", " ", "world"]))
          },
        },
      ],
    })

    const fastifyInstance = Fastify()
    const server = createFastifyServer(orvaxisApp, fastifyInstance)
    await server.listen(0)
    const { port } = fastifyInstance.server.address() as AddressInfo

    try {
      const body = await new Promise<string>((resolve, reject) => {
        get(`http://localhost:${port}/pipe`, (res) => {
          let data = ""
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString()
          })
          res.on("end", () => resolve(data))
          res.on("error", reject)
        }).on("error", reject)
      })
      expect(body).toBe("hello world")
    } finally {
      await server.close()
    }
  }, 5000)

  it("delivers the full stream intact when the client consumes slower than the source produces", async () => {
    const { Readable } = await import("node:stream")

    const CHUNK_SIZE = 64 * 1024
    const CHUNK_COUNT = 80 // ~5MB total — large enough to fill socket buffers and force backpressure
    let produced = 0

    const orvaxisApp = new Orvaxis()
    orvaxisApp.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/pipe-large",
          handler: async (ctx) => {
            ctx.res.setHeader("Content-Type", "application/octet-stream")
            // Each chunk is filled with its own index (mod 256), so reordering/corruption
            // introduced by a pipe() that mishandles backpressure would be detectable.
            const source = new Readable({
              read() {
                if (produced >= CHUNK_COUNT) {
                  this.push(null)
                  return
                }
                this.push(Buffer.alloc(CHUNK_SIZE, produced % 256))
                produced++
              },
            })
            ctx.res.pipe(source)
          },
        },
      ],
    })

    const fastifyInstance = Fastify()
    const server = createFastifyServer(orvaxisApp, fastifyInstance)
    await server.listen(0)
    const { port } = fastifyInstance.server.address() as AddressInfo

    try {
      const chunks: Buffer[] = []
      await new Promise<void>((resolve, reject) => {
        get(`http://localhost:${port}/pipe-large`, (res) => {
          // Trickle consumption: pause immediately, only drain briefly on an interval.
          // This fills the socket's receive buffer, which back-pressures the server's
          // write calls inside pipe() — the scenario this test exists to cover.
          res.pause()
          const interval = setInterval(() => {
            res.resume()
            setImmediate(() => res.pause())
          }, 5)
          res.on("data", (chunk: Buffer) => chunks.push(chunk))
          res.on("end", () => {
            clearInterval(interval)
            resolve()
          })
          res.on("error", (err) => {
            clearInterval(interval)
            reject(err)
          })
        }).on("error", reject)
      })

      const full = Buffer.concat(chunks)
      expect(full.length).toBe(CHUNK_SIZE * CHUNK_COUNT)
      for (let i = 0; i < CHUNK_COUNT; i++) {
        const slice = full.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        expect(slice.every((byte) => byte === i % 256)).toBe(true)
      }
    } finally {
      await server.close()
    }
  }, 15000)
})

describe("createFastifyServer — SSE timeout auto-cancel", () => {
  it("does not kill a streaming connection when write() is called before the deadline", async () => {
    const orvaxisApp = new Orvaxis()
    orvaxisApp.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/stream",
          handler: async (ctx) => {
            ctx.res.write(": ping\n\n")
            await new Promise<void>((resolve) => {
              ctx.req.signal?.addEventListener("abort", resolve)
              setTimeout(resolve, 300)
            })
            ctx.res.end()
          },
        },
      ],
    })

    const fastifyInstance = Fastify()
    const server = createFastifyServer(orvaxisApp, fastifyInstance, { timeout: 50 })
    await server.listen(0)
    const { port } = fastifyInstance.server.address() as AddressInfo

    try {
      const res = await new Promise<{ statusCode: number; alive: boolean }>((resolve, reject) => {
        const req = get(`http://localhost:${port}/stream`, (incoming) => {
          setTimeout(() => {
            resolve({ statusCode: incoming.statusCode ?? 0, alive: !incoming.destroyed })
            req.destroy()
          }, 120)
        })
        req.on("error", reject)
      })

      expect(res.statusCode).toBe(200)
      expect(res.alive).toBe(true)
    } finally {
      await server.close()
    }
  }, 2000)
})

describe("createFastifyServer — graceful shutdown notifies in-flight streams", () => {
  it("aborts ctx.req.signal on close() so an SSE handler can end itself instead of being force-killed", async () => {
    let handlerFinishedGracefully = false
    const orvaxisApp = new Orvaxis()
    orvaxisApp.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/stream",
          handler: async (ctx) => {
            ctx.res.write(": ping\n\n")
            await new Promise<void>((resolve) => {
              ctx.req.signal?.addEventListener("abort", () => resolve(), { once: true })
            })
            handlerFinishedGracefully = true
            ctx.res.write("event: bye\ndata: shutting down\n\n")
            ctx.res.end()
          },
        },
      ],
    })

    const fastifyInstance = Fastify()
    // timeout: 0 — only the shutdown abort (not the per-request timeout) should end this handler
    const server = createFastifyServer(orvaxisApp, fastifyInstance, {
      timeout: 0,
      shutdownTimeout: 5_000,
    })
    await server.listen(0)
    const { port } = fastifyInstance.server.address() as AddressInfo
    const closeAllSpy = vi.spyOn(fastifyInstance.server, "closeAllConnections")

    try {
      const body = await new Promise<string>((resolve, reject) => {
        let data = ""
        const req = get(`http://localhost:${port}/stream`, (res) => {
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString()
            // once the initial ping arrives, trigger shutdown — the handler is now "in-flight"
            if (data.includes("ping") && !handlerFinishedGracefully) {
              void server.close()
            }
          })
          res.on("end", () => resolve(data))
          res.on("error", reject)
        })
        req.on("error", reject)
      })

      expect(handlerFinishedGracefully).toBe(true)
      expect(body).toContain("event: bye")
      // graceful path: the handler ended the response itself before shutdownTimeout forced it
      expect(closeAllSpy).not.toHaveBeenCalled()
    } finally {
      closeAllSpy.mockRestore()
    }
  }, 5000)
})

describe("createFastifyServer — request ID header", () => {
  it("defaults to X-Request-ID: echoes an incoming value and generates one otherwise", async () => {
    const fastifyInstance = Fastify()
    const server = createFastifyServer(makeApp(), fastifyInstance)
    await server.listen(0)
    const { port } = fastifyInstance.server.address() as AddressInfo

    const fetchHeader = (reqHeaders: Record<string, string>) =>
      new Promise<string | undefined>((resolve, reject) => {
        request(`http://localhost:${port}/health`, { headers: reqHeaders }, (res) => {
          res.resume()
          res.on("end", () => resolve(res.headers["x-request-id"] as string | undefined))
        })
          .on("error", reject)
          .end()
      })

    try {
      expect(await fetchHeader({})).toBeTruthy()
      expect(await fetchHeader({ "x-request-id": "client-supplied-id" })).toBe("client-supplied-id")
    } finally {
      await server.close()
    }
  })

  it("honors a custom requestIdHeader for both reading and echoing", async () => {
    const fastifyInstance = Fastify()
    const server = createFastifyServer(makeApp(), fastifyInstance, {
      requestIdHeader: "X-Correlation-ID",
    })
    await server.listen(0)
    const { port } = fastifyInstance.server.address() as AddressInfo

    const fetchHeaders = (reqHeaders: Record<string, string>) =>
      new Promise<Record<string, string | string[] | undefined>>((resolve, reject) => {
        request(`http://localhost:${port}/health`, { headers: reqHeaders }, (res) => {
          res.resume()
          res.on("end", () => resolve(res.headers))
        })
          .on("error", reject)
          .end()
      })

    try {
      const headers = await fetchHeaders({ "x-correlation-id": "trace-abc-123" })
      expect(headers["x-correlation-id"]).toBe("trace-abc-123")
      expect(headers["x-request-id"]).toBeUndefined()
    } finally {
      await server.close()
    }
  })
})

describe("createFastifyServer — errors from Fastify's own request lifecycle", () => {
  function postRaw(
    port: number,
    body: string
  ): Promise<{ status: number; contentType: string; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: "localhost",
          port,
          path: "/echo",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        (incoming) => {
          let data = ""
          incoming.on("data", (chunk: Buffer) => {
            data += chunk.toString()
          })
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              contentType: String(incoming.headers["content-type"]),
              body: data,
            })
          )
        }
      )
      req.on("error", reject)
      req.end(body)
    })
  }

  it("formats a malformed-JSON error (native Fastify content-type parsing) as the standard ErrorResponse envelope", async () => {
    const orvaxisApp = new Orvaxis()
    orvaxisApp.group({
      prefix: "/",
      routes: [
        {
          method: "POST",
          path: "/echo",
          handler: async (ctx) => ctx.res.json({ received: ctx.req.body }),
        },
      ],
    })

    const fastifyInstance = Fastify()
    const server = createFastifyServer(orvaxisApp, fastifyInstance)
    await server.listen(0)
    const { port } = fastifyInstance.server.address() as AddressInfo

    try {
      const res = await postRaw(port, "{ not valid json")
      expect(res.status).toBe(400)
      expect(res.contentType).toContain("application/json")
      const parsed = JSON.parse(res.body)
      expect(parsed).toHaveProperty("error")
      expect(parsed).toHaveProperty("requestId")
      expect(parsed.code).toBe("FST_ERR_CTP_INVALID_JSON_BODY")
    } finally {
      await server.close()
    }
  })

  it("formats a bodyLimit error as the standard ErrorResponse envelope", async () => {
    const orvaxisApp = new Orvaxis()
    orvaxisApp.group({
      prefix: "/",
      routes: [
        {
          method: "POST",
          path: "/echo",
          handler: async (ctx) => ctx.res.json({ received: ctx.req.body }),
        },
      ],
    })

    const fastifyInstance = Fastify({ bodyLimit: 10 })
    const server = createFastifyServer(orvaxisApp, fastifyInstance)
    await server.listen(0)
    const { port } = fastifyInstance.server.address() as AddressInfo

    try {
      const res = await postRaw(port, JSON.stringify({ a: "definitely more than ten bytes" }))
      expect(res.status).toBe(413)
      expect(res.contentType).toContain("application/json")
      const parsed = JSON.parse(res.body)
      expect(parsed).toHaveProperty("error")
      expect(parsed).toHaveProperty("requestId")
      expect(parsed.code).toBe("FST_ERR_CTP_BODY_TOO_LARGE")
    } finally {
      await server.close()
    }
  })
})
