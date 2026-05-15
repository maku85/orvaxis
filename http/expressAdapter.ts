import express, { type Application, type NextFunction, type Request, type Response } from "express"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"
import { type AdapterOptions, sanitizeErrorMessage, withTimeout } from "./timeout"

function wrapExpressResponse(res: Response): OrvaxisResponse {
  const wrapped: OrvaxisResponse = {
    statusCode: 200,
    sent: false,
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
  server.use(async (req: Request, res: Response, _next: NextFunction) => {
    const requestId = (req.headers["x-request-id"] as string) || crypto.randomUUID()
    const controller = new AbortController()
    const adapted = Object.assign(req, {
      path: req.path,
      method: req.method,
      headers: req.headers,
      id: requestId,
      signal: controller.signal,
    }) as unknown as OrvaxisRequest
    const wrapped = wrapExpressResponse(res)
    wrapped.setHeader("X-Request-ID", requestId)

    try {
      const handlePromise = app.handle(adapted, wrapped)
      await (timeoutMs > 0 ? withTimeout(handlePromise, timeoutMs, controller) : handlePromise)
    } catch (err) {
      if (!wrapped.sent) {
        const e = err as { status?: number }
        wrapped.status(e.status ?? 500).json({ error: sanitizeErrorMessage(err) })
      } else {
        logger.error("[orvaxis] unhandled error after response sent:", err)
      }
    }
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
            onListen?.(port)
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
        httpServer.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
