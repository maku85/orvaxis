import Fastify, { type FastifyReply } from "fastify"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"

function wrapFastifyResponse(reply: FastifyReply): OrvaxisResponse {
  const wrapped: OrvaxisResponse = {
    statusCode: 200,
    sent: false,
    status(code) {
      wrapped.statusCode = code
      reply.status(code)
      return wrapped
    },
    json(body) {
      wrapped.sent = true
      reply.send(body)
    },
    send(body) {
      wrapped.sent = true
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
      if (!wrapped.sent) {
        const e = err as { status?: number; message?: string }
        wrapped.status(e.status ?? 500).send({ error: e.message ?? "Internal Server Error" })
      }
    }
  })

  return {
    listen: async (port: number, onListen?: (port: number) => void) => {
      await fastify.listen({ port })
      onListen?.(port)
    },
    close: () => fastify.close(),
  }
}
