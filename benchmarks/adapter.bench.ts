import { bench, describe } from "vitest"
import { createContext } from "../core/Context"
import { createMockResponse } from "../core/mockResponse"
import { Orvaxis } from "../core/Orvaxis"
import type { Middleware, OrvaxisContext, Policy } from "../types"

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
}: { policies?: number; middleware?: number; hooks?: number }): Orvaxis {
  const app = new Orvaxis()
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
