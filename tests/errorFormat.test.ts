import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { defineRoute } from "../core/defineRoute"
import { HttpError } from "../core/HttpError"
import { Orvaxis } from "../core/Orvaxis"
import { type ErrorOptions, renderError } from "../http/errors"
import { createExpressServer } from "../http/expressAdapter"
import { createFastifyServer } from "../http/fastifyAdapter"
import { createNodeServer } from "../http/nodeAdapter"
import { generateOpenApiDocument } from "../openapi/generateOpenApiDocument"
import { schemaValidationPlugin } from "../plugins/schemaValidationPlugin"
import type { ServerAdapter } from "../types"

class OutOfStock extends Error {}

function makeApp() {
  const app = new Orvaxis()
  app.register(schemaValidationPlugin)
  app.group({
    prefix: "/api",
    routes: [
      {
        method: "GET",
        path: "/teapot",
        handler: () => {
          throw new HttpError(418, "I'm a teapot", { code: "TEAPOT" })
        },
      },
      {
        method: "GET",
        path: "/boom",
        handler: () => {
          throw Object.assign(new Error("db password=hunter2"), { code: "ER_X" })
        },
      },
      {
        method: "GET",
        path: "/stock",
        handler: () => {
          throw new OutOfStock("sku 42 is out of stock")
        },
      },
      defineRoute({
        method: "POST",
        path: "/items",
        schema: { body: z.object({ qty: z.number() }) },
        handler: (ctx) => ctx.res.json(ctx.req.body),
      }),
    ],
  })
  return app
}

type Make = (app: Orvaxis, options: ErrorOptions) => ServerAdapter
const makers: [string, Make][] = [
  ["node", (app, o) => createNodeServer(app, { timeout: 0, ...o })],
  ["express", (app, o) => createExpressServer(app, undefined, { timeout: 0, ...o })],
  ["fastify", (app, o) => createFastifyServer(app, Fastify(), { timeout: 0, ...o })],
]

