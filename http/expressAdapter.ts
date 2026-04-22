import express, { type Application, type NextFunction, type Request, type Response } from "express"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"

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
  }
  return wrapped
}

export function createExpressServer(app: Orvaxis, server: Application = express()): ServerAdapter {
  server.use(async (req: Request, res: Response, _next: NextFunction) => {
    const adapted = Object.assign(req, {
      path: req.path,
      method: req.method,
      headers: req.headers,
    }) as unknown as OrvaxisRequest
    const wrapped = wrapExpressResponse(res)

    try {
      await app.handle(adapted, wrapped)
    } catch (err) {
      if (!wrapped.sent) {
        const e = err as { status?: number; message?: string }
        wrapped.status(e.status ?? 500).json({ error: e.message ?? "Internal Server Error" })
      }
    }
  })

  let httpServer: ReturnType<typeof server.listen> | null = null

  return {
    listen: (port: number, onListen?: (port: number) => void) =>
      new Promise<void>((resolve, reject) => {
        httpServer = server
          .listen(port)
          .once("listening", () => {
            onListen?.(port)
            resolve()
          })
          .once("error", reject)
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!httpServer) return resolve()
        httpServer.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
