import express, { type NextFunction, type Request, type Response } from "express"
import type { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types"

export function createExpressServer(app: Orvaxis): ServerAdapter {
  const server = express()

  server.use(async (req: Request, res: Response, _next: NextFunction) => {
    const adapted = Object.assign(req, {
      path: req.path,
      method: req.method,
      headers: req.headers,
    }) as unknown as OrvaxisRequest

    try {
      await app.handle(adapted, res as unknown as OrvaxisResponse)
    } catch (err) {
      const e = err as { status?: number; message?: string }
      const status = e.status ?? 500
      res.status(status).json({ error: e.message ?? "Internal Server Error" })
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
