import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { contractScenarios, createMisconfiguredApps, runContract } from "../examples/contracts"
import { buildExampleApp, buildExampleDocument } from "../examples/openapi-export"
import { Orvaxis } from "../index"
import { generateOpenApiDocument } from "../openapi"
import { testRequest } from "../testing"

// Keeps the contract guides honest: every JSON result printed in them is compared with what the
// runtime produces now, and each rule stated in prose has a check.
const guides = ["typed-validation", "response-contracts", "openapi"].map((name) => ({
  name,
  text: readFileSync(`docs/guide/${name}.md`, "utf8"),
}))

describe("printed results", () => {
  const blocks = guides.flatMap(({ name, text }) =>
    [...text.matchAll(/<!-- contract: (\S+) (\S+) -->\n```json\n([\s\S]*?)\n```/g)].map(
      (match) => ({
        guide: name,
        id: match[1],
        fields: match[2].split(","),
        printed: JSON.parse(match[3]),
      })
    )
  )

  it("covers every scenario that the guides rely on", () => {
    const ids = new Set(blocks.map((block) => block.id))
    for (const id of [
      "invalid-body",
      "over-quota",
      "invalid-never-reaches-policy",
      "valid",
      "lookup-ok",
      "lookup-404",
      "lookup-undeclared",
      "transformed",
      "lookup-invalid-strict",
      "lookup-invalid-warn",
      "stream-strict",
      "stream-warn",
    ]) {
      expect(ids.has(id), id).toBe(true)
    }
  })

  it.each(
    contractScenarios.map((scenario) => scenario.id)
  )("scenario %s matches the runtime", async (id) => {
    const scenario = contractScenarios.find((candidate) => candidate.id === id)
    if (!scenario) throw new Error("unknown scenario")
    const live = JSON.parse(JSON.stringify(await runContract(scenario)))
    for (const block of blocks.filter((candidate) => candidate.id === id)) {
      const expected = Object.fromEntries(
        block.fields
          .filter(
            (field) =>
              live[field] !== undefined && !(Array.isArray(live[field]) && live[field].length === 0)
          )
          .map((field) => [field, live[field]])
      )
      // An empty list (for example `events: []`) may be printed to make the point or left out.
      const withoutEmpty = (value: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(value).filter(([, entry]) => !(Array.isArray(entry) && entry.length === 0))
        )
      expect(withoutEmpty(block.printed), `${block.guide} (${id})`).toEqual(withoutEmpty(expected))
    }
  })

  it("prints the OpenAPI excerpts that the generator produces", () => {
    const document = buildExampleDocument() as unknown as {
      paths: Record<string, Record<string, Record<string, unknown>>>
    }
    const text = guides.find((guide) => guide.name === "openapi")?.text ?? ""
    const excerpts = [
      ...text.matchAll(/<!-- openapi: (\S+) (\S+) (\S+) -->\n```json\n([\s\S]*?)\n```/g),
    ]
    expect(excerpts).toHaveLength(2)
    for (const [, path, method, pointer, printed] of excerpts) {
      const value = pointer
        .split(".")
        .reduce<unknown>(
          (current, key) => (current as Record<string, unknown>)[key],
          document.paths[path][method]
        )
      expect(JSON.parse(printed), pointer).toEqual(value)
    }
    expect(Object.keys(document.paths)).toEqual(["/api/items/{id}", "/api/imports"])
    const put = document.paths["/api/items/{id}"].put as { requestBody: { required: boolean } }
    expect(put.requestBody.required).toBe(false)
  })
})

describe("rules stated in the guides", () => {
  it("rejects misconfigured routes with the documented messages", async () => {
    const { missingPlugin, missingSchema } = createMisconfiguredApps()
    const first = await testRequest(missingPlugin, {
      method: "POST",
      path: "/api/items",
      body: { quantity: 1 },
    })
    expect([first.status, first.error?.message]).toEqual([
      500,
      "Route defined with defineRoute() requires schemaValidationPlugin to validate its typed request fields",
    ])
    const second = await testRequest(missingSchema, {
      method: "POST",
      path: "/api/items",
      body: { quantity: 1 },
    })
    expect([second.status, second.error?.message]).toEqual([
      500,
      'Post-validation policy "needs-body" requires route schema for: body',
    ])
  })

  it("does not validate an ordinary route's schema without the plugin", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      routes: [
        {
          method: "POST",
          path: "/x",
          schema: { body: z.object({ n: z.coerce.number() }) },
          handler: (ctx) => ctx.res.json({ received: ctx.req.body }),
        },
      ],
    })
    const result = await testRequest(app, { method: "POST", path: "/x", body: { n: "oops" } })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ received: { n: "oops" } })
  })

  it("replaces headers with the parsed output", async () => {
    const { schemaValidationPlugin } = await import("../index")
    const app = new Orvaxis()
    app.register(schemaValidationPlugin)
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/x",
          schema: { headers: z.object({ "x-user": z.string() }) },
          handler: (ctx) => ctx.res.json({ headers: ctx.req.headers }),
        },
      ],
    })
    const result = await testRequest(app, {
      path: "/x",
      headers: { "x-user": "alice", "x-other": "dropped" },
    })
    expect(result.body).toEqual({ headers: { "x-user": "alice" } })
  })

  it("reads metadata only when generating OpenAPI", () => {
    const handler = vi.fn()
    const evaluate = vi.fn(() => ({ allow: true as const }))
    const predicate = vi.fn(() => true)
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [
        {
          method: "GET",
          path: "/x",
          policies: [{ name: "p", scope: { path: predicate }, evaluate }],
          handler,
        },
      ],
    })
    generateOpenApiDocument(app, { title: "T", version: "1" })
    expect([handler, evaluate, predicate].map((fn) => fn.mock.calls.length)).toEqual([0, 0, 0])
    expect(buildExampleApp().inspectRoutes().length).toBeGreaterThan(0)
  })
})
