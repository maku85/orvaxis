import { describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import { responseValidationPlugin } from "../plugins/responseValidationPlugin"
import type { SchemaField } from "../types"

const schema = (parse: SchemaField["parse"]): SchemaField => ({ parse })

describe("responseValidationPlugin", () => {
  it("validates and forwards transformed JSON responses", async () => {
    const app = new Orvaxis()
    app.register(responseValidationPlugin())
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/item",
          responses: { 200: schema((value) => ({ ...(value as object), checked: true })) },
          handler: (ctx) => ctx.res.json({ ok: true }),
        },
      ],
    })
    const response = await testRequest(app, { path: "/item" })
    expect(response.body).toEqual({ ok: true, checked: true })
  })

  it("returns 500 for invalid output in strict mode without sending it", async () => {
    const app = new Orvaxis()
    app.register(responseValidationPlugin())
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/item",
          responses: {
            200: schema(() => {
              throw Error("private detail")
            }),
          },
          handler: (ctx) => ctx.res.json({ secret: true }),
        },
      ],
    })
    const response = await testRequest(app, { path: "/item" })
    expect(response.status).toBe(500)
    expect(response.error?.message).toBe("Response validation failed for status 200")
    expect(response.body).toBeUndefined()
  })

  it("warn mode reports metadata and sends the original response", async () => {
    const onViolation = vi.fn()
    const app = new Orvaxis()
    app.register(responseValidationPlugin({ mode: "warn", onViolation }))
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/item",
          responses: {
            200: schema(() => {
              throw Error("private")
            }),
          },
          handler: (ctx) => ctx.res.json({ ok: true }),
        },
      ],
    })
    const response = await testRequest(app, { path: "/item" })
    expect(response.body).toEqual({ ok: true })
    expect(onViolation).toHaveBeenCalledWith({
      method: "GET",
      path: "/item",
      status: 200,
      kind: "invalid-response",
    })
  })

  it("does not buffer streams and rejects them in strict mode", async () => {
    const app = new Orvaxis()
    app.register(responseValidationPlugin())
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/stream",
          responses: { 200: schema((value) => value) },
          handler: (ctx) => ctx.res.write("chunk"),
        },
      ],
    })
    const response = await testRequest(app, { path: "/stream" })
    expect(response.status).toBe(500)
    expect(response.chunks).toEqual([])
  })

  it("checks the schema for the final status code only", async () => {
    const app = new Orvaxis()
    app.register(responseValidationPlugin())
    app.group({
      prefix: "/",
      routes: [
        {
          method: "POST",
          path: "/item",
          responses: {
            200: schema(() => {
              throw Error()
            }),
            201: schema((value) => value),
          },
          handler: (ctx) => ctx.res.status(201).json({ created: true }),
        },
      ],
    })
    const response = await testRequest(app, { path: "/item", method: "POST" })
    expect(response.status).toBe(201)
    expect(response.body).toEqual({ created: true })
  })
})
