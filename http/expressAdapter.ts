import express, { type Request, type Response } from "express"
import type { Orvaxis } from "../core/Orvaxis"
import type { ServerAdapter } from "../types"

export function createExpressServer(app: Orvaxis): ServerAdapter {
  const server = express()

  server.use(async (req: Request, res: Response, _next: any) => {
    try {
      await app.handle(req, res)
    } catch (err: any) {
      const status = err.status ?? 500
      res.status(status).json({ error: err.message ?? "Internal Server Error" })
    }
  })

  return {
    listen: (port: number) => server.listen(port, () => console.log(`Orvaxis running on ${port}`)),
  }
}
