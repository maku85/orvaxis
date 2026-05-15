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
})
