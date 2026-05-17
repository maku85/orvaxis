import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineRoute } from "../core/defineRoute"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import { schemaValidationPlugin } from "../plugins/schemaValidationPlugin"

const BodySchema = z.object({ name: z.string(), age: z.number() })

describe("defineRoute", () => {
  it("returns a Route object with the same method, path, schema, and handler", () => {
    const handler = async () => {}
    const route = defineRoute({
      method: "POST",
      path: "/users",
      schema: { body: BodySchema },
      handler,
    })

    expect(route.method).toBe("POST")
    expect(route.path).toBe("/users")
    expect(route.schema?.body).toBe(BodySchema)
    expect(route.handler).toBe(handler)
  })

  it("provides a typed body inside the handler after schema validation", async () => {
    const app = new Orvaxis()
    app.register(schemaValidationPlugin)

    let capturedName: string | undefined

    app.group({
      prefix: "/",
      routes: [
        defineRoute({
          method: "POST",
          path: "/users",
          schema: { body: BodySchema },
          handler: async (ctx) => {
            capturedName = ctx.req.body.name
            ctx.res.status(201).json({ ok: true })
          },
        }),
      ],
    })

    const res = await testRequest(app, {
      method: "POST",
      path: "/users",
      body: { name: "Alice", age: 30 },
    })

    expect(res.status).toBe(201)
    expect(capturedName).toBe("Alice")
  })

  it("rejects invalid bodies with status 422", async () => {
    const app = new Orvaxis()
    app.register(schemaValidationPlugin)

    app.group({
      prefix: "/",
      routes: [
        defineRoute({
          method: "POST",
          path: "/users",
          schema: { body: BodySchema },
          handler: async (ctx) => ctx.res.json({ ok: true }),
        }),
      ],
    })

    const res = await testRequest(app, {
      method: "POST",
      path: "/users",
      body: { name: 42 },
    })

    expect(res.status).toBe(422)
  })

  it("threads TState through to the handler so ctx.state is typed", async () => {
    type AuthState = { userId: string }
    const app = new Orvaxis()
    app.register(schemaValidationPlugin)

    let capturedUserId: string | undefined

    app.group({
      prefix: "/",
      middleware: [
        async (ctx, next) => {
          ;(ctx.state as AuthState).userId = "u-42"
          await next()
        },
      ],
      routes: [
        defineRoute<z.infer<typeof BodySchema>, AuthState>({
          method: "POST",
          path: "/items",
          schema: { body: BodySchema },
          handler: async (ctx) => {
            capturedUserId = ctx.state.userId
            ctx.res.json({ name: ctx.req.body.name })
          },
        }),
      ],
    })

    const res = await testRequest(app, {
      method: "POST",
      path: "/items",
      body: { name: "Widget", age: 1 },
    })

    expect(res.status).toBe(200)
    expect(capturedUserId).toBe("u-42")
  })
})
