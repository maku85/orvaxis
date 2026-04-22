import type { OrvaxisResponse } from "../types"

export type MockResponse = OrvaxisResponse & {
  body: unknown
  sentHeaders: Record<string, string | string[]>
}

export function createMockResponse(): MockResponse {
  const mock: MockResponse = {
    statusCode: 200,
    body: undefined,
    sentHeaders: {},
    status(code) {
      mock.statusCode = code
      return mock
    },
    json(body) {
      mock.body = body
    },
    send(body) {
      mock.body = body
    },
    setHeader(name, value) {
      mock.sentHeaders[name] = value
      return mock
    },
  }
  return mock
}
