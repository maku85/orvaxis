import { bench, describe } from "vitest"
import { createContext } from "../core/Context"
import { createMockResponse } from "../core/mockResponse"
import { PolicyEngine, sortPolicies } from "../core/PolicyEngine"
import type { Policy, PolicyTraceOptions } from "../types"

// Microbenchmarks of the policy engine alone: no routing, no HTTP. Each iteration creates a
// context (identical in every case), so differences between rows come from policy evaluation
// and trace collection. The HTTP scenario lives in http.bench.ts.

const modes: [string, PolicyTraceOptions][] = [
  ["off", { mode: "off" }],
  ["summary", { mode: "summary", maxEvents: 100 }],
  ["detailed", { mode: "detailed", maxEvents: 100, redact: (reason) => reason }],
]
const counts = [1, 5, 20]

function policies(count: number, outcome: "allow" | "deny"): Policy[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `policy-${i}`,
    priority: count - i,
    // With "deny" the lowest-priority policy denies, so every other policy is evaluated first.
    evaluate: () =>
      outcome === "deny" && i === count - 1
        ? { allow: false, reason: "private reason" }
        : { allow: true },
  }))
}

function engineOf(list: Policy[]): PolicyEngine {
  const engine = new PolicyEngine()
  for (const policy of list) engine.register(policy)
  return engine
}

function freshContext() {
  const context = createContext({ path: "/api/users", method: "GET", headers: {} }, createMockResponse())
  context.meta.tracer = { event: () => {} }
  return context
}

for (const outcome of ["allow", "deny"] as const) {
  for (const count of counts) {
    const engine = engineOf(policies(count, outcome))
    describe(`Policy trace — ${outcome}, ${count} policies`, () => {
      for (const [mode, trace] of modes) {
        bench(`trace ${mode}`, async () => {
          await engine
            .evaluate(freshContext(), "preValidation", { layer: "global", trace })
            .catch(() => {})
        })
      }
    })
  }
}

describe("Policy trace — truncation, 20 allow policies, summary mode", () => {
  const engine = engineOf(policies(20, "allow"))
  for (const maxEvents of [1, 5, 100]) {
    bench(`maxEvents ${maxEvents}`, async () => {
      await engine.evaluate(freshContext(), "preValidation", {
        layer: "global",
        trace: { mode: "summary", maxEvents },
      })
    })
  }
})

describe("Policy trace — truncation, 20 policies, terminal denial kept beyond the limit", () => {
  const engine = engineOf(policies(20, "deny"))
  for (const maxEvents of [1, 100]) {
    bench(`maxEvents ${maxEvents}`, async () => {
      await engine
        .evaluate(freshContext(), "preValidation", {
          layer: "global",
          trace: { mode: "summary", maxEvents },
        })
        .catch(() => {})
    })
  }
})

// Measures the priority sort that runs on every evaluation. A cache is only worth considering if
// this is a meaningful share of a request and policy arrays have a defined mutation contract.
describe("Policy ordering — sortPolicies per evaluation", () => {
  for (const count of [1, 5, 20, 100]) {
    const list = policies(count, "allow")
    bench(`${count} policies`, () => {
      sortPolicies(list)
    })
  }
})
