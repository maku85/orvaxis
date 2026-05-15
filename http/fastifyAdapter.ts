import Fastify, { type FastifyReply } from "fastify"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"
import { type AdapterOptions, sanitizeErrorMessage, withTimeout } from "./timeout"

function wrapFastifyResponse(reply: FastifyReply): OrvaxisResponse {
  let statusCode = 200
  let streamStarted = false

  function startStream() {
    if (!streamStarted) {
      streamStarted = true
      reply.hijack()
      reply.raw.writeHead(
        statusCode,
        reply.getHeaders() as unknown as import("node:http").OutgoingHttpHeaders
      )
    }
  }

  const wrapped: OrvaxisResponse = {
    statusCode: 200,
    sent: false,
    status(code) {
      statusCode = code
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
    write(chunk) {
      wrapped.sent = true
      startStream()
      reply.raw.write(chunk)
    },
    end(chunk?) {
      startStream()
      wrapped.sent = true
      if (chunk !== undefined) reply.raw.end(chunk)
      else reply.raw.end()
    },
    pipe(stream) {
      wrapped.sent = true
      reply.send(stream)
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

  let listening = false

  return {
    listen: async (port: number, onListen?: (port: number) => void) => {
      if (listening) {
        throw new Error("Server is already listening. Call close() first.")
      }
      try {
        await fastify.listen({ port })
        listening = true
        onListen?.(port)
      } catch (err) {
        listening = false
        throw err
      }
    },
    close: async () => {
      await fastify.close()
      listening = false
    },
  }
}
