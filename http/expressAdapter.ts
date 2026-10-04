import express, { type Application, type NextFunction, type Request, type Response } from "express"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"
import { type AdapterOptions, buildErrorBody, withTimeout } from "./timeout"

function wrapExpressResponse(res: Response, onStreamStart: () => void): OrvaxisResponse {
  const wrapped: OrvaxisResponse = {
    statusCode: 200,
    sent: false,
    get completed() {
      return res.writableFinished
    },
    status(code) {
      wrapped.statusCode = code
      res.status(code)
      return wrapped
    },
    json(body) {
      wrapped.sent = true
      res.json(body)
    },
    send(body) {
      wrapped.sent = true
      res.send(body as string)
    },
    setHeader(name, value) {
      res.set(name, value as string | string[])
      return wrapped
    },
    write(chunk) {
      onStreamStart()
      wrapped.sent = true
      res.write(chunk)
    },
    end(chunk?) {
      wrapped.sent = true
      if (chunk !== undefined) res.end(chunk)
      else res.end()
    },
    pipe(stream) {
      wrapped.sent = true
      stream.pipe(res)
    },
  }
  return wrapped
}

export function createExpressServer(
  app: Orvaxis,
  server: Application = express(),
  options: AdapterOptions = {}
): ServerAdapter {
  const timeoutMs = options.timeout ?? 30_000
  const logger = options.logger ?? console
  const requestIdHeader = options.requestIdHeader ?? "X-Request-ID"
  const requestIdHeaderLower = requestIdHeader.toLowerCase()
  const activeControllers = new Set<AbortController>()
  server.use(async (req: Request, res: Response, _next: NextFunction) => {
    const requestId = (req.headers[requestIdHeaderLower] as string) || crypto.randomUUID()
    const controller = new AbortController()
    activeControllers.add(controller)
    // Express.request defines 'path' (and others) as getter-only on the prototype.
    // Object.defineProperties bypasses [[Set]] entirely and adds own properties that shadow the getters.
    const adapted = Object.create(req) as OrvaxisRequest
    Object.defineProperties(adapted, {
      query: {
        value: req.query as unknown as Record<string, string | string[]>,
        writable: true,
        configurable: true,
        enumerable: true,
      },
      id: { value: requestId, writable: true, configurable: true, enumerable: true },
      signal: { value: controller.signal, writable: true, configurable: true, enumerable: true },
    })

    let cancelTimer: (() => void) | undefined
    const wrapped = wrapExpressResponse(res, () => cancelTimer?.())
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
        wrapped.status(e.status ?? 500).json(buildErrorBody(err, requestId))
      } else {
        logger.error("[orvaxis] unhandled error after response sent:", err)
      }
    } finally {
      activeControllers.delete(controller)
    }
  })

  // Errors thrown by middleware registered before this adapter (e.g. express.json() on
  // malformed or oversized bodies) call next(err), which Express routes past the 3-arg
  // middleware above straight to an error handler. Without one, Express's own default HTML
  // error page is sent instead of the ErrorResponse envelope. This is the same envelope used
  // for errors thrown inside the Orvaxis runtime, just applied before the runtime ever ran.
  server.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      logger.error("[orvaxis] unhandled error after headers sent:", err)
      return
    }
    const requestId = (req.headers[requestIdHeaderLower] as string) || crypto.randomUUID()
    const e = err as { status?: number; statusCode?: number }
    res
      .set(requestIdHeader, requestId)
      .status(e.status ?? e.statusCode ?? 500)
      .json(buildErrorBody(err, requestId))
  })

  let httpServer: ReturnType<typeof server.listen> | null = null

  return {
    listen: (port: number, onListen?: (port: number) => void) =>
      new Promise<void>((resolve, reject) => {
        if (httpServer) {
          return reject(new Error("Server is already listening. Call close() first."))
        }
        httpServer = server
          .listen(port)
          .once("listening", () => {
            const address = httpServer?.address()
            onListen?.(typeof address === "object" && address ? address.port : port)
            resolve()
          })
          .once("error", (err) => {
            httpServer = null
            reject(err)
          })
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!httpServer) return resolve()
        const shutdownTimeout = options.shutdownTimeout ?? 10_000
        // Notify in-flight handlers (e.g. SSE loops) that shutdown has started, via the same
        // ctx.req.signal already used for per-request timeouts — see README "Graceful shutdown".
        for (const controller of activeControllers) controller.abort()
        httpServer.closeIdleConnections()
        const deadline =
          shutdownTimeout > 0
            ? setTimeout(() => httpServer?.closeAllConnections(), shutdownTimeout)
            : undefined
        httpServer.close((err) => {
          clearTimeout(deadline)
          httpServer = null
          if (err) reject(err)
          else resolve()
        })
      }),
  }
}
