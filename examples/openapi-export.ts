import { z } from "zod"
import { Orvaxis } from "../core/Orvaxis"
import { generateOpenApiDocument } from "../openapi"

// Builds an OpenAPI 3.1 document from route declarations only: no handler or policy runs.
// Zod is this example's validator; any validator works with a matching schemaConverter.
const noop = () => undefined

export function buildExampleApp() {
  const app = new Orvaxis()
  app.group({
    prefix: "/api",
    routes: [
      {
        method: "GET",
        path: "/items/:id",
        schema: {
          params: z.object({ id: z.string() }),
          query: z.object({ verbose: z.string().optional() }),
        },
        responses: {
          200: z.object({ id: z.string(), owner: z.looseObject({}).optional() }),
          304: z.object({}),
        },
        openapi: { operationId: "getItem", summary: "Fetch one item", tags: ["items"] },
        handler: noop,
      },
      {
        method: "PUT",
        path: "/items/:id",
        schema: { params: z.object({ id: z.string() }), body: z.object({ name: z.string() }) },
        responses: { 200: z.object({ id: z.string() }), 204: z.object({}) },
        openapi: {
          operationId: "replaceItem",
          tags: ["items"],
          body: { required: false },
          responses: { 204: { description: "Replaced without a body" } },
        },
        handler: noop,
      },
      {
        method: "POST",
        path: "/imports",
        schema: { body: z.string() },
        responses: { 202: z.object({ jobId: z.string() }) },
        openapi: { operationId: "startImport", body: { mediaType: "text/csv" } },
        handler: noop,
      },
      // A wildcard has no OpenAPI path template; it is excluded explicitly below.
      { method: "GET", path: "/files/*path", handler: noop },
    ],
  })
  return app
}

export function buildExampleDocument() {
  return generateOpenApiDocument(buildExampleApp(), {
    title: "Items API",
    version: "1.0.0",
    schemaConverter: (validator) => z.toJSONSchema(validator as z.ZodType),
    exclude: (route) => route.path.includes("/*"),
  })
}

if (process.argv[1]?.endsWith("openapi-export.ts")) {
  console.log(JSON.stringify(buildExampleDocument(), null, 2))
}