describe.each(makers)("error formats on the %s adapter", (_name, make) => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function run<T>(options: ErrorOptions, fn: (base: string) => Promise<T>) {
    const adapter = make(makeApp(), options)
    let port = 0
    await adapter.listen(0, (p) => {
      port = p
    })
    try {
      return await fn(`http://127.0.0.1:${port}`)
    } finally {
      await adapter.close()
    }
  }

  it("keeps the envelope and application/json by default", async () => {
    await run({}, async (base) => {
      const res = await fetch(`${base}/api/teapot`)
      expect(res.headers.get("content-type")).toContain("application/json")
      expect(await res.json()).toEqual({
        error: "I'm a teapot",
        code: "TEAPOT",
        requestId: expect.any(String),
      })
    })
  })

  it("writes RFC 9457 Problem Details with errorFormat: problem", async () => {
    await run({ errorFormat: "problem" }, async (base) => {
      const res = await fetch(`${base}/api/teapot`)
      expect(res.status).toBe(418)
      expect(res.headers.get("content-type")).toContain("application/problem+json")
      expect(await res.json()).toEqual({
        type: "about:blank",
        title: "I'm a Teapot",
        status: 418,
        detail: "I'm a teapot",
        code: "TEAPOT",
        requestId: expect.any(String),
      })
    })
  })

  it("builds the problem type from a code and problemTypeBase", async () => {
    await run(
      { errorFormat: "problem", problemTypeBase: "https://api.example.com/problems/" },
      async (base) => {
        const body = await (await fetch(`${base}/api/teapot`)).json()
        expect(body.type).toBe("https://api.example.com/problems/TEAPOT")
      }
    )
  })

  it("leaves detail out when it would repeat the title, and still hides plain errors in production", async () => {
    // Messages of plain errors are hidden only in production, as with the envelope.
    vi.stubEnv("NODE_ENV", "production")
    await run({ errorFormat: "problem" }, async (base) => {
      const res = await fetch(`${base}/api/missing`)
      const body = await res.json()
      expect(res.status).toBe(404)
      expect(body).toMatchObject({ type: "about:blank", title: "Not Found", status: 404 })
      const boom = await (await fetch(`${base}/api/boom`)).json()
      expect(JSON.stringify(boom)).not.toContain("hunter2")
      expect(boom).not.toHaveProperty("code")
      expect(boom.status).toBe(500)
      expect(boom).not.toHaveProperty("detail")
    })
  })

  it("carries validation issues as details", async () => {
    await run({ errorFormat: "problem" }, async (base) => {
      const res = await fetch(`${base}/api/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"qty":"x"}',
      })
      const body = await res.json()
      expect(res.status).toBe(422)
      expect(body.details).toEqual([{ path: ["qty"], message: expect.any(String) }])
    })
  })

  it("lets mapError turn a domain error into a controlled response", async () => {
    const seen: unknown[] = []
    await run(
      {
        errorFormat: "problem",
        mapError: (err, info) => {
          seen.push(info.path)
          if (err instanceof OutOfStock) {
            return {
              status: 409,
              message: "Not enough stock",
              code: "OUT_OF_STOCK",
              type: "https://api.example.com/problems/out-of-stock",
              title: "Out of stock",
              headers: { "Retry-After": "60" },
              extensions: { sku: 42, status: 200, title: "hijack" },
            }
          }
        },
      },
      async (base) => {
        const res = await fetch(`${base}/api/stock`)
        expect(res.status).toBe(409)
        expect(res.headers.get("retry-after")).toBe("60")
        expect(await res.json()).toEqual({
          type: "https://api.example.com/problems/out-of-stock",
          title: "Out of stock",
          status: 409,
          detail: "Not enough stock",
          code: "OUT_OF_STOCK",
          requestId: expect.any(String),
          sku: 42,
        })
        // Errors it does not recognise keep the default handling.
        expect((await fetch(`${base}/api/teapot`)).status).toBe(418)
        expect(seen).toContain("/api/stock")
      }
    )
  })

  it("applies mapError to the envelope too, and survives a mapper that throws", async () => {
    const logger = { info: vi.fn(), error: vi.fn() }
    await run(
      {
        logger,
        mapError: (err) => {
          if (err instanceof OutOfStock) return { status: 409, message: "Not enough stock" }
          throw new Error("mapper bug")
        },
      },
      async (base) => {
        const stock = await fetch(`${base}/api/stock`)
        expect(stock.status).toBe(409)
        expect(await stock.json()).toMatchObject({ error: "Not enough stock" })
        const teapot = await fetch(`${base}/api/teapot`)
        expect(teapot.status).toBe(418)
        expect(logger.error).toHaveBeenCalled()
      }
    )
  })
})

describe("renderError", () => {
  it("ignores an invalid mapped status and the reserved extension keys", () => {
    const rendered = renderError(new HttpError(400, "bad"), "r1", {
      mapError: () => ({ status: 200, extensions: { requestId: "x", error: "y", extra: 1 } }),
    })
    expect(rendered.status).toBe(400)
    expect(rendered.body).toEqual({ error: "bad", requestId: "r1", extra: 1 })
  })

  it("passes the default status, the request id and the origin of the error to the mapper", () => {
    const mapError = vi.fn(() => undefined)
    renderError(
      Object.assign(new Error("x"), { status: 404 }),
      "r2",
      { mapError },
      { frameworkError: true, method: "GET", path: "/p" }
    )
    expect(mapError).toHaveBeenCalledWith(expect.any(Error), {
      requestId: "r2",
      status: 404,
      frameworkError: true,
      method: "GET",
      path: "/p",
    })
  })
})

// Walks a generated document without `any`.
function at(value: unknown, ...path: string[]): Record<string, Record<string, unknown>> {
  return path.reduce((node, key) => (node as Record<string, unknown>)[key], value) as Record<
    string,
    Record<string, unknown>
  >
}

describe("OpenAPI error format", () => {
  const app = () => {
    const a = new Orvaxis()
    a.group({ prefix: "/", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
    return a
  }

  it("documents ProblemDetails as application/problem+json", () => {
    const doc = generateOpenApiDocument(app(), { title: "t", version: "1", errorFormat: "problem" })
    const response = at(doc.paths["/x"], "get", "responses", "default")
    expect(response.content["application/problem+json"]?.schema).toEqual({
      $ref: "#/components/schemas/ProblemDetails",
    })
    expect(doc.components.schemas.ProblemDetails).toBeDefined()
    expect(doc.components.schemas).not.toHaveProperty("ErrorResponse")
    expect(() =>
      generateOpenApiDocument(app(), {
        title: "t",
        version: "1",
        errorFormat: "problem",
        componentSchemas: { ProblemDetails: {} },
      })
    ).toThrow(/ProblemDetails/)
  })

  it("keeps ErrorResponse by default", () => {
    const doc = generateOpenApiDocument(app(), { title: "t", version: "1" })
    expect(doc.components.schemas.ErrorResponse).toBeDefined()
  })
})
