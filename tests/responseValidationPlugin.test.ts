import { describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import { responseValidationPlugin } from "../plugins/responseValidationPlugin"
import type { SchemaField } from "../types"

const schema = (parse: SchemaField["parse"]): SchemaField => ({ parse })

describe("responseValidationPlugin", () => {
  it("keeps rejecting strict streaming after the handler catches the first failure", async () => {
    const app = new Orvaxis()
    app.register(responseValidationPlugin())
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/stream",
          responses: { 200: schema((value) => value) },
          handler: (ctx) => {
            try {
              ctx.res.write("first")
            } catch {}
            ctx.res.write("second")
          },
        },
      ],
    })
    const result = await testRequest(app, { path: "/stream" })
    expect(result.status).toBe(500)
    expect(result.chunks).toEqual([])
  })

  it("warns once per status and passes chunks through without buffering", async () => {
    const onViolation = vi.fn()
    const app = new Orvaxis()
    app.register(responseValidationPlugin({ mode: "warn", onViolation }))
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/stream",
          responses: { 200: schema((value) => value) },
          handler: (ctx) => {
            ctx.res.setHeader("content-type", "text/plain").write("first")
            ctx.res.write("second")
            ctx.res.end("last")
          },
        },
      ],
    })
    const result = await testRequest(app, { path: "/stream" })
    expect(result.status).toBe(200)
    expect(result.chunks).toEqual(["first", "second", "last"])
    expect(result.ended).toBe(true)
    expect(onViolation).toHaveBeenCalledExactlyOnceWith({
      method: "GET",
      path: "/stream",
      status: 200,
      kind: "stream-not-validated",
    })
  })

  it("validates send() and ignores failures in the warning callback", async () => {
    const app = new Orvaxis()
    app.register(
      responseValidationPlugin({
        mode: "warn",
        onViolation: () => {
          throw Error("diagnostic failure")
        },
      })
    )
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/item",
          responses: {
            200: schema(() => {
              throw Error("invalid")
            }),
          },
          handler: (ctx) => ctx.res.send({ ok: true }),
        },
      ],
    })
    const result = await testRequest(app, { path: "/item" })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(result.error).toBeUndefined()
  })

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
