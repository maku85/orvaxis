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
  const logger = options.logger ?? console
  fastify.all("/*", async (req, reply) => {
    const path = (req.url ?? "/").split("?")[0]
    const requestId =
      (req.headers["x-request-id"] as string) || (req.id as string) || crypto.randomUUID()
    const controller = new AbortController()
    const adapted = Object.assign(req, {
      path,
      method: req.method ?? "GET",
      headers: req.headers,
      id: requestId,
      signal: controller.signal,
    }) as unknown as OrvaxisRequest
    const wrapped = wrapFastifyResponse(reply)
    wrapped.setHeader("X-Request-ID", requestId)

    try {
      const handlePromise = app.handle(adapted, wrapped)
      await (timeoutMs > 0 ? withTimeout(handlePromise, timeoutMs, controller) : handlePromise)
    } catch (err) {
      if (!wrapped.sent) {
        const e = err as { status?: number }
        wrapped.status(e.status ?? 500).send({ error: sanitizeErrorMessage(err) })
      } else {
        logger.error("[orvaxis] unhandled error after response sent:", err)
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
