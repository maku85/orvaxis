import Fastify from "fastify"
import type { Orvaxis } from "../core/Orvaxis"
import type { ServerAdapter } from "../types"

export function createFastifyServer(app: Orvaxis): ServerAdapter {
  const fastify = Fastify()

  fastify.all("/*", async (req, reply) => {
    // Fastify uses req.url (may include query string); the Router expects req.path
    const path = (req.url ?? "/").split("?")[0]
    ;(req as any).path = path

    try {
      await app.handle(req as any, reply)
    } catch (err: any) {
      const status = err.status ?? 500
      reply.status(status).send({ error: err.message ?? "Internal Server Error" })
    }
  })

  return {
    listen: (port: number) => {
      fastify.listen({ port }, () => console.log(`Orvaxis running on ${port}`))
    },
  }
}
