import Fastify, { type FastifyReply } from "fastify"
import type { Orvaxis } from "../core/Orvaxis.js"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types/index.js"
import { type AdapterOptions, buildErrorBody, withTimeout } from "./timeout.js"

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
    get completed() {
      return reply.raw.writableFinished
    },
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
      startStream()
      stream.pipe(reply.raw, { end: true })
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
  const requestIdHeader = options.requestIdHeader ?? "X-Request-ID"
  const requestIdHeaderLower = requestIdHeader.toLowerCase()
  const activeControllers = new Set<AbortController>()
  fastify.all("/*", async (req, reply) => {
    const path = (req.url ?? "/").split("?")[0]
    const requestId =
      (req.headers[requestIdHeaderLower] as string) || (req.id as string) || crypto.randomUUID()
    const controller = new AbortController()
    activeControllers.add(controller)
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
    wrapped.setHeader(requestIdHeader, requestId)

    try {
      const handlePromise = app.handle(adapted, wrapped)
      if (timeoutMs > 0) {
        await withTimeout(handlePromise, timeoutMs, controller, (cancel) => {
          cancelTimer = cancel
        })
      } else {
        await handlePromise
      }
    } catch (err) {
      if (!wrapped.sent) {
        const e = err as { status?: number }
        wrapped.status(e.status ?? 500).send(buildErrorBody(err, requestId))
      } else {
        logger.error("[orvaxis] unhandled error after response sent:", err)
      }
    } finally {
      activeControllers.delete(controller)
    }
  })

  // Errors from Fastify's own request lifecycle (content-type parsing, bodyLimit) are thrown
  // before the catch-all route above ever runs, so they never reach its try/catch. Without this,
  // Fastify sends its own { statusCode, code, error, message } shape instead of the ErrorResponse
  // envelope. This is the same envelope used for errors thrown inside the Orvaxis runtime, just
  // applied before the runtime ever ran.
  fastify.setErrorHandler((err, req, reply) => {
    if (reply.sent) {
      logger.error("[orvaxis] unhandled error after response sent:", err)
      return
    }
    const requestId =
      (req.headers[requestIdHeaderLower] as string) || (req.id as string) || crypto.randomUUID()
    const e = err as { statusCode?: number; status?: number }
    reply
      .header(requestIdHeader, requestId)
      .status(e.statusCode ?? e.status ?? 500)
      .send(buildErrorBody(err, requestId))
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
        const address = fastify.server?.address()
        onListen?.(typeof address === "object" && address ? address.port : port)
      } catch (err) {
        listening = false
        throw err
      }
    },
    close: async () => {
      if (!listening) return
      const shutdownTimeout = options.shutdownTimeout ?? 10_000
      // Notify in-flight handlers (e.g. SSE loops) that shutdown has started, via the same
      // ctx.req.signal already used for per-request timeouts — see README "Graceful shutdown".
      for (const controller of activeControllers) controller.abort()
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
