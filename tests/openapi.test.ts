import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { Orvaxis } from "../core/Orvaxis"
import { generateOpenApiDocument } from "../openapi/generateOpenApiDocument"

describe("generateOpenApiDocument", () => {
  it("documents unvalidated path parameters as strings without needing a converter", () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/tenants/:tenantId",
      routes: [{ method: "GET", path: "/items/:id", handler: () => undefined }],
    })
    const doc = generateOpenApiDocument(app, { title: "Demo", version: "1" })
    expect(doc.paths["/tenants/{tenantId}/items/{id}"].get).toMatchObject({
      parameters: [
        { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
    })
  })

  it("generates paths, request parameters, responses, and default errors", () => {
    const app = new Orvaxis()
    const body = { parse: (value: unknown) => value }
    const params = { parse: (value: unknown) => value }
    const output = { parse: (value: unknown) => value }
    app.group({
      prefix: "/api",
      routes: [
        {
          method: "POST",
          path: "/items/:id",
          schema: { body, params },
          responses: { 201: output },
          handler: () => undefined,
        },
      ],
    })
    const schemaConverter = vi.fn((_validator, context) => {
      if (context.field === "params")
        return { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
      return { type: "object", properties: { ok: { type: "boolean" } } }
    })
    const doc = generateOpenApiDocument(app, { title: "Demo", version: "1.0.0", schemaConverter })
    expect(doc.openapi).toBe("3.1.0")
    expect(doc.paths["/api/items/{id}"].post).toMatchObject({
      requestBody: { content: { "application/json": { schema: { type: "object" } } } },
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "201": { content: { "application/json": { schema: { type: "object" } } } },
        default: expect.any(Object),
      },
    })
    expect(doc.components.schemas.ErrorResponse).toBeDefined()
  })

  it("fails explicitly if validators cannot be converted", () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/item",
          responses: { 200: { parse: (value) => value } },
          handler: () => undefined,
        },
      ],
    })
    expect(() => generateOpenApiDocument(app, { title: "Demo", version: "1" })).toThrow(
      /schemaConverter is required/
    )
  })

  it("converts real Zod schemas through the caller-provided adapter", () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [
        {
          method: "GET",
          path: "/items/:id",
          schema: { params: z.object({ id: z.string() }) },
          responses: { 200: z.object({ id: z.string(), name: z.string() }) },
          handler: () => undefined,
        },
      ],
    })
    const document = generateOpenApiDocument(app, {
      title: "Demo",
      version: "1.0.0",
      schemaConverter: (validator) => z.toJSONSchema(validator as z.ZodType),
    })
    const operation = document.paths["/api/items/{id}"].get as {
      parameters: { name: string; schema: Record<string, unknown> }[]
      responses: Record<
        string,
        { content?: { "application/json"?: { schema: Record<string, unknown> } } }
      >
    }
    expect(operation.parameters[0]).toMatchObject({ name: "id", schema: { type: "string" } })
    expect(operation.responses["200"].content?.["application/json"]?.schema).toMatchObject({
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
    })
  })
})
