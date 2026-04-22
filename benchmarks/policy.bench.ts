import { bench, describe } from "vitest"
import { createContext } from "../core/Context"
import { createMockResponse } from "../core/mockResponse"
import { PolicyEngine } from "../core/PolicyEngine"
import type { Policy } from "../types"

const allowAll: Policy = {
  name: "allow-all",
  evaluate: () => ({ allow: true }),
}

const allowWithMeta: Policy = {
  name: "allow-meta",
  evaluate: () => ({ allow: true, modify: { userId: "42", role: "admin" } }),
}

const scopedToPath: Policy = {
  name: "scoped-path",
  scope: { path: "/api/users" },
  evaluate: () => ({ allow: true }),
}

const scopedToRegex: Policy = {
  name: "scoped-regex",
  scope: { path: /^\/api\/users\/\d+$/ },
  evaluate: () => ({ allow: true }),
}

function makeEngine(policies: Policy[]): PolicyEngine {
  const engine = new PolicyEngine()
  for (const p of policies) engine.register(p)
  return engine
}

function makeAllowAllPolicies(n: number): Policy[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `policy-${i}`,
    priority: n - i,
    evaluate: () => ({ allow: true }),
  }))
}

const ctx = createContext({ path: "/api/users", method: "GET", headers: {} }, createMockResponse())
const ctxNoMatch = createContext({ path: "/other", method: "GET", headers: {} }, createMockResponse())

const engine1 = makeEngine([allowAll])
const engine5 = makeEngine(makeAllowAllPolicies(5))
const engine20 = makeEngine(makeAllowAllPolicies(20))
const engineMeta = makeEngine([allowWithMeta])
const engineScoped = makeEngine([scopedToPath])
const engineScopedNoMatch = makeEngine([scopedToPath])
const engineRegex = makeEngine([scopedToRegex])

describe("PolicyEngine — N always-allow policies", () => {
  bench("1 policy", async () => {
    await engine1.evaluate(ctx)
  })

  bench("5 policies (with priority sort)", async () => {
    await engine5.evaluate(ctx)
  })

  bench("20 policies (with priority sort)", async () => {
    await engine20.evaluate(ctx)
  })
})

describe("PolicyEngine — modify/scope overhead", () => {
  bench("allow with meta modification", async () => {
    ctx.meta = {}
    await engineMeta.evaluate(ctx)
  })

  bench("scope: path match (string)", async () => {
    await engineScoped.evaluate(ctx)
  })

  bench("scope: path miss (string)", async () => {
    await engineScopedNoMatch.evaluate(ctxNoMatch)
  })

  bench("scope: path match (regex)", async () => {
    await engineRegex.evaluate(
      createContext({ path: "/api/users/99", method: "GET", headers: {} }, createMockResponse()),
    )
  })
})
