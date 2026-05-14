import Fastify, { type FastifyReply } from "fastify"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"
import { type AdapterOptions, sanitizeErrorMessage, withTimeout } from "./timeout"

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

export function createFastifyServer(
  app: Orvaxis,
  fastify = Fastify(),
  options: AdapterOptions = {}
): ServerAdapter {
  const timeoutMs = options.timeout ?? 30_000
  fastify.all("/*", async (req, reply) => {
    const path = (req.url ?? "/").split("?")[0]
    const adapted = Object.assign(req, {
      path,
      method: req.method ?? "GET",
      headers: req.headers,
    }) as unknown as OrvaxisRequest
    const wrapped = wrapFastifyResponse(reply)

    try {
      const handlePromise = app.handle(adapted, wrapped)
      await (timeoutMs > 0 ? withTimeout(handlePromise, timeoutMs) : handlePromise)
    } catch (err) {
      if (!wrapped.sent) {
        const e = err as { status?: number }
        wrapped.status(e.status ?? 500).send({ error: sanitizeErrorMessage(err) })
      } else {
        console.error("[orvaxis] unhandled error after response sent:", err)
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
