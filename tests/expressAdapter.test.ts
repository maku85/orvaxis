import { createServer as httpCreateServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { createExpressServer } from "../http/expressAdapter"

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

describe("createExpressServer — listen() guard", () => {
  it("rejects with a clear message when listen() is called while already listening", async () => {
    const server = createExpressServer(makeApp(), express())
    await server.listen(0)
    try {
      await expect(server.listen(0)).rejects.toThrow(
        "Server is already listening. Call close() first."
      )
    } finally {
      await server.close()
    }
  })

  it("allows listen() again after close()", async () => {
    const server = createExpressServer(makeApp(), express())
    await server.listen(0)
    await server.close()
    await expect(server.listen(0)).resolves.toBeUndefined()
    await server.close()
  })

  it("close() resolves even when the server is not listening", async () => {
    const server = createExpressServer(makeApp(), express())
    await expect(server.close()).resolves.toBeUndefined()
  })

  it("resets the listening flag when listen() fails so a retry is allowed", async () => {
    // Occupy a port so the next listen() call fails deterministically with
    // EADDRINUSE, regardless of OS/user privileges (unlike binding to a
    // privileged port, which only fails without root on some platforms).
    const blocker = httpCreateServer()
    await new Promise<void>((resolve) => blocker.listen(0, resolve))
    const occupiedPort = (blocker.address() as AddressInfo).port

    try {
      const server = createExpressServer(makeApp(), express())
      await expect(server.listen(occupiedPort)).rejects.toThrow()
      // guard must not block a subsequent attempt
      await expect(server.listen(0)).resolves.toBeUndefined()
      await server.close()
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  it("invokes the onListen callback with the OS-assigned port when listen(0) is used", async () => {
    const server = createExpressServer(makeApp(), express())
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

    const server = createExpressServer(makeApp(), express())
    const ports: number[] = []
    await server.listen(port, (p) => ports.push(p))
    try {
      expect(ports).toEqual([port])
    } finally {
      await server.close()
    }
  })
})

describe("createExpressServer — graceful shutdown", () => {
  it("calls closeIdleConnections() on the underlying http.Server when closing", async () => {
    const { Server } = await import("node:http")
    const spy = vi.spyOn(Server.prototype, "closeIdleConnections")
    const server = createExpressServer(makeApp(), express())
    await server.listen(0)
    await server.close()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it("calls closeAllConnections() after shutdownTimeout when connections do not drain", async () => {
    const { Server } = await import("node:http")
    const closeAllSpy = vi
      .spyOn(Server.prototype, "closeAllConnections")
      .mockImplementation(() => {})
    const closeSpy = vi.spyOn(Server.prototype, "close").mockImplementation(function (
      this: import("node:http").Server
    ) {
      return this // never invoke the callback — simulates connections that won't drain
    })
    const closeIdleSpy = vi
      .spyOn(Server.prototype, "closeIdleConnections")
      .mockReturnValue(undefined)

    const server = createExpressServer(makeApp(), express(), { shutdownTimeout: 50 })
    await server.listen(0)

    void server.close() // mocked close() never calls its callback — simulates stuck connections
    await new Promise<void>((r) => setTimeout(r, 150))

    expect(closeAllSpy).toHaveBeenCalled()

    closeAllSpy.mockRestore()
    closeSpy.mockRestore()
    closeIdleSpy.mockRestore()
    await server.close() // real close() now — drains and cleans up
  }, 1000)

  it("does not call closeAllConnections() when shutdown completes before the deadline", async () => {
    const { Server } = await import("node:http")
    const spy = vi.spyOn(Server.prototype, "closeAllConnections")
    const server = createExpressServer(makeApp(), express(), { shutdownTimeout: 5_000 })
    await server.listen(0)
    await server.close() // no active connections — fires immediately, clears the deadline
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("does not call closeAllConnections() when shutdownTimeout is 0", async () => {
    const { Server } = await import("node:http")
    const closeAllSpy = vi
      .spyOn(Server.prototype, "closeAllConnections")
      .mockImplementation(() => {})
    const closeSpy = vi.spyOn(Server.prototype, "close").mockImplementation(function (
      this: import("node:http").Server
    ) {
      return this // never invoke the callback — simulates connections that won't drain
    })
    const closeIdleSpy = vi
      .spyOn(Server.prototype, "closeIdleConnections")
      .mockReturnValue(undefined)

    const server = createExpressServer(makeApp(), express(), { shutdownTimeout: 0 })
    await server.listen(0)

    void server.close()
    await new Promise<void>((r) => setTimeout(r, 100))

    expect(closeAllSpy).not.toHaveBeenCalled()

    closeAllSpy.mockRestore()
    closeSpy.mockRestore()
    closeIdleSpy.mockRestore()
    await server.close()
  }, 500)
})

describe("createExpressServer — pipe() streaming", () => {
  it("streams response body via pipe() from a Readable", async () => {
    const { get, createServer } = await import("node:http")
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

    const expressApp = express()
    createExpressServer(orvaxisApp, expressApp)
    const httpSrv = createServer(expressApp)
    await new Promise<void>((resolve) => httpSrv.listen(0, resolve))
    const { port } = httpSrv.address() as import("node:net").AddressInfo

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
      await new Promise<void>((resolve) => httpSrv.close(() => resolve()))
    }
  }, 5000)

  it("delivers the full stream intact when the client consumes slower than the source produces", async () => {
    const { get, createServer } = await import("node:http")
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

    const expressApp = express()
    createExpressServer(orvaxisApp, expressApp)
    const httpSrv = createServer(expressApp)
    await new Promise<void>((resolve) => httpSrv.listen(0, resolve))
    const { port } = httpSrv.address() as AddressInfo

    try {
      const chunks: Buffer[] = []
      await new Promise<void>((resolve, reject) => {
        get(`http://localhost:${port}/pipe-large`, (res) => {
          // Trickle consumption: pause immediately, only drain briefly on an interval.
          // This fills the socket's receive buffer, which back-pressures the server's
          // res.write() calls inside pipe() — the scenario this test exists to cover.
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
      await new Promise<void>((resolve) => httpSrv.close(() => resolve()))
    }
  }, 15000)
})

describe("createExpressServer — SSE timeout auto-cancel", () => {
  it("does not kill a streaming connection when write() is called before the deadline", async () => {
    const { get } = await import("node:http")

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

    const expressApp = express()
    createExpressServer(orvaxisApp, expressApp, { timeout: 50 })

    const httpSrv = httpCreateServer(expressApp)
    await new Promise<void>((resolve) => httpSrv.listen(0, resolve))
    const { port } = httpSrv.address() as AddressInfo

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
      await new Promise<void>((resolve) => httpSrv.close(() => resolve()))
    }
  }, 2000)
})

describe("createExpressServer — graceful shutdown notifies in-flight streams", () => {
  it("aborts ctx.req.signal on close() so an SSE handler can end itself instead of being force-killed", async () => {
    const { get } = await import("node:http")
    const { Server } = await import("node:http")
    const closeAllSpy = vi.spyOn(Server.prototype, "closeAllConnections")

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

    const expressApp = express()
    // timeout: 0 — only the shutdown abort (not the per-request timeout) should end this handler
    const server = createExpressServer(orvaxisApp, expressApp, {
      timeout: 0,
      shutdownTimeout: 5_000,
    })
    const ports: number[] = []
    await server.listen(0, (p) => ports.push(p))
    const port = ports[0]

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

describe("createExpressServer — request ID header", () => {
  it("defaults to X-Request-ID: echoes an incoming value and generates one otherwise", async () => {
    const { request } = await import("node:http")
    const expressApp = express()
    createExpressServer(makeApp(), expressApp)
    const httpSrv = httpCreateServer(expressApp)
    await new Promise<void>((resolve) => httpSrv.listen(0, resolve))
    const { port } = httpSrv.address() as AddressInfo

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
      expect(await fetchHeader({ "x-request-id": "client-supplied-id" })).toBe(
        "client-supplied-id"
      )
    } finally {
      await new Promise<void>((resolve) => httpSrv.close(() => resolve()))
    }
  })

  it("honors a custom requestIdHeader for both reading and echoing", async () => {
    const { request } = await import("node:http")
    const expressApp = express()
    createExpressServer(makeApp(), expressApp, { requestIdHeader: "X-Correlation-ID" })
    const httpSrv = httpCreateServer(expressApp)
    await new Promise<void>((resolve) => httpSrv.listen(0, resolve))
    const { port } = httpSrv.address() as AddressInfo

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
      await new Promise<void>((resolve) => httpSrv.close(() => resolve()))
    }
  })
})

describe("createExpressServer — errors from upstream middleware", () => {
  it("formats a body-parser error (malformed JSON) as the standard ErrorResponse envelope", async () => {
    const { request } = await import("node:http")

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

    const expressApp = express()
    expressApp.use(express.json())
    const server = createExpressServer(orvaxisApp, expressApp)
    const ports: number[] = []
    await server.listen(0, (p) => ports.push(p))
    const port = ports[0]

    try {
      const res = await new Promise<{ status: number; contentType: string; body: string }>(
        (resolve, reject) => {
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
          req.end("{ not valid json")
        }
      )

      expect(res.status).toBe(400)
      expect(res.contentType).toContain("application/json")
      const parsed = JSON.parse(res.body)
      expect(parsed).toHaveProperty("error")
      expect(parsed).toHaveProperty("requestId")
    } finally {
      await server.close()
    }
  })
})
