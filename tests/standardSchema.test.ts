import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineRoute } from "../core/defineRoute"
import { Orvaxis } from "../core/Orvaxis"
import { parseSchema, parseSchemaSync } from "../core/schema"
import { testRequest } from "../core/testHarness"
import { generateOpenApiDocument } from "../openapi/generateOpenApiDocument"
import { responseValidationPlugin } from "../plugins/responseValidationPlugin"
import { schemaValidationPlugin } from "../plugins/schemaValidationPlugin"
import type { StandardSchemaV1 } from "../types"

// A validator written against the spec only: no `parse` method, no library.
function standard<T>(
  check: (value: unknown) => { value: T } | { issues: { message: string; path?: unknown[] }[] },
  options: { async?: boolean; jsonSchema?: Record<string, unknown> } = {}
): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => (options.async ? Promise.resolve(check(value)) : check(value)) as never,
      ...(options.jsonSchema
        ? {
            jsonSchema: {
              input: () => ({ $schema: "x", ...options.jsonSchema }),
              output: () => ({ ...options.jsonSchema, "x-output": true }),
            },
          }
        : {}),
    },
  }
}

const positive = standard<number>((v) =>
  typeof v === "number" && v > 0
    ? { value: v }
    : { issues: [{ message: "must be positive", path: [{ key: "amount" }, 0, Symbol.for("s")] }] }
)

function build(schema: Parameters<typeof defineRoute>[0]["schema"]) {
  const app = new Orvaxis()
  app.register(schemaValidationPlugin)
  app.group({
    prefix: "/",
    routes: [
      defineRoute({
        method: "POST",
        path: "/x",
        schema,
        handler: (ctx) => ctx.res.json({ body: ctx.req.body }),
      }),
    ],
  })
  return app
}

describe("Standard Schema request validation", () => {
  it("accepts a validator that only implements ~standard", async () => {
    const app = build({ body: positive })
    const ok = await testRequest(app, { path: "/x", method: "POST", body: 5 })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ body: 5 })
  })

  it("answers 422 with normalized issue paths", async () => {
    const app = build({ body: positive })
    const bad = await testRequest(app, { path: "/x", method: "POST", body: -1 })
    expect(bad.status).toBe(422)
    expect(bad.error).toMatchObject({
      details: [{ message: "must be positive", path: ["amount", 0, "Symbol(s)"] }],
    })
  })

  it("awaits an asynchronous validate", async () => {
    const slow = standard<string>(
      (v) => (typeof v === "string" ? { value: v.toUpperCase() } : { issues: [{ message: "no" }] }),
      { async: true }
    )
    const app = build({ body: slow })
    const res = await testRequest(app, { path: "/x", method: "POST", body: "abc" })
    expect(res.body).toEqual({ body: "ABC" })
    expect((await testRequest(app, { path: "/x", method: "POST", body: 1 })).status).toBe(422)
  })

  it("uses the transformed value from validate", async () => {
    const app = build({ body: standard<number>((v) => ({ value: Number(v) * 2 })) })
    expect((await testRequest(app, { path: "/x", method: "POST", body: "21" })).body).toEqual({
      body: 42,
    })
  })

  it("still accepts a validator with only parse", async () => {
    const parseOnly = {
      parse: (v: unknown) => {
        if (typeof v !== "string") throw new Error("nope")
        return v
      },
    }
    const app = build({ body: parseOnly })
    expect((await testRequest(app, { path: "/x", method: "POST", body: "a" })).status).toBe(200)
    expect((await testRequest(app, { path: "/x", method: "POST", body: 1 })).status).toBe(422)
  })

  it("prefers ~standard over parse when both exist, and works with Zod's async refinements", async () => {
    const calls: string[] = []
    const both = {
      parse: () => {
        calls.push("parse")
        return 1
      },
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: () => {
          calls.push("standard")
          return { value: 2 }
        },
      },
    }
    expect(await parseSchema(both, null)).toBe(2)
    expect(calls).toEqual(["standard"])

    const asyncZod = z.string().refine(async (v) => v.length > 2)
    const app = build({ body: asyncZod })
    expect((await testRequest(app, { path: "/x", method: "POST", body: "abc" })).status).toBe(200)
    expect((await testRequest(app, { path: "/x", method: "POST", body: "a" })).status).toBe(422)
  })

  it("keeps Zod's details shape through ~standard", async () => {
    const app = build({ body: z.object({ n: z.number() }) })
    const bad = await testRequest(app, { path: "/x", method: "POST", body: { n: "x" } })
    expect(bad.status).toBe(422)
    expect(bad.error).toMatchObject({ details: [{ path: ["n"], message: expect.any(String) }] })
  })
})

