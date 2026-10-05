import { describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { checkPolicyRequirements, formatPolicyRequirementReport } from "../core/policyRequirements"

describe("checkPolicyRequirements", () => {
  it("rejects a non-terminal ** selector instead of ignoring its suffix", () => {
    const requirement = {
      name: "private endpoints",
      paths: ["/api/**/private"],
      requirePolicies: ["authenticate"],
    }
    expect(() => checkPolicyRequirements([], [requirement])).toThrow(/last path segment/)
    expect(() =>
      checkPolicyRequirements(
        [],
        [
          {
            ...requirement,
            paths: ["/api/**"],
            exceptions: [{ path: "/api/**/health", reason: "Health probe" }],
          },
        ]
      )
    ).toThrow(/last path segment/)
  })

  it("rejects exceptions with an empty reason", () => {
    expect(() =>
      checkPolicyRequirements(
        [],
        [
          {
            name: "private endpoints",
            paths: ["/api/**"],
            requirePolicies: ["authenticate"],
            exceptions: [{ path: "/api/health", reason: "  " }],
          },
        ]
      )
    ).toThrow(/non-empty reason/)
  })

  it("checks route sets, explicit exceptions, and dynamic scopes without evaluating policies", () => {
    const evaluate = vi.fn(() => ({ allow: true as const }))
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [
        {
          method: "GET",
          path: "/private/:id",
          policies: [
            {
              name: "authenticate",
              scope: { path: (path: string) => path.startsWith("/api/private") },
              evaluate,
            },
          ],
          handler: () => {},
        },
        {
          method: "GET",
          path: "/private/health",
          handler: () => {},
        },
        { method: "POST", path: "/private/:id", handler: () => {} },
        { method: "GET", path: "/public", handler: () => {} },
      ],
    })

    const report = checkPolicyRequirements(app.inspectRoutes(), [
      {
        name: "private endpoints require authentication",
        paths: ["/api/private/**"],
        methods: ["GET"],
        requirePolicies: ["authenticate"],
        exceptions: [
          { path: "/api/private/health", methods: ["GET"], reason: "Health endpoint is public" },
        ],
      },
    ])

    expect(report.passed).toBe(true)
    expect(report.results).toEqual([
      expect.objectContaining({
        path: "/api/private/:id",
        status: "unverifiable",
        unverifiablePolicies: ["authenticate"],
      }),
      expect.objectContaining({
        path: "/api/private/health",
        status: "excluded",
        exceptionReason: "Health endpoint is public",
      }),
    ])
    expect(evaluate).not.toHaveBeenCalled()
    expect(formatPolicyRequirementReport(report)).toContain("scope not verified: authenticate")
  })

  it("fails when a selected route lacks a required policy", () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [{ method: "GET", path: "/private/:id", handler: () => {} }],
    })

    const report = checkPolicyRequirements(app.inspectRoutes(), [
      {
        name: "private authentication",
        paths: ["/api/private/*"],
        requirePolicies: ["authenticate"],
      },
    ])

    expect(report.passed).toBe(false)
    expect(report.results[0]).toMatchObject({ status: "fail", missingPolicies: ["authenticate"] })
    expect(formatPolicyRequirementReport(report)).toContain("missing: authenticate")
  })

  it("fails requirements that select no routes and can make conditional scopes strict", () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [
        {
          method: "GET",
          path: "/users/:id",
          policies: [
            { name: "authenticate", scope: { path: /users/ }, evaluate: () => ({ allow: true }) },
          ],
          handler: () => {},
        },
      ],
    })

    const routes = app.inspectRoutes()
    const missing = checkPolicyRequirements(routes, [
      { name: "missing endpoint set", paths: ["/api/admin/**"], requirePolicies: ["authenticate"] },
    ])
    const strict = checkPolicyRequirements(
      routes,
      [{ name: "strict user auth", paths: ["/api/users/*"], requirePolicies: ["authenticate"] }],
      { failOnUnverifiable: true }
    )

    expect(missing.passed).toBe(false)
    expect(missing.results[0].message).toBe("selector matched no routes")
    expect(strict.passed).toBe(false)
    expect(strict.results[0].status).toBe("unverifiable")
  })
})
