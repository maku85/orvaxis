import { describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import {
  buildProtectionReport,
  diffProtectionReports,
  formatProtectionDiffMarkdown,
  formatProtectionReportMarkdown,
} from "../testing"

const allow = () => ({ allow: true as const })

function build(
  options: {
    reverse?: boolean
    tenant?: boolean
    tenantScope?: "conditional" | "never"
    extraRoute?: boolean
  } = {}
) {
  const app = new Orvaxis()
  const globals = [
    { name: "authenticate", priority: 10, evaluate: allow },
    { name: "audit", evaluate: allow },
  ]
  for (const policy of options.reverse ? [...globals].reverse() : globals) app.policy(policy)
  const routePolicies = [
    ...(options.tenant === false
      ? []
      : [
          {
            name: "tenant-access",
            ...(options.tenantScope === "conditional"
              ? { scope: { path: (path: string) => path.length > 0 } }
              : options.tenantScope === "never"
                ? { scope: { method: "POST" as const } }
                : {}),
            evaluate: allow,
          },
        ]),
    {
      name: "owner",
      phase: "postValidation" as const,
      requires: ["params" as const],
      evaluate: allow,
    },
  ]
  app.group({
    prefix: "/api/tenants/:tenantId",
    routes: [
      {
        method: "GET",
        path: "/tasks/:id",
        policies: options.reverse ? [...routePolicies].reverse() : routePolicies,
        handler: vi.fn(),
      },
      ...(options.extraRoute
        ? [{ method: "GET" as const, path: "/health", handler: vi.fn() }]
        : []),
    ],
  })
  return app
}

const report = (options?: Parameters<typeof build>[0]) => {
  const app = build(options)
  return buildProtectionReport(app.inspectRoutes())
}

describe("protection report", () => {
  it("is deterministic JSON without handlers or ordering details", () => {
    const first = report()
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    expect(report({ reverse: true })).toEqual(first)
    expect(JSON.stringify(first)).not.toMatch(/priority|"id"|"order"/)
    expect(first.routes[0]?.policies.map((p) => `${p.phase}.${p.layer}.${p.name}`)).toEqual([
      "preValidation.global.audit",
      "preValidation.global.authenticate",
      "preValidation.route.tenant-access",
      "postValidation.route.owner",
    ])
  })

  it("does not execute evaluators, predicates or handlers", () => {
    const predicate = vi.fn(() => true)
    const evaluate = vi.fn(allow)
    const handler = vi.fn()
    const app = new Orvaxis()
    app.policy({ name: "p", scope: { path: predicate }, evaluate })
    app.group({ prefix: "/", routes: [{ method: "GET", path: "/x", handler }] })
    const result = buildProtectionReport(app.inspectRoutes())
    expect(result.routes[0]?.policies[0]).toMatchObject({
      applicability: "conditional",
      scope: { pathType: "predicate", path: "predicate" },
    })
    expect(predicate).not.toHaveBeenCalled()
    expect(evaluate).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it("shows a removed tenant policy as a readable diff", () => {
    const diff = diffProtectionReports(report(), report({ tenant: false }))
    expect(diff.changes).toEqual([
      expect.objectContaining({
        kind: "policy-removed",
        route: { method: "GET", path: "/api/tenants/:tenantId/tasks/:id" },
        policy: expect.objectContaining({ name: "tenant-access", layer: "route" }),
      }),
    ])
    expect(diff.passed).toBe(true)
    const markdown = formatProtectionDiffMarkdown(diff)
    expect(markdown).toContain("Policy removed on `GET /api/tenants/:tenantId/tasks/:id`")
    expect(markdown).toContain("`tenant-access`")
  })

  it("produces no noise for reordering and identical reports", () => {
    expect(diffProtectionReports(report(), report({ reverse: true })).changes).toEqual([])
    const markdown = formatProtectionDiffMarkdown(diffProtectionReports(report(), report()))
    expect(markdown).toContain("No changes against the baseline.")
  })

  it("reports additions without treating them as violations", () => {
    const diff = diffProtectionReports(report(), report({ extraRoute: true }), {
      failOn: ["policy-removed", "policy-weakened"],
    })
    expect(diff.changes).toEqual([
      {
        kind: "route-added",
        route: { method: "GET", path: "/api/tenants/:tenantId/health" },
        policies: 2,
      },
    ])
    expect(diff.passed).toBe(true)
    const reverse = diffProtectionReports(report({ extraRoute: true }), report())
    expect(reverse.changes[0]?.kind).toBe("route-removed")
    expect(reverse.passed).toBe(true)
  })

  it("only fails on the documented kinds that are enabled", () => {
    const removed = diffProtectionReports(report(), report({ tenant: false }), {
      failOn: ["policy-removed"],
    })
    expect(removed.passed).toBe(false)
    expect(removed.violations).toMatchObject([{ kind: "policy-removed", policy: "tenant-access" }])
    expect(formatProtectionDiffMarkdown(removed)).toContain("## Violations")

    const weakened = diffProtectionReports(report(), report({ tenantScope: "conditional" }))
    expect(weakened.changes).toMatchObject([
      {
        kind: "policy-changed",
        weakened: true,
        before: { applicability: "always" },
        after: { applicability: "conditional", scope: { pathType: "predicate" } },
      },
    ])
    expect(weakened.passed).toBe(true)
    expect(
      diffProtectionReports(report(), report({ tenantScope: "conditional" }), {
        failOn: ["policy-weakened"],
      }).passed
    ).toBe(false)
    expect(
      diffProtectionReports(report(), report({ tenantScope: "never" }), {
        failOn: ["policy-removed"],
      }).passed
    ).toBe(true)
    // Strengthening is a change, never a violation.
    const strengthened = diffProtectionReports(report({ tenantScope: "conditional" }), report(), {
      failOn: ["policy-removed", "policy-weakened"],
    })
    expect(strengthened.changes).toHaveLength(1)
    expect(strengthened.passed).toBe(true)
  })

  it("rejects an unsupported baseline version", () => {
    expect(() =>
      diffProtectionReports({ schemaVersion: 2, routes: [] } as never, report())
    ).toThrow(TypeError)
  })

  it("formats a Markdown table that escapes table syntax", () => {
    const app = new Orvaxis()
    app.policy({ name: "a|b", evaluate: allow })
    app.group({ prefix: "/", routes: [{ method: "GET", path: "/x", handler: vi.fn() }] })
    const markdown = formatProtectionReportMarkdown(buildProtectionReport(app.inspectRoutes()))
    expect(markdown).toContain("| GET /x | preValidation | global | a\\|b | always | — |")
    expect(markdown).toContain("does not prove")
  })
})
