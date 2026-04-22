import type { OrvaxisResponse } from "../types"

export type MockResponse = OrvaxisResponse & {
  body: unknown
  sentHeaders: Record<string, string | string[]>
}

export function createMockResponse(): MockResponse {
  const mock: MockResponse = {
    statusCode: 200,
    sent: false,
    body: undefined,
    sentHeaders: {},
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
  }
  return mock
}
