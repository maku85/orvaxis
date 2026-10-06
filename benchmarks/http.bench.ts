import express from "express"
import { afterAll, beforeAll, bench, describe } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { createExpressServer } from "../http/expressAdapter"
import type { PolicyTraceOptions } from "../types"

// HTTP scenario: one real request over a loopback socket per iteration (keep-alive), through
// Express and the full Orvaxis runtime with five policies. Socket and event-loop time dominate,
// so compare these rows with each other, never with the microbenchmarks.
const scenarios: [string, PolicyTraceOptions, boolean][] = [
  ["trace off, allow", { mode: "off" }, true],
  ["trace summary, allow", { mode: "summary" }, true],
  ["trace off, deny", { mode: "off" }, false],
  ["trace summary, deny", { mode: "summary" }, false],
]

const servers: { close: () => Promise<void> }[] = []
const urls = new Map<string, string>()

beforeAll(async () => {
  for (const [name, policyTrace, allow] of scenarios) {
    const app = new Orvaxis({ policyTrace })
    for (let i = 0; i < 5; i++) {
      app.policy({
        name: `policy-${i}`,
        evaluate: () => (allow || i < 4 ? { allow: true } : { allow: false, reason: "private" }),
      })
    }
    app.group({
      prefix: "/api",
      routes: [{ method: "GET", path: "/hello", handler: (ctx) => ctx.res.json({ ok: true }) }],
    })
    const adapter = createExpressServer(app, express(), { timeout: 0, logger: { info() {}, error() {} } })
    let port = 0
    await adapter.listen(0, (assigned) => {
      port = assigned
    })
    servers.push(adapter)
    urls.set(name, `http://127.0.0.1:${port}/api/hello`)
  }
})

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()))
})

describe("HTTP scenario — Express adapter, 5 policies, loopback keep-alive", () => {
  for (const [name] of scenarios) {
    bench(name, async () => {
      const response = await fetch(urls.get(name) as string)
      await response.arrayBuffer()
    })
  }
})
