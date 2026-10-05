import { describe, expect, it } from "vitest"
import { policyDiagnosticScenarios, runPolicyDiagnostics } from "../examples/policy-diagnostics"

describe("policy diagnostics documentation demo", () => {
  it("generates safe recorded outcomes from the runtime for the interactive site demo", async () => {
    const snapshots = await runPolicyDiagnostics()

    expect(snapshots).toHaveLength(policyDiagnosticScenarios.length)
    expect(
      snapshots.map(({ id, status, outcome, handlerExecuted }) => [
        id,
        status,
        outcome,
        handlerExecuted,
      ])
    ).toEqual([
      ["allowed", 200, "completed", true],
      ["denied", 403, "denied", false],
      ["handler-error", 500, "error", true],
    ])
    expect(snapshots[1]).toMatchObject({
      route: "/:id",
      terminalPolicy: "document-owner",
      notReachedStages: expect.arrayContaining(["handler"]),
    })

    const serialized = JSON.stringify(snapshots)
    expect(serialized).not.toContain("/documents/alice")
    expect(serialized).not.toContain("alice")
    expect(serialized).not.toContain("broken")
    expect(serialized).not.toContain("x-demo-owner")
    expect(serialized).not.toContain("Demo ownership check failed")
    expect(serialized).not.toContain("private storage detail")
  })
})
