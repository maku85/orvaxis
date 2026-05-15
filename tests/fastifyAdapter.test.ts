import Fastify from "fastify"
import { describe, expect, it } from "vitest"
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
