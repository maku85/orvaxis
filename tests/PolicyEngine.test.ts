import { describe, expect, it } from "vitest"
import { PolicyEngine } from "../core/PolicyEngine"
import type { OrvaxisContext, Policy } from "../types"

function makeCtx(path = "/api/test", method = "GET"): OrvaxisContext {
  return {
    req: { path, method, headers: {} },
    res: {},
    state: {},
    meta: {},
    logs: [],
  }
}

function makePolicy(overrides: Partial<Policy> & Pick<Policy, "evaluate">): Policy {
  return { name: "test-policy", ...overrides }
}

describe("PolicyEngine", () => {
  it("allows when no policies are registered", async () => {
    const engine = new PolicyEngine()
    await expect(engine.evaluate(makeCtx())).resolves.toBeUndefined()
  })

  it("allows when all policies return allow:true", async () => {
    const engine = new PolicyEngine()
    engine.register(makePolicy({ evaluate: async () => ({ allow: true }) }))
    engine.register(makePolicy({ evaluate: async () => ({ allow: true }) }))

    await expect(engine.evaluate(makeCtx())).resolves.toBeUndefined()
  })

  it("throws when a policy returns allow:false", async () => {
    const engine = new PolicyEngine()
    engine.register(makePolicy({ evaluate: async () => ({ allow: false, reason: "forbidden" }) }))

    await expect(engine.evaluate(makeCtx())).rejects.toThrow("forbidden")
  })

  it("throws with status 403 when a policy denies without a custom status", async () => {
    const engine = new PolicyEngine()
    engine.register(makePolicy({ evaluate: async () => ({ allow: false, reason: "forbidden" }) }))

    const err = await engine.evaluate(makeCtx()).catch((e) => e)
    expect(err.status).toBe(403)
  })

  it("throws with the custom status provided by the policy", async () => {
    const engine = new PolicyEngine()
    engine.register(
      makePolicy({ evaluate: async () => ({ allow: false, reason: "Unauthorized", status: 401 }) })
    )

    const err = await engine.evaluate(makeCtx()).catch((e) => e)
    expect(err.status).toBe(401)
    expect(err.message).toBe("Unauthorized")
  })

  it("uses policy name as fallback error message", async () => {
    const engine = new PolicyEngine()
    engine.register(makePolicy({ name: "auth-policy", evaluate: async () => ({ allow: false }) }))

    await expect(engine.evaluate(makeCtx())).rejects.toThrow("Blocked by auth-policy")
  })

  it("merges modify data into ctx.meta on allow", async () => {
    const engine = new PolicyEngine()
    engine.register(makePolicy({ evaluate: async () => ({ allow: true, modify: { userId: 42 } }) }))

    const ctx = makeCtx()
    await engine.evaluate(ctx)
    expect(ctx.meta.userId).toBe(42)
  })

  it("evaluates policies in priority order (high first)", async () => {
    const order: number[] = []
    const engine = new PolicyEngine()

    engine.register(
      makePolicy({
        name: "low",
        priority: 1,
        evaluate: async () => {
          order.push(1)
          return { allow: true }
        },
      })
    )
    engine.register(
      makePolicy({
        name: "high",
        priority: 10,
        evaluate: async () => {
          order.push(10)
          return { allow: true }
        },
      })
    )

    await engine.evaluate(makeCtx())
    expect(order).toEqual([10, 1])
  })

  it("skips policy when scope method does not match", async () => {
    const engine = new PolicyEngine()
    let called = false

    engine.register(
      makePolicy({
        scope: { method: "POST" },
        evaluate: async () => {
          called = true
          return { allow: false }
        },
      })
    )

    await engine.evaluate(makeCtx("/test", "GET"))
    expect(called).toBe(false)
  })

  it("applies policy when scope method matches", async () => {
    const engine = new PolicyEngine()
    engine.register(
      makePolicy({
        scope: { method: "POST" },
        evaluate: async () => ({ allow: false, reason: "no POST" }),
      })
    )

    await expect(engine.evaluate(makeCtx("/test", "POST"))).rejects.toThrow("no POST")
  })

  it("matches scope path as exact string", async () => {
    const engine = new PolicyEngine()
    let called = false

    engine.register(
      makePolicy({
        scope: { path: "/secure" },
        evaluate: async () => {
          called = true
          return { allow: true }
        },
      })
    )

    await engine.evaluate(makeCtx("/other"))
    expect(called).toBe(false)

    await engine.evaluate(makeCtx("/secure"))
    expect(called).toBe(true)
  })

  it("matches scope path as RegExp", async () => {
    const engine = new PolicyEngine()
    let called = false

    engine.register(
      makePolicy({
        scope: { path: /^\/admin/ },
        evaluate: async () => {
          called = true
          return { allow: true }
        },
      })
    )

    await engine.evaluate(makeCtx("/public"))
    expect(called).toBe(false)

    await engine.evaluate(makeCtx("/admin/dashboard"))
    expect(called).toBe(true)
  })

  it("stops evaluation and throws on first denial", async () => {
    const engine = new PolicyEngine()
    let secondCalled = false

    engine.register(
      makePolicy({
        name: "blocker",
        priority: 10,
        evaluate: async () => ({ allow: false, reason: "blocked" }),
      })
    )
    engine.register(
      makePolicy({
        name: "second",
        priority: 1,
        evaluate: async () => {
          secondCalled = true
          return { allow: true }
        },
      })
    )

    await expect(engine.evaluate(makeCtx())).rejects.toThrow("blocked")
    expect(secondCalled).toBe(false)
  })

  it("accumulates multiple modify patches from successive policies", async () => {
    const engine = new PolicyEngine()
    engine.register(makePolicy({ evaluate: async () => ({ allow: true, modify: { a: 1 } }) }))
    engine.register(makePolicy({ evaluate: async () => ({ allow: true, modify: { b: 2 } }) }))

    const ctx = makeCtx()
    await engine.evaluate(ctx)
    expect(ctx.meta.a).toBe(1)
    expect(ctx.meta.b).toBe(2)
  })

  it("ignores __proto__ keys in policy modify to prevent prototype pollution", async () => {
    const engine = new PolicyEngine()
    const malicious = JSON.parse('{"__proto__": {"polluted": true}}')

    engine.register(makePolicy({ evaluate: async () => ({ allow: true, modify: malicious }) }))

    const ctx = makeCtx()
    await engine.evaluate(ctx)

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(ctx.meta, "__proto__")).toBe(false)
  })
})
