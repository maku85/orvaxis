import Fastify, { type FastifyReply } from "fastify"
import { HttpError } from "../core/HttpError"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"
import { type AdapterOptions, buildErrorBody } from "./timeout"

function wrapFastifyResponse(reply: FastifyReply, onStreamStart: () => void): OrvaxisResponse {
  let statusCode = 200
  let streamStarted = false

  function startStream() {
    if (!streamStarted) {
      streamStarted = true
      onStreamStart()
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
    // FastifyRequest defines 'signal' (and others) as getter-only on the prototype.
    // Object.defineProperties bypasses [[Set]] entirely and adds own properties that shadow the getters.
    const adapted = Object.create(req) as OrvaxisRequest
    Object.defineProperties(adapted, {
      path: { value: path, writable: true, configurable: true, enumerable: true },
      id: { value: requestId, writable: true, configurable: true, enumerable: true },
      signal: { value: controller.signal, writable: true, configurable: true, enumerable: true },
    })
    let cancelTimer: (() => void) | undefined
    const wrapped = wrapFastifyResponse(reply, () => cancelTimer?.())
    wrapped.setHeader("X-Request-ID", requestId)

    try {
      const handlePromise = app.handle(adapted, wrapped)
      if (timeoutMs > 0) {
        let timer: ReturnType<typeof setTimeout>
        cancelTimer = () => clearTimeout(timer)
        await Promise.race([
          handlePromise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort()
              reject(new HttpError(408, "Request Timeout"))
            }, timeoutMs)
          }),
        ]).finally(() => clearTimeout(timer))
      } else {
        await handlePromise
      }
    } catch (err) {
      if (!wrapped.sent) {
        const e = err as { status?: number }
        wrapped.status(e.status ?? 500).send(buildErrorBody(err))
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
      if (!listening) return
      const shutdownTimeout = options.shutdownTimeout ?? 10_000
      fastify.server.closeIdleConnections()
      const deadline =
        shutdownTimeout > 0
          ? setTimeout(() => fastify.server.closeAllConnections(), shutdownTimeout)
          : undefined
      try {
        await fastify.close()
      } finally {
        clearTimeout(deadline)
        listening = false
      }
    },
  }
}
