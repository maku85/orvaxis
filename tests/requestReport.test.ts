import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import { buildRequestReport } from "../debug/requestReport"
import type { OrvaxisContext } from "../types"

const SENTINEL = "SENTINEL-private-42"

function app(options: ConstructorParameters<typeof Orvaxis>[0] = {}) {
  const instance = new Orvaxis(options)
  instance.group({
    prefix: "/api/v1",
    routes: [
      {
        method: "GET",
        path: "/items/:id",
        policies: [
          {
            name: "owner",
            evaluate: (ctx) =>
              ctx.req.headers["x-owner"] === "yes"
                ? { allow: true, modify: { leaked: SENTINEL } }
                : { allow: false, reason: `denied for ${SENTINEL}` },
          },
        ],
        handler: (ctx) => {
          ctx.state.secret = SENTINEL
          ctx.meta.secret = SENTINEL
          if (ctx.req.query?.boom) throw new Error(`failure ${SENTINEL}`)
          ctx.res.json({ ok: true })
        },
      },
    ],
  })
  return instance
}

async function run(instance: Orvaxis, init: Parameters<typeof testRequest>[1]) {
  const result = await testRequest(instance, init)
  if (!result.ctx) throw new Error("expected a request context")
  return result.ctx
}

function roundTrip(ctx: OrvaxisContext, options?: Parameters<typeof buildRequestReport>[1]) {
  const report = buildRequestReport(ctx, options)
  const json = JSON.stringify(report)
  expect(JSON.parse(json)).toEqual(report)
  return { report, json }
}

describe("buildRequestReport", () => {
  const base = {
    path: `/api/v1/items/${SENTINEL}`,
    headers: { "x-owner": "yes", authorization: `Bearer ${SENTINEL}` },
    body: { token: SENTINEL },
    id: `req-${SENTINEL}`,
  }

  it("reports a successful request", async () => {
    const { report, json } = roundTrip(await run(app(), base))
    expect(report).toMatchObject({
      schemaVersion: 1,
      method: "GET",
      route: { method: "GET", template: "/api/v1/items/:id" },
      outcome: "completed",
      response: { sent: true, status: 200, statusSource: "sent" },
      handler: "executed",
      terminalDecision: { state: "none" },
      trace: { policyCollection: "summary", truncated: false, recordedDecisions: 1 },
    })
    expect(report.durationMs).toBeGreaterThanOrEqual(0)
    expect(json).not.toContain(SENTINEL)
    expect(report.requestId).toBeUndefined()
  })

  it("reports a denial with the declaration ID and without the reason by default", async () => {
    const ctx = await run(app(), { ...base, headers: {} })
    const { report, json } = roundTrip(ctx)
    expect(report).toMatchObject({
      outcome: "denied",
      response: { sent: false, status: 403, statusSource: "error" },
      handler: "not-executed",
      terminalDecision: {
        state: "recorded",
        kind: "deny",
        policy: "owner",
        policyId: "route:0",
        layer: "route",
        phase: "preValidation",
      },
    })
    expect(json).not.toContain(SENTINEL)
    expect(json).not.toContain("reason")
  })

  it("includes the request ID and the redacted reason only on request", async () => {
    const detailed = app({
      policyTrace: { mode: "detailed", redact: (reason) => reason.replace(SENTINEL, "[redacted]") },
    })
    const ctx = await run(detailed, { ...base, headers: {}, id: "req-1" })
    const { report, json } = roundTrip(ctx, { includeRequestId: true, includeReasons: true })
    expect(report.requestId).toBe("req-1")
    expect(report.terminalDecision).toMatchObject({ reason: "denied for [redacted]" })
    expect(json).not.toContain(SENTINEL)
    expect(JSON.stringify(buildRequestReport(ctx))).not.toContain("denied for")
  })

  it("reports a handler error without its message or stack", async () => {
    const ctx = await run(app(), { ...base, query: { boom: "1" } })
    const { report, json } = roundTrip(ctx)
    expect(report).toMatchObject({
      outcome: "error",
      response: { sent: false, status: null, statusSource: "unknown" },
      handler: "executed",
      terminalDecision: { state: "none" },
    })
    expect(json).not.toContain(SENTINEL)
    expect(json).not.toContain("failure")
  })

  it("keeps the sent status when a later hook fails", async () => {
    const instance = app()
    instance.on("afterHandler", () => {
      throw new Error(`hook ${SENTINEL}`)
    })
    const { report, json } = roundTrip(await run(instance, base))
    expect(report).toMatchObject({
      outcome: "error",
      response: { sent: true, status: 200, statusSource: "sent" },
    })
    expect(json).not.toContain(SENTINEL)
  })

  it("represents truncated traces and disabled collection as such", async () => {
    const limited = new Orvaxis({ policyTrace: { maxEvents: 1 } })
    limited.policy({ name: "a", evaluate: () => ({ allow: true }) })
    limited.policy({ name: "b", evaluate: () => ({ allow: true }) })
    limited.policy({ name: "c", evaluate: () => ({ allow: false }) })
    limited.group({ prefix: "/", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
    const { report } = roundTrip(await run(limited, { path: "/x" }))
    expect(report.trace).toEqual({
      policyCollection: "summary",
      recordedDecisions: 2,
      droppedDecisions: 1,
      truncated: true,
      maxEvents: 1,
    })
    expect(report.terminalDecision).toMatchObject({ state: "recorded", policy: "c" })

    const off = new Orvaxis({ policyTrace: { mode: "off" } })
    off.policy({ name: "b", evaluate: () => ({ allow: false }) })
    off.group({ prefix: "/", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
    const offReport = roundTrip(await run(off, { path: "/x" })).report
    expect(offReport.terminalDecision).toEqual({ state: "unknown", cause: "collection-off" })
    expect(offReport.trace.policyCollection).toBe("off")
    expect(offReport.outcome).toBe("error")
  })

  it("does not invent facts for an unmatched route or an unfinished context", async () => {
    const unmatched = roundTrip(await run(new Orvaxis(), { path: `/${SENTINEL}` }))
    expect(unmatched.report.route).toBeNull()
    expect(unmatched.json).not.toContain(SENTINEL)

    const ctx = await run(app(), base)
    delete ctx.meta.trace
    const partial = buildRequestReport(ctx)
    expect(partial.handler).toBe("unknown")
    expect(partial.outcome).toBe("unknown")
    expect(partial.durationMs).toBeNull()
  })

  it("shows the request method and matched route for HEAD", async () => {
    const { report } = roundTrip(await run(app(), { ...base, method: "HEAD" }))
    expect(report.method).toBe("HEAD")
    expect(report.route?.method).toBe("GET")
  })

  it("bounds and cleans labels", async () => {
    const instance = new Orvaxis()
    instance.policy({ name: `bad\nname${"x".repeat(300)}`, evaluate: () => ({ allow: false }) })
    instance.group({ prefix: "/", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
    const { report } = roundTrip(await run(instance, { path: "/x" }))
    if (report.terminalDecision.state !== "recorded") throw new Error("expected a decision")
    expect(report.terminalDecision.policy).toHaveLength(100)
    expect(report.terminalDecision.policy).not.toContain("\n")
  })
})
