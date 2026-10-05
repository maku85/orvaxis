import { bench, describe } from "vitest"
import { z } from "zod"
import { createContext } from "../core/Context"
import { createMockResponse } from "../core/mockResponse"
import { Orvaxis } from "../core/Orvaxis"
import { schemaValidationPlugin } from "../plugins/schemaValidationPlugin"
import type { Middleware, OrvaxisContext, Policy, PolicyTraceOptions } from "../types"

// ─── shared fixtures ──────────────────────────────────────────────────────────

const req = { path: "/api/hello", method: "GET", headers: {} }
const handler = async (ctx: OrvaxisContext) => ctx.res.json({ ok: true })

const allowAll: Policy = { name: "allow", evaluate: () => ({ allow: true }) }
const passThrough: Middleware = (_ctx, next) => next()
const logHook = (ctx: OrvaxisContext) => {
  ctx.logs.push("hook")
}

function makeApp({
  policies = 0,
  middleware = 0,
  hooks = 0,
  policyTrace,
}: { policies?: number; middleware?: number; hooks?: number; policyTrace?: PolicyTraceOptions }): Orvaxis {
  const app = new Orvaxis({ policyTrace })
  for (let i = 0; i < policies; i++) app.policy({ ...allowAll, name: `policy-${i}` })
  for (let i = 0; i < middleware; i++) app.use(passThrough)
  for (let i = 0; i < hooks; i++) app.on("onRequest", logHook)
  app.group({ prefix: "/api", routes: [{ method: "GET", path: "/hello", handler }] })
  return app
}

// ─── apps ─────────────────────────────────────────────────────────────────────

const appMinimal = makeApp({})
const appTypical = makeApp({ policies: 1, middleware: 3, hooks: 2 })
const appHeavy = makeApp({ policies: 3, middleware: 5, hooks: 5 })
const traceApps = [
  ["off", makeApp({ policies: 5, policyTrace: { mode: "off" } })],
  ["summary", makeApp({ policies: 5, policyTrace: { mode: "summary" } })],
  ["detailed", makeApp({ policies: 5, policyTrace: { mode: "detailed", redact: (reason) => reason } })],
] as const

const bodySchema = z.object({ name: z.string(), age: z.number() })
const appWithSchema = new Orvaxis()
appWithSchema.register(schemaValidationPlugin)
appWithSchema.group({
  prefix: "/api",
  routes: [
    {
      method: "POST",
      path: "/hello",
      schema: { body: bodySchema },
      handler: async (ctx: OrvaxisContext) => ctx.res.json({ ok: true }),
    },
  ],
})
const reqWithBody = { path: "/api/hello", method: "POST", headers: {}, body: { name: "Alice", age: 30 } }

// ─── benchmarks ───────────────────────────────────────────────────────────────

describe("Orvaxis overhead — full pipeline via app.handle()", () => {
  bench("baseline: createContext + direct handler (no Orvaxis)", async () => {
    const ctx = createContext(req, createMockResponse())
    await handler(ctx)
  })

  bench("Orvaxis minimal: routing only (0 policies, 0 middleware, 0 hooks)", async () => {
    await appMinimal.handle(req, createMockResponse())
  })

  bench("Orvaxis typical: 1 policy · 3 middleware · 2 hooks", async () => {
    await appTypical.handle(req, createMockResponse())
  })

  bench("Orvaxis heavy: 3 policies · 5 middleware · 5 hooks", async () => {
    await appHeavy.handle(req, createMockResponse())
  })
})

describe("Orvaxis overhead — schemaValidationPlugin with Zod body schema", () => {
  bench("POST with valid body (parse + coerce)", async () => {
    await appWithSchema.handle(reqWithBody, createMockResponse())
  })
})

describe("Orvaxis overhead — five policies with real trace storage", () => {
  for (const [mode, app] of traceApps) {
    bench(`policy trace: ${mode}`, async () => {
      await app.handle(req, createMockResponse())
    })
  }
})
