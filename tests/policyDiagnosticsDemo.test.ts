import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { policyDiagnosticScenarios, runPolicyDiagnostics } from "../examples/policy-diagnostics"
import { tenantTaskScenarios } from "../examples/tenant-tasks"

describe("policy diagnostics documentation demo", () => {
  it("generates distinct, safe scenarios from the runtime", async () => {
    const snapshots = await runPolicyDiagnostics()
    const basics = snapshots.filter((snapshot) => snapshot.group === "basics")

    expect(basics).toHaveLength(policyDiagnosticScenarios.length)
    expect(
      basics.map(({ id, status, outcome, handlerExecuted, terminalPolicy }) => [
        id,
        status,
        outcome,
        handlerExecuted,
        terminalPolicy,
      ])
    ).toEqual([
      ["allowed", 200, "completed", true, null],
      ["denied", 403, "denied", false, "document-owner"],
      ["policy-error", 500, "error", false, "ledger-access"],
      ["validation-failed", 422, "error", false, null],
      ["handler-error", 500, "error", true, null],
      ["trace-truncated", 403, "denied", false, "audit-reader"],
    ])
    expect(new Set(snapshots.map((snapshot) => snapshot.id)).size).toBe(snapshots.length)
  })

  it("tells the error classes apart in the request report", async () => {
    const byId = new Map((await runPolicyDiagnostics()).map((snapshot) => [snapshot.id, snapshot]))
    expect(byId.get("denied")?.report.terminalDecision).toMatchObject({
      state: "recorded",
      kind: "deny",
    })
    expect(byId.get("policy-error")?.report.terminalDecision).toMatchObject({
      state: "recorded",
      kind: "error",
      policy: "ledger-access",
    })
    // Validation and handler failures are not policy decisions.
    expect(byId.get("validation-failed")?.report).toMatchObject({
      terminalDecision: { state: "none" },
      handler: "not-executed",
      response: { status: 422 },
    })
    expect(byId.get("handler-error")?.report).toMatchObject({
      terminalDecision: { state: "none" },
      handler: "executed",
    })
    const truncated = byId.get("trace-truncated")?.report
    expect(truncated?.trace).toMatchObject({ truncated: true, droppedDecisions: 2, maxEvents: 2 })
    expect(truncated?.terminalDecision).toMatchObject({ state: "recorded", policy: "audit-reader" })
    expect(byId.get("denied")?.notReachedStages).toContain("handler")
  })

  it("reproduces every tenant matrix scenario from the permission matrix", async () => {
    const byId = new Map((await runPolicyDiagnostics()).map((snapshot) => [snapshot.id, snapshot]))
    for (const named of tenantTaskScenarios) {
      const key = (named.request as { headers?: Record<string, string> }).headers?.["x-api-key"]
      const identity = key ? key.replace("key-", "") : "anonymous"
      const resource = named.request.path.endsWith("task-1")
        ? "task-1"
        : named.request.path.endsWith("task-3")
          ? "task-3"
          : "overview"
      expect(byId.get(`tenant:${identity}:${resource}`), named.name).toMatchObject({
        status: named.expected.status,
        terminalPolicy: named.expected.policy,
        handlerExecuted: named.expected.handlerExecuted,
      })
    }
    expect(byId.get("tenant:maya:task-1")).toMatchObject({
      terminalPolicy: "tenant-access",
      status: 403,
    })
    expect(byId.get("tenant:bob:task-1")).toMatchObject({
      terminalPolicy: "task-owner-or-admin",
      status: 403,
    })
    expect(byId.get("tenant:anonymous:task-1")).toMatchObject({
      terminalPolicy: "authenticate",
      status: 401,
    })
  })

  it("links every scenario to its source, test and a copyable command, and keeps reports JSON-safe", async () => {
    for (const snapshot of await runPolicyDiagnostics()) {
      expect(snapshot.command).toBe(`pnpm exec tsx examples/policy-diagnostics.ts ${snapshot.id}`)
      expect(snapshot.source).toBe("examples/policy-diagnostics.ts")
      expect(snapshot.test).toBe("tests/policyDiagnosticsDemo.test.ts")
      expect(snapshot.report.durationMs).toBeNull()
      expect(JSON.parse(JSON.stringify(snapshot.report))).toEqual(snapshot.report)
      expect(snapshot.explanation.length).toBeGreaterThan(20)
      if (snapshot.group === "tenant")
        expect(snapshot.curl).toContain("http://localhost:3002/api/tenants/")
    }
  })

  it("keeps request values, private messages and demo keys out of the published data", async () => {
    const snapshots = await runPolicyDiagnostics()
    const published = JSON.stringify(snapshots.map(({ curl: _curl, ...rest }) => rest))
    for (const text of [
      "/documents/alice",
      "x-demo-owner",
      "x-api-key",
      "key-alice",
      "key-admin",
      "Demo ownership check failed",
      "Demo role check failed",
      "private storage detail",
      "private lookup failure",
      "Unknown demo API key",
    ]) {
      expect(published, text).not.toContain(text)
    }
  })

  it("replays a single scenario from the command line", () => {
    const result = spawnSync("npx", ["tsx", "examples/policy-diagnostics.ts", "policy-error"], {
      encoding: "utf8",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("ledger-access: error (evaluation error), terminal")
    expect(result.stdout).toContain('"state": "recorded"')
    const unknown = spawnSync("npx", ["tsx", "examples/policy-diagnostics.ts", "nope"], {
      encoding: "utf8",
    })
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain("Unknown scenario 'nope'")
  })
})
