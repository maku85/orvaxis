import type { Readable } from "node:stream"
import type { OrvaxisResponse } from "../types"

export type MockResponse = OrvaxisResponse & {
  body: unknown
  sentHeaders: Record<string, string | string[]>
  chunks: unknown[]
  ended: boolean
  piped: Readable | null
}

export function createMockResponse(): MockResponse {
  const mock: MockResponse = {
    statusCode: 200,
    sent: false,
    body: undefined,
    sentHeaders: {},
    chunks: [],
    ended: false,
    piped: null,
    status(code) {
      mock.statusCode = code
      return mock
    },
    json(body) {
      mock.sent = true
      mock.body = body
    },
    send(body) {
      mock.sent = true
      mock.body = body
    },
    setHeader(name, value) {
      mock.sentHeaders[name] = value
      return mock
    },
    write(chunk) {
      mock.sent = true
      mock.chunks.push(chunk)
    },
    end(chunk?) {
      mock.sent = true
      mock.ended = true
      if (chunk !== undefined) mock.chunks.push(chunk)
    },
    pipe(stream) {
      mock.sent = true
      mock.piped = stream
    },
  }
  return mock
}