describe("Standard Schema response validation", () => {
  function responseApp(schema: StandardSchemaV1) {
    const app = new Orvaxis()
    app.register(responseValidationPlugin({ onViolation: () => {} }))
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/r",
          responses: { 200: schema },
          handler: (ctx) => ctx.res.json({ n: "not a number" }),
        },
      ],
    })
    return app
  }

  it("fails a response that does not match, in strict mode", async () => {
    const res = await testRequest(
      responseApp(standard<{ n: number }>((v) => ({ issues: [{ message: "bad" }] }) as never)),
      { path: "/r" }
    )
    expect(res.status).toBe(500)
  })

  it("rejects an asynchronous response schema with a clear error instead of validating nothing", () => {
    const slow = standard<number>(() => ({ value: 1 }), { async: true })
    expect(() => parseSchemaSync(slow, 1)).toThrow(/synchronously/)
  })
})

describe("OpenAPI from Standard JSON Schema", () => {
  const describedApp = (extra: Record<string, unknown> = {}) => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [
        {
          method: "POST",
          path: "/items/:id",
          handler: () => {},
          schema: {
            body: z.object({ name: z.string() }),
            params: z.object({ id: z.string() }),
            query: z.object({ page: z.coerce.number().optional() }),
          },
          responses: { 200: z.object({ id: z.string() }) },
          ...extra,
        },
      ],
    })
    return app
  }

  it("describes Zod 4 validators without a converter", () => {
    const doc = generateOpenApiDocument(describedApp(), { title: "t", version: "1" })
    const op = (doc.paths["/api/items/{id}"] as Record<string, any>).post
    expect(op.requestBody.content["application/json"].schema).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    })
    expect(op.requestBody.content["application/json"].schema).not.toHaveProperty("$schema")
    expect(
      op.parameters.map((p: { name: string; in: string }) => `${p.in}:${p.name}`).sort()
    ).toEqual(["path:id", "query:page"])
    expect(op.responses["200"].content["application/json"].schema).toMatchObject({
      properties: { id: { type: "string" } },
    })
  })

  it("uses the input shape for requests and the output shape for responses", () => {
    const app = new Orvaxis()
    const described = standard<unknown>(() => ({ value: 1 }), { jsonSchema: { type: "object" } })
    app.group({
      prefix: "/",
      routes: [
        {
          method: "POST",
          path: "/s",
          handler: () => {},
          schema: { body: described },
          responses: { 200: described },
        },
      ],
    })
    const op = (
      generateOpenApiDocument(app, { title: "t", version: "1" }).paths["/s"] as Record<string, any>
    ).post
    expect(op.requestBody.content["application/json"].schema).toEqual({ type: "object" })
    expect(op.responses["200"].content["application/json"].schema).toEqual({
      type: "object",
      "x-output": true,
    })
  })

  it("lets an explicit schemaConverter win", () => {
    const doc = generateOpenApiDocument(describedApp(), {
      title: "t",
      version: "1",
      schemaConverter: () => ({
        type: "object",
        properties: { id: { type: "string" }, page: { type: "string" } },
        description: "custom",
      }),
    })
    const op = (doc.paths["/api/items/{id}"] as Record<string, any>).post
    expect(op.requestBody.content["application/json"].schema.description).toBe("custom")
  })

  it("still requires a converter for a validator that cannot describe itself", () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      routes: [
        {
          method: "POST",
          path: "/p",
          handler: () => {},
          schema: { body: { parse: (v: unknown) => v } },
        },
      ],
    })
    expect(() => generateOpenApiDocument(app, { title: "t", version: "1" })).toThrow(
      /schemaConverter is required for body schema on POST \/p/
    )
  })

  it("names the route when a validator cannot be described", () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      routes: [
        {
          method: "POST",
          path: "/t",
          handler: () => {},
          schema: { body: z.object({ d: z.date() }) },
        },
      ],
    })
    expect(() => generateOpenApiDocument(app, { title: "t", version: "1" })).toThrow(
      /body schema on POST \/t cannot be described as JSON Schema.*schemaConverter/
    )
  })
})
