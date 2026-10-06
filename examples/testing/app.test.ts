// #region imports
import { describe, expect, it } from "vitest"
import {
  checkPolicyRequirements,
  formatPolicyMatrixReport,
  formatPolicyRequirementReport,
  testPolicyMatrix,
  testRequest,
} from "../../testing"
import { createApp } from "./app"

// #endregion

// These are real tests: `pnpm test` runs them, and the testing guide shows them as written.
const app = createApp()
const alice = { "x-user": "alice" }

describe("testRequest runs the whole lifecycle without a server", () => {
  // #region success
  it("answers a permitted request", async () => {
    const result = await testRequest(app, { path: "/api/users/alice", headers: alice })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ id: "alice" })
    expect(result.error).toBeUndefined()
    expect(result.ctx?.meta.trace?.handlerExecuted).toBe(true)
  })
  // #endregion

  // #region invalid-input
  it("rejects invalid input before the handler", async () => {
    const result = await testRequest(app, {
      method: "POST",
      path: "/api/users",
      headers: alice,
      body: { name: "" },
    })
    expect(result.status).toBe(422)
    expect(result.error?.message).toBe("Validation failed: body")
    expect(result.ctx?.meta.trace?.handlerExecuted).toBe(false)
  })
  // #endregion

  // #region middleware
  it("shows what middleware did to the request", async () => {
    const result = await testRequest(app, { path: "/api/users/alice", headers: alice })
    expect(result.ctx?.state.audited).toBe(true)
  })
  // #endregion

  // #region handler-error
  it("captures an error thrown by the handler instead of throwing", async () => {
    const result = await testRequest(app, { path: "/api/report", headers: alice })
    expect(result.status).toBe(500)
    expect(result.error?.message).toBe("report failed") // the original error, not an HTTP envelope
    expect(result.ctx?.meta.trace?.outcome).toBe("error")
  })
  // #endregion

  // #region streaming
  it("collects streamed chunks", async () => {
    const result = await testRequest(app, { path: "/api/stream", headers: alice })
    expect(result.chunks).toEqual(["chunk1", "chunk2"])
    expect(result.ended).toBe(true)
  })
  // #endregion
})

describe("permission tests and static checks answer different questions", () => {
  // #region matrix
  const scenarios = [
    {
      name: "anonymous request",
      request: { path: "/api/users/alice" },
      expected: { status: 401, policy: "authenticate", handlerExecuted: false },
    },
    {
      name: "the owner",
      request: { path: "/api/users/alice", headers: alice },
      expected: { status: 200, policy: null, handlerExecuted: true },
    },
    {
      name: "another user",
      request: { path: "/api/users/alice", headers: { "x-user": "bob" } },
      expected: { status: 403, policy: "owner-or-admin", handlerExecuted: false },
    },
  ]

  it("enforces who may read a profile", async () => {
    const report = await testPolicyMatrix(app, scenarios)
    expect(report.passed, formatPolicyMatrixReport(report)).toBe(true)
  })
  // #endregion

  // #region requirements
  const requirements = [
    {
      name: "profiles require authentication and an ownership check",
      paths: ["/api/users/:id"],
      requirePolicies: ["authenticate", "owner-or-admin"],
    },
  ]

  it("keeps the required policies attached", () => {
    const report = checkPolicyRequirements(app.inspectRoutes(), requirements)
    expect(report.passed, formatPolicyRequirementReport(report)).toBe(true)
  })
  // #endregion

  // #region broken
  it("catches a policy that is attached but wrong, which the static check cannot", async () => {
    const broken = createApp({ brokenAuthentication: true })

    // The declarations are intact, so the static check still passes...
    expect(checkPolicyRequirements(broken.inspectRoutes(), requirements).passed).toBe(true)

    // ...but the permission test fails: anonymous requests are no longer stopped.
    const report = await testPolicyMatrix(broken, scenarios)
    expect(report.passed).toBe(false)
    expect(report.scenarios.find((s) => s.name === "anonymous request")?.mismatches).toEqual([
      "status expected 401, received 403",
      "policy expected authenticate, received owner-or-admin",
    ])
  })
  // #endregion
})
