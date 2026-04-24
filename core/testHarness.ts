import type { OrvaxisContext, OrvaxisRequest, OrvaxisResponse } from "../types"
import { createMockResponse } from "./mockResponse"

export type TestRequestInit = {
  path: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
  id?: string
  [key: string]: unknown
}

export type TestResponse = {
  status: number
  body: unknown
  headers: Record<string, string | string[]>
  ctx: OrvaxisContext | undefined
  error: Error | undefined
}

export async function testRequest(
  app: { handle(req: OrvaxisRequest, res: OrvaxisResponse): Promise<OrvaxisContext> },
  init: TestRequestInit
): Promise<TestResponse> {
  const { path, method = "GET", headers = {}, ...rest } = init
  const req: OrvaxisRequest = { path, method, headers, ...rest }
  const res = createMockResponse()

  let ctx: OrvaxisContext | undefined
  let error: Error | undefined

  try {
    ctx = await app.handle(req, res)
  } catch (err) {
    error = err as Error
  }

  const errStatus = (error as (Error & { status?: number }) | undefined)?.status
  return {
    status: errStatus ?? res.statusCode,
    body: res.body,
    headers: res.sentHeaders,
    ctx,
    error,
  }
}
