import { type Span, SpanStatusCode, type Tracer } from "@opentelemetry/api"
import { describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import { buildExecutionSummary } from "../debug/buildExecutionSummary"
import { formatExecutionSummary } from "../debug/formatExecutionSummary"
import { otelPlugin } from "../plugins/otelPlugin"

function appWithPolicies(options: ConstructorParameters<typeof Orvaxis>[0] = {}) {
  const app = new Orvaxis(options)
  app.group({
    prefix: "/api",
    policies: [{ name: "group-check", evaluate: () => ({ allow: true }) }],
    routes: [
      {
        method: "GET",
        path: "/resource",
        policies: [
          { name: "route-deny", evaluate: () => ({ allow: false, reason: "private user 42" }) },
        ],
        handler: (ctx) => ctx.res.json({ ok: true }),
      },
    ],
  })
  return app
}

describe("policy decision tracing", () => {
  it("omits the original reason if the detailed trace redactor throws", async () => {
    const app = appWithPolicies({
      policyTrace: {
        mode: "detailed",
        redact: () => {
          throw new Error("Redaction failed")
        },
      },
    })
    const result = await testRequest(app, { path: "/api/resource" })
    expect(result.status).toBe(403)
    expect(result.error?.message).toBe("private user 42")
    const decision = result.ctx?.meta.trace?.events.find((event) => event.meta?.outcome === "deny")
    expect(decision?.meta?.reason).toBeUndefined()
    expect(JSON.stringify(result.ctx?.meta.trace)).not.toContain("private user 42")
  })

  it("records scope skips and ordered decisions by global, group, and route layer", async () => {
    const app = appWithPolicies()
    app.policy({
      name: "admin-only",
      scope: { path: "/admin" },
      evaluate: vi.fn(() => ({ allow: true })),
    })
    app.policy({ name: "authenticate", evaluate: () => ({ allow: true }) })

    const result = await testRequest(app, { path: "/api/resource" })
    const decisions = result.ctx?.meta.trace?.events
      .filter((event) => event.type === "POLICY_DECISION")
      .map((event) => event.meta)

    expect(decisions).toEqual([
      expect.objectContaining({
        policy: "admin-only",
        layer: "global",
        order: 1,
        outcome: "skipped",
      }),
      expect.objectContaining({
        policy: "authenticate",
        layer: "global",
        order: 2,
        outcome: "allow",
      }),
      expect.objectContaining({
        policy: "group-check",
        layer: "group",
        order: 1,
        outcome: "allow",
      }),
      expect.objectContaining({
        policy: "route-deny",
        layer: "route",
        order: 1,
        outcome: "deny",
        terminal: true,
      }),
    ])
    expect(decisions?.every((event) => typeof event?.durationMs === "number")).toBe(true)

    if (!result.ctx) throw new Error("expected the request context to be captured")
    const summary = buildExecutionSummary(result.ctx)
    expect(summary.stoppedByPolicy?.meta?.policy).toBe("route-deny")
    expect(summary.notReachedStages).toContain("beforePipeline")
    expect(JSON.stringify(result.ctx.meta.trace)).not.toContain("private user 42")
  })

  it("records policy exceptions without capturing error messages and preserves the error", async () => {
    const failure = new Error("secret token abc")
    const app = new Orvaxis()
    app.policy({
      name: "unstable-check",
      evaluate: () => {
        throw failure
      },
    })
    app.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler: () => {} }] })

    const result = await testRequest(app, { path: "/api/x" })
    const decision = result.ctx?.meta.trace?.events.find(
      (event) => event.type === "POLICY_DECISION"
    )

    expect(result.error).toBe(failure)
    expect(decision?.meta).toMatchObject({
      policy: "unstable-check",
      outcome: "error",
      terminal: true,
      errorName: "Error",
    })
    expect(JSON.stringify(result.ctx?.meta.trace)).not.toContain("secret token abc")
  })

  it("records scope predicate errors without retrying the predicate", async () => {
    const failure = new Error("scope leaked value")
    const predicate = vi.fn(() => {
      throw failure
    })
    const app = new Orvaxis()
    app.policy({
      name: "dynamic-scope",
      scope: { path: predicate },
      evaluate: vi.fn(() => ({ allow: true })),
    })
    app.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler: () => {} }] })

    const result = await testRequest(app, { path: "/api/x" })
    const decision = result.ctx?.meta.trace?.events.find(
      (event) => event.type === "POLICY_DECISION"
    )

    expect(result.error).toBe(failure)
    expect(predicate).toHaveBeenCalledOnce()
    expect(decision?.meta).toMatchObject({ outcome: "error", errorName: "Error", terminal: true })
    expect(JSON.stringify(result.ctx?.meta.trace)).not.toContain("scope leaked value")
  })

  it("requires and applies a redactor before recording detailed denial reasons", async () => {
    const app = appWithPolicies({
      policyTrace: {
        mode: "detailed",
        redact: (reason) => reason.replace(/user 42/, "user [redacted]"),
      },
    })
    const result = await testRequest(app, { path: "/api/resource" })
    const denied = result.ctx?.meta.trace?.events.find(
      (event) => event.type === "POLICY_DECISION" && event.meta?.outcome === "deny"
    )

    expect(denied?.meta?.reason).toBe("private user [redacted]")
    expect(denied?.meta?.scope).toBeUndefined()
    expect(JSON.stringify(result.ctx?.meta.trace)).not.toContain("private user 42")
  })

  it("includes static scope descriptions only in detailed mode", async () => {
    const app = new Orvaxis({ policyTrace: { mode: "detailed", redact: (reason) => reason } })
    app.policy({
      name: "api-access",
      scope: { path: "/api", method: "GET" },
      evaluate: () => ({ allow: true }),
    })
    app.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler: () => {} }] })

    const result = await testRequest(app, { path: "/api/x" })
    const decision = result.ctx?.meta.trace?.events.find(
      (event) => event.type === "POLICY_DECISION"
    )
    expect(decision?.meta?.scope).toEqual({ path: "/api", method: "GET" })
  })

  it("can disable policy decisions or cap them with a truncation marker", async () => {
    const disabled = new Orvaxis({ policyTrace: { mode: "off" } })
    disabled.policy({ name: "open", evaluate: () => ({ allow: true }) })
    disabled.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
    const noTrace = await testRequest(disabled, { path: "/api/x" })
    expect(noTrace.ctx?.meta.trace?.events.some((event) => event.type === "POLICY_DECISION")).toBe(
      false
    )

    const bounded = new Orvaxis({ policyTrace: { mode: "summary", maxEvents: 1 } })
    bounded.policy({ name: "first", evaluate: () => ({ allow: true }) })
    bounded.policy({ name: "second", evaluate: () => ({ allow: true }) })
    bounded.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
    const capped = await testRequest(bounded, { path: "/api/x" })
    expect(
      capped.ctx?.meta.trace?.events.filter((event) => event.type === "POLICY_DECISION")
    ).toHaveLength(1)
    expect(
      capped.ctx?.meta.trace?.events.some((event) => event.type === "POLICY_TRACE_LIMIT")
    ).toBe(true)
  })

  it("keeps the terminal decision when the trace limit is exceeded", async () => {
    const build = (last: () => { allow: boolean } | never) => {
      const app = new Orvaxis({ policyTrace: { mode: "summary", maxEvents: 1 } })
      app.policy({ name: "first", priority: 3, evaluate: () => ({ allow: true }) })
      app.policy({
        name: "scoped-out",
        priority: 2,
        scope: { method: "POST" },
        evaluate: () => ({ allow: true }),
      })
      app.policy({ name: "last", priority: 1, evaluate: last })
      app.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
      return app
    }

    const denied = await testRequest(
      build(() => ({ allow: false })),
      { path: "/api/x" }
    )
    if (!denied.ctx) throw new Error("expected a request context")
    const deniedSummary = buildExecutionSummary(denied.ctx)
    expect(deniedSummary.stoppedByPolicy?.meta).toMatchObject({
      policy: "last",
      layer: "global",
      phase: "preValidation",
      outcome: "deny",
      terminal: true,
    })
    expect(deniedSummary.policyDecisions).toHaveLength(2)
    expect(deniedSummary.policyTrace).toEqual({
      truncated: true,
      droppedDecisions: 1,
      maxEvents: 1,
    })
    expect(formatExecutionSummary(denied.ctx)).toContain("Trace truncated: 1 decision(s)")
    expect(formatExecutionSummary(denied.ctx)).toContain("Stopped by: last")

    const failed = await testRequest(
      build(() => {
        throw new Error("private")
      }),
      { path: "/api/x" }
    )
    if (!failed.ctx) throw new Error("expected a request context")
    const failedSummary = buildExecutionSummary(failed.ctx)
    expect(failedSummary.stoppedByPolicy?.meta).toMatchObject({ policy: "last", outcome: "error" })
    expect(failedSummary.policyTrace.truncated).toBe(true)
  })

  it("does not report truncation or collect decisions when nothing is dropped or tracing is off", async () => {
    const app = new Orvaxis({ policyTrace: { mode: "summary", maxEvents: 2 } })
    app.policy({ name: "a", evaluate: () => ({ allow: true }) })
    app.policy({ name: "b", evaluate: () => ({ allow: false }) })
    app.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
    const result = await testRequest(app, { path: "/api/x" })
    if (!result.ctx) throw new Error("expected a request context")
    expect(buildExecutionSummary(result.ctx).policyTrace.truncated).toBe(false)

    const off = new Orvaxis({ policyTrace: { mode: "off" } })
    off.policy({ name: "b", evaluate: () => ({ allow: false }) })
    off.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
    const offResult = await testRequest(off, { path: "/api/x" })
    if (!offResult.ctx) throw new Error("expected a request context")
    expect(buildExecutionSummary(offResult.ctx).policyDecisions).toHaveLength(0)
  })

  it("forwards policy decision events to the request OpenTelemetry span", async () => {
    const addEvent = vi.fn()
    const span = {
      setAttribute: vi.fn().mockReturnThis(),
      setStatus: vi.fn().mockReturnThis(),
      addEvent,
      end: vi.fn(),
      updateName: vi.fn().mockReturnThis(),
      recordException: vi.fn().mockReturnThis(),
    } as unknown as Span
    const tracer = { startSpan: vi.fn(() => span) } as unknown as Tracer
    const app = new Orvaxis()
    app.register(otelPlugin({ tracer }))
    app.policy({ name: "allow-read", evaluate: () => ({ allow: true }) })
    app.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler: () => {} }] })

    await testRequest(app, { path: "/api/x" })

    expect(addEvent).toHaveBeenCalledWith(
      "POLICY_DECISION",
      expect.objectContaining({ policy: "allow-read", outcome: "allow" }),
      expect.any(Number)
    )
  })

  it("does not send free-form denial reasons to OpenTelemetry in summary mode", async () => {
    const addEvent = vi.fn()
    const recordException = vi.fn()
    const setStatus = vi.fn()
    const span = {
      setAttribute: vi.fn().mockReturnThis(),
      setStatus,
      addEvent,
      recordException,
      end: vi.fn(),
      updateName: vi.fn().mockReturnThis(),
    } as unknown as Span
    const tracer = { startSpan: vi.fn(() => span) } as unknown as Tracer
    const app = new Orvaxis()
    app.register(otelPlugin({ tracer }))
    app.policy({
      name: "owner-only",
      evaluate: () => ({ allow: false, reason: "user 42 is not owner" }),
    })
    app.group({ prefix: "/api", routes: [{ method: "GET", path: "/x", handler: () => {} }] })

    await testRequest(app, { path: "/api/x" })

    expect(recordException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "PolicyDeniedError", message: "Policy denied: owner-only" })
    )
    expect(setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "Policy denied: owner-only",
    })
    expect(addEvent.mock.calls.flat().join(" ")).not.toContain("user 42 is not owner")
  })
})
