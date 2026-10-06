import { Validator } from "@seriousme/openapi-schema-validator"
import { describe, expect, it } from "vitest"
import { buildExampleDocument } from "../examples/openapi-export"

// biome-ignore lint/suspicious/noExplicitAny: test-only navigation of a generated JSON document
type Loose = Record<string, any>

// The validator is a dev dependency only: the package itself ships no OpenAPI validation.
describe("OpenAPI export example", () => {
  it("produces a document that is valid OpenAPI 3.1", async () => {
    const result = await new Validator().validate(buildExampleDocument() as never)
    expect(result.errors ?? []).toEqual([])
    expect(result.valid).toBe(true)
  })

  it("describes 204 and 304 without bodies, parameters, metadata and media types", () => {
    const { paths } = buildExampleDocument()
    expect(Object.keys(paths).sort()).toEqual(["/api/imports", "/api/items/{id}"])
    const get = paths["/api/items/{id}"].get as Loose
    const put = paths["/api/items/{id}"].put as Loose
    expect(get).toMatchObject({
      operationId: "getItem",
      tags: ["items"],
      summary: "Fetch one item",
    })
    expect(get.parameters).toEqual([
      expect.objectContaining({ name: "id", in: "path", required: true }),
      expect.objectContaining({ name: "verbose", in: "query", required: false }),
    ])
    expect(get.responses["304"]).toEqual({ description: "HTTP 304 response" })
    expect(put.responses["204"]).toEqual({ description: "Replaced without a body" })
    expect(put.requestBody.required).toBe(false)
    expect(Object.keys(paths["/api/imports"].post.requestBody.content)).toEqual(["text/csv"])
  })

  it("does not accept an invalid document as valid", async () => {
    const document = buildExampleDocument() as unknown as { paths: Loose }
    document.paths["/api/items/{id}"].get.parameters[0].required = undefined
    const result = await new Validator().validate(document as never)
    expect(result.valid).toBe(false)
  })
})
