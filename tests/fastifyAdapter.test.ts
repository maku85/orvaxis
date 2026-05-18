import { get } from "node:http"
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

  it("invokes the onListen callback with the port after a successful listen", async () => {
    const server = createFastifyServer(makeApp(), Fastify())
    const ports: number[] = []
    await server.listen(0, (p) => ports.push(p))
    try {
      expect(ports).toEqual([0])
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
