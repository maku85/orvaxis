import express, { type Application, type NextFunction, type Request, type Response } from "express"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"

function wrapExpressResponse(res: Response): OrvaxisResponse {
  const wrapped: OrvaxisResponse = {
    statusCode: 200,
    status(code) {
      wrapped.statusCode = code
      res.status(code)
      return wrapped
    },
    json(body) {
      res.json(body)
    },
    send(body) {
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
      const e = err as { status?: number; message?: string }
      wrapped.status(e.status ?? 500).json({ error: e.message ?? "Internal Server Error" })
    }
  })

  return {
    listen: (port: number) =>
      new Promise<void>((resolve, reject) => {
        server
          .listen(port)
          .once("listening", () => {
            console.log(`Orvaxis running on ${port}`)
            resolve()
          })
          .once("error", reject)
      }),
  }
}
