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

  describe("path fidelity", () => {
    const noop = () => undefined
    const appWith = (...routes: { method: "GET" | "POST"; path: string }[]) => {
      const app = new Orvaxis()
      app.group({
        prefix: "/api",
        routes: routes.map((route) => ({ ...route, handler: noop })),
      })
      return app
    }
    const options = { title: "T", version: "1" }

    it("translates parameter names that are not plain identifiers", () => {
      const document = generateOpenApiDocument(
        appWith({ method: "GET", path: "/users/:user-id/files/:file.name" }),
        options
      )
      expect(Object.keys(document.paths)).toEqual(["/api/users/{user-id}/files/{file.name}"])
      const operation = document.paths["/api/users/{user-id}/files/{file.name}"].get as {
        parameters: { name: string }[]
      }
      expect(operation.parameters.map((p) => p.name)).toEqual(["user-id", "file.name"])
    })

    it("rejects wildcards unless the route is explicitly excluded", () => {
      const app = appWith({ method: "GET", path: "/files/*rest" }, { method: "GET", path: "/ok" })
      expect(() => generateOpenApiDocument(app, options)).toThrow(
        /wildcard segment '\*rest' of GET \/api\/files\/\*rest/
      )
      const document = generateOpenApiDocument(app, {
        ...options,
        exclude: (route) => route.path.includes("*"),
      })
      expect(Object.keys(document.paths)).toEqual(["/api/ok"])
    })

    it("rejects syntax OpenAPI cannot express", () => {
      expect(() =>
        generateOpenApiDocument(appWith({ method: "GET", path: "/a/:" }), options)
      ).toThrow(/parameter segment ':'/)
      expect(() =>
        generateOpenApiDocument(appWith({ method: "GET", path: "/a/{id}" }), options)
      ).toThrow(/braces/)
      expect(() =>
        generateOpenApiDocument(appWith({ method: "GET", path: "/a/:id/b/:id" }), options)
      ).toThrow(/appears twice/)
    })

    it("detects templates that differ only in parameter names across methods", () => {
      const app = appWith(
        { method: "GET", path: "/items/:id" },
        { method: "POST", path: "/items/:itemId" }
      )
      expect(() => generateOpenApiDocument(app, options)).toThrow(/differ only in parameter names/)
    })

    it("detects the same operation described twice and never overwrites it", () => {
      const inspected = [
        { method: "GET", path: "/items/:id", prefix: "/", policies: [] },
        { method: "GET", path: "/items/:other", prefix: "/", policies: [] },
      ]
      expect(() =>
        generateOpenApiDocument({ inspectRoutes: () => inspected as never }, options)
      ).toThrow(/collision/)
      const duplicate = [inspected[0], inspected[0]]
      expect(() =>
        generateOpenApiDocument({ inspectRoutes: () => duplicate as never }, options)
      ).toThrow(/describe the same operation/)
    })

    it("fails on an HTTP method it cannot describe instead of dropping the route", () => {
      const inspected = [{ method: "TRACE", path: "/x", prefix: "/", policies: [] }]
      expect(() =>
        generateOpenApiDocument({ inspectRoutes: () => inspected as never }, options)
      ).toThrow(/HTTP method of TRACE \/x/)
    })
  })

  describe("operation metadata", () => {
    const identity = (validator: unknown) => validator as Record<string, unknown>
    const build = (openapi: unknown, extra: Record<string, unknown> = {}) => {
      const app = new Orvaxis()
      app.group({
        prefix: "/api",
        routes: [
          {
            method: "POST",
            path: "/items",
            schema: { body: { type: "object" } as never },
            responses: { 201: { type: "object" } as never, 204: { type: "object" } as never },
            openapi: openapi as never,
            handler: () => undefined,
            ...extra,
          },
        ],
      })
      return generateOpenApiDocument(app, {
        title: "T",
        version: "1",
        schemaConverter: identity as never,
      })
    }

    it("keeps today's output without metadata", () => {
      const operation = build(undefined).paths["/api/items"].post as Record<string, unknown>
      expect(operation).not.toHaveProperty("operationId")
      expect(operation.requestBody).toMatchObject({
        required: true,
        content: { "application/json": {} },
      })
    })

    it("adds identification, an optional body and media types", () => {
      const operation = build({
        operationId: "createItem",
        summary: "Create",
        tags: ["items"],
        deprecated: true,
        body: { required: false, mediaType: "text/csv" },
        responses: { 201: { description: "Created", mediaType: "application/vnd.api+json" } },
      }).paths["/api/items"].post as Record<string, unknown>
      expect(operation).toMatchObject({
        operationId: "createItem",
        summary: "Create",
        tags: ["items"],
        deprecated: true,
      })
      expect(operation.requestBody).toMatchObject({ required: false, content: { "text/csv": {} } })
      expect(operation.responses).toMatchObject({
        201: { description: "Created", content: { "application/vnd.api+json": {} } },
        204: { description: "No content" },
      })
      expect((operation.responses as Record<string, object>)["204"]).not.toHaveProperty("content")
    })

    it("rejects inconsistent metadata", () => {
      expect(() => build({ operationId: "" })).toThrow(/non-empty/)
      expect(() => build({ body: { mediaType: "json" } })).toThrow(/not a valid media type/)
      expect(() => build({ responses: { 404: { description: "x" } } })).toThrow(/status 404/)
      expect(() => build({ responses: { 204: { mediaType: "text/plain" } } })).toThrow(
        /204 responses have no body/
      )
      expect(() => build({ tags: [""] })).toThrow(/tags/)
      expect(() => build({ body: { required: false } }, { schema: undefined })).toThrow(
        /requires a body schema/
      )
    })

    it("rejects an operationId used by two routes", () => {
      const app = new Orvaxis()
      app.group({
        prefix: "/",
        routes: ["/a", "/b"].map((path) => ({
          method: "GET" as const,
          path,
          openapi: { operationId: "same" },
          handler: () => undefined,
        })),
      })
      expect(() => generateOpenApiDocument(app, { title: "T", version: "1" })).toThrow(
        /already used by GET \/a/
      )
    })
  })

  describe("converter references", () => {
    const build = (schema: Record<string, unknown>, componentSchemas?: Record<string, unknown>) => {
      const app = new Orvaxis()
      app.group({
        prefix: "/",
        routes: [
          { method: "POST", path: "/x", schema: { body: {} as never }, handler: () => undefined },
        ],
      })
      return generateOpenApiDocument(app, {
        title: "T",
        version: "1",
        schemaConverter: () => schema,
        ...(componentSchemas ? { componentSchemas } : {}),
      })
    }

    it("accepts component references that are declared and rejects unresolvable ones", () => {
      const document = build({ $ref: "#/components/schemas/User" }, { User: { type: "object" } })
      expect(document.components.schemas).toHaveProperty("User")
      expect(() => build({ $ref: "#/components/schemas/Missing" })).toThrow(/local reference/)
      expect(() => build({ properties: { a: { $ref: "#/$defs/a" } } })).toThrow(
        /Inline it or declare it in componentSchemas/
      )
      expect(() => build({ $ref: "https://example.com/s.json" })).not.toThrow()
    })

    it("protects the built-in error schema", () => {
      expect(() => build({}, { ErrorResponse: {} })).toThrow(/ErrorResponse/)
    })
  })
})
