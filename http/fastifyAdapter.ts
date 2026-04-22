import Fastify, { type FastifyReply } from "fastify"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"

function wrapFastifyResponse(reply: FastifyReply): OrvaxisResponse {
  const wrapped: OrvaxisResponse = {
    statusCode: 200,
    status(code) {
      wrapped.statusCode = code
      reply.status(code)
      return wrapped
    },
    json(body) {
      reply.send(body)
    },
    send(body) {
      reply.send(body)
    },
    setHeader(name, value) {
      reply.header(name, Array.isArray(value) ? value.join(", ") : value)
      return wrapped
    },
  }
  return wrapped
}

export function createFastifyServer(app: Orvaxis, fastify = Fastify()): ServerAdapter {
  fastify.all("/*", async (req, reply) => {
    const path = (req.url ?? "/").split("?")[0]
    const adapted = Object.assign(req, {
      path,
      method: req.method ?? "GET",
      headers: req.headers,
    }) as unknown as OrvaxisRequest
    const wrapped = wrapFastifyResponse(reply)

    try {
      await app.handle(adapted, wrapped)
    } catch (err) {
      const e = err as { status?: number; message?: string }
      wrapped.status(e.status ?? 500).send({ error: e.message ?? "Internal Server Error" })
    }
  })

  return {
    listen: async (port: number) => {
      await fastify.listen({ port })
      console.log(`Orvaxis running on ${port}`)
    },
  }
}
