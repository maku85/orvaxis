import { bench, describe } from "vitest"
import { createContext } from "../core/Context"
import { createMockResponse } from "../core/mockResponse"
import type { OrvaxisRequest } from "../types"

const minimalReq: OrvaxisRequest = { path: "/", method: "GET", headers: {} }
const richReq: OrvaxisRequest = {
  path: "/api/v1/users/42",
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    "x-request-id": "req-abc-123",
    "x-forwarded-for": "10.0.0.1",
  },
  id: "req-abc-123",
}

const res = createMockResponse()

describe("createContext", () => {
  bench("minimal request", () => {
    createContext(minimalReq, res)
  })

  bench("request with headers and id", () => {
    createContext(richReq, res)
  })

  bench("including createMockResponse", () => {
    createContext(minimalReq, createMockResponse())
  })
})
