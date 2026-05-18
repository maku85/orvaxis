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
    const server = createExpressServer(makeApp(), express())
    // port 1 is privileged and will fail on Linux without root
    await expect(server.listen(1)).rejects.toThrow()
    // guard must not block a subsequent attempt
    await expect(server.listen(0)).resolves.toBeUndefined()
    await server.close()
  })

  it("invokes the onListen callback with the port after a successful listen", async () => {
    const server = createExpressServer(makeApp(), express())
    const ports: number[] = []
    await server.listen(0, (p) => ports.push(p))
    try {
      expect(ports).toEqual([0])
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
