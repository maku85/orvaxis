import Fastify from "fastify"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"

export function createFastifyServer(app: Orvaxis): ServerAdapter {
  const fastify = Fastify()

  fastify.all("/*", async (req, reply) => {
    const path = (req.url ?? "/").split("?")[0]
    const adapted = Object.assign(req, { path }) as unknown as OrvaxisRequest

    try {
      await app.handle(adapted, reply as unknown as OrvaxisResponse)
    } catch (err) {
      const e = err as { status?: number; message?: string }
      const status = e.status ?? 500
      reply.status(status).send({ error: e.message ?? "Internal Server Error" })
    }
  })

  return {
    listen: async (port: number) => {
      await fastify.listen({ port })
      console.log(`Orvaxis running on ${port}`)
    },
  }
}
