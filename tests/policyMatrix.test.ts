import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { formatPolicyMatrixReport, testPolicyMatrix } from "../core/testHarness"

function makeTenantApp() {
  const app = new Orvaxis()
  let handlerCalls = 0
  let policyEvaluations = 0
  app.policy({
    name: "authenticate",
    evaluate: (ctx) => {
      policyEvaluations++
      return ctx.req.headers["x-user"] ? { allow: true } : { allow: false, status: 401 }
    },
  })
  app.group({
    prefix: "/tenants/:tenantId",
    policies: [
      {
        name: "tenant-access",
        evaluate: (ctx) => {
          policyEvaluations++
          return ctx.req.headers["x-role"] === "admin" ||
            ctx.req.headers["x-tenant"] === ctx.params.tenantId
            ? { allow: true }
            : { allow: false }
        },
      },
    ],
    routes: [
      {
        method: "GET",
        path: "/documents/:documentId",
        policies: [
          {
            name: "document-owner-or-admin",
            evaluate: (ctx) => {
              policyEvaluations++
              return ctx.req.headers["x-role"] === "admin" || ctx.req.headers["x-user"] === "alice"
                ? { allow: true }
                : { allow: false }
            },
          },
        ],
        handler: (ctx) => {
          handlerCalls++
          ctx.res.json({ documentId: ctx.params.documentId })
        },
      },
    ],
  })
  return {
    app,
    handlerCalls: () => handlerCalls,
    policyEvaluations: () => policyEvaluations,
  }
}

describe("testPolicyMatrix", () => {
  it("checks identity, ownership, tenant, and admin scenarios from one execution each", async () => {
    const { app, handlerCalls, policyEvaluations } = makeTenantApp()
    const report = await testPolicyMatrix(app, [
      {
        name: "anonymous",
        request: { path: "/tenants/acme/documents/42" },
        expected: { status: 401, policy: "authenticate", handlerExecuted: false },
      },
      {
        name: "document owner",
        request: {
          path: "/tenants/acme/documents/42",
          headers: { "x-user": "alice", "x-tenant": "acme" },
        },
        expected: { status: 200, policy: null, handlerExecuted: true },
      },
      {
        name: "different user in tenant",
        request: {
          path: "/tenants/acme/documents/42",
          headers: { "x-user": "bob", "x-tenant": "acme" },
        },
        expected: { status: 403, policy: "document-owner-or-admin", handlerExecuted: false },
      },
      {
        name: "user from another tenant",
        request: {
          path: "/tenants/acme/documents/42",
          headers: { "x-user": "alice", "x-tenant": "other" },
        },
        expected: { status: 403, policy: "tenant-access", handlerExecuted: false },
      },
      {
        name: "admin",
        request: {
          path: "/tenants/acme/documents/42",
          headers: { "x-user": "root", "x-role": "admin", "x-tenant": "other" },
        },
        expected: { status: 200, policy: null, handlerExecuted: true },
      },
    ])

    expect(report.passed, formatPolicyMatrixReport(report)).toBe(true)
    expect(handlerCalls()).toBe(2)
    expect(policyEvaluations()).toBe(12)
    expect(report.scenarios.map((scenario) => scenario.handlerExecuted)).toEqual([
      false,
      true,
      false,
      false,
      true,
    ])
    expect(formatPolicyMatrixReport(report)).toContain("PASS | document owner")
  })

  it("reports expectation mismatches without exposing request values", async () => {
    const { app } = makeTenantApp()
    const report = await testPolicyMatrix(app, [
      {
        name: "private scenario",
        request: {
          path: "/tenants/acme/documents/secret-id",
          headers: { "x-user": "alice", authorization: "secret-token" },
        },
        expected: { status: 403, policy: "unexpected-policy", handlerExecuted: false },
      },
    ])

    expect(report.passed).toBe(false)
    const text = formatPolicyMatrixReport(report)
    expect(text).toContain("FAIL | private scenario | status 403")
    expect(text).not.toContain("secret-id")
    expect(text).not.toContain("secret-token")
  })
})
