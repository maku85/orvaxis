import { EventEmitter } from "node:events"
import type { Request, Response } from "express"
import { describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { createExpressPolicyGuard } from "../http/expressAdapter"

function expressRequest(path: string, method = "GET", headers: Record<string, string> = {}) {
  return Object.assign(new EventEmitter(), {
    path,
    method,
    baseUrl: "",
    headers,
    query: {},
    body: undefined,
    params: {},
    url: path,
  }) as unknown as Request
}

function expressResponse() {
  const emitter = new EventEmitter()
  const response = Object.assign(emitter, {
    writableFinished: false,
    headersSent: false,
    locals: {} as Record<string, unknown>,
    statusCode: 200,
    set: vi.fn().mockReturnThis(),
    status: vi.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code
      return this
    }),
    json: vi.fn(function (this: { headersSent: boolean }) {
      this.headersSent = true
      return this
    }),
    send: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  })
  return response as unknown as Response & typeof response
}

function makePolicyApp() {
  const app = new Orvaxis()
  app.group({
    prefix: "/api",
    routes: [
      {
        method: "GET",
        path: "/documents/:id",
        policies: [
          {
            name: "document-owner",
            evaluate: (ctx) =>
              ctx.req.headers["x-owner"] === ctx.params.id
                ? { allow: true, modify: { accessChecked: true } }
                : { allow: false, reason: "Document access denied" },
          },
        ],
        handler: () => {},
      },
    ],
  })
  return app
}

describe("createExpressPolicyGuard", () => {
  it("continues to the existing Express handler after policy approval", async () => {
    const req = expressRequest("/api/documents/42", "GET", { "x-owner": "42" })
    const res = expressResponse()
    const next = vi.fn()
    const existingHandler = vi.fn()

    createExpressPolicyGuard(makePolicyApp())(req, res, next)
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce())
    existingHandler(req, res, next)

    expect(existingHandler).toHaveBeenCalledOnce()
    expect(res.locals.orvaxis).toMatchObject({
      meta: { route: { params: { id: "42" } } },
    })
    expect((res.locals.orvaxis as { meta: Record<string, unknown> }).meta.accessChecked).toBe(true)
    expect(res.set).toHaveBeenCalledWith("X-Request-ID", expect.any(String))
  })

  it("returns a policy denial without calling the existing handler", async () => {
    const req = expressRequest("/api/documents/42", "GET", { "x-owner": "other" })
    const res = expressResponse()
    const next = vi.fn()

    createExpressPolicyGuard(makePolicyApp())(req, res, next)
    await vi.waitFor(() => expect(res.json).toHaveBeenCalledOnce())

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Document access denied" })
    )
    expect(next).not.toHaveBeenCalled()
  })

  it("rejects post-validation policies instead of silently skipping them", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [
        {
          method: "GET",
          path: "/documents/:id",
          policies: [
            {
              name: "after-schema",
              phase: "postValidation",
              requires: ["params"],
              evaluate: () => ({ allow: true }),
            },
          ],
          handler: () => {},
        },
      ],
    })
    const req = expressRequest("/api/documents/42")
    const res = expressResponse()
    const next = vi.fn()

    createExpressPolicyGuard(app)(req, res, next)
    await vi.waitFor(() => expect(res.json).toHaveBeenCalledOnce())

    expect(res.status).toHaveBeenCalledWith(500)
    expect(next).not.toHaveBeenCalled()
  })
})
