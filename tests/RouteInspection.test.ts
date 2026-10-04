import { describe, expect, it, vi } from "vitest"
import { Orvaxis } from "../core/Orvaxis"

describe("Orvaxis.inspectRoutes", () => {
  it("shows policies in runtime order with their static configuration and applicability", () => {
    const app = new Orvaxis()
    const predicate = vi.fn(() => true)
    const evaluate = vi.fn(() => ({ allow: true as const }))

    app.policy({ name: "auth", priority: 20, scope: { path: "/api" }, evaluate })
    app.policy({ name: "dynamic-check", scope: { path: predicate }, evaluate })
    app.policy({ name: "specific-id", scope: { path: "/api/users/42" }, evaluate })
    app.policy({ name: "admin-only", scope: { path: "/admin" }, evaluate })
    app.policy({ name: "post-only", scope: { path: "/api", method: "POST" }, evaluate })
    app.group({
      prefix: "/api",
      policies: [{ name: "tenant", evaluate }],
      routes: [
        {
          method: "GET",
          path: "/users/:id",
          policies: [
            {
              name: "auth",
              phase: "postValidation",
              requires: ["params"],
              evaluate,
            },
          ],
          handler: () => {},
        },
      ],
    })

    const inspected = app.inspectRoutes()
    const route = inspected[0]
    const policies = route.policies

    expect(route).toMatchObject({ method: "GET", path: "/api/users/:id", prefix: "/api" })
    expect(policies.map(({ name, layer, phase }) => `${layer}.${phase}.${name}`)).toEqual([
      "global.preValidation.auth",
      "global.preValidation.dynamic-check",
      "global.preValidation.specific-id",
      "global.preValidation.admin-only",
      "global.preValidation.post-only",
      "group.preValidation.tenant",
      "route.postValidation.auth",
    ])
    expect(policies.map((policy) => policy.order)).toEqual([1, 2, 3, 4, 5, 1, 1])
    expect(policies[0]).toMatchObject({
      id: "global:0",
      priority: 20,
      scope: { path: "/api", pathType: "literal" },
      applicability: { status: "always", reason: "path-prefix" },
    })
    expect(policies[1]).toMatchObject({
      scope: { path: "predicate", pathType: "predicate" },
      applicability: { status: "conditional", reason: "dynamic-path" },
    })
    expect(policies[2].applicability.status).toBe("conditional")
    expect(policies[3].applicability.status).toBe("never")
    expect(policies[4].applicability).toEqual({ status: "never", reason: "method-mismatch" })
    expect(policies[6]).toMatchObject({
      phase: "postValidation",
      requires: ["params"],
      nameAmbiguous: true,
      applicability: { status: "always" },
    })
    expect(policies[0].nameAmbiguous).toBe(true)
    expect(new Set(policies.map((policy) => policy.id)).size).toBe(policies.length)
    expect(predicate).not.toHaveBeenCalled()
    expect(evaluate).not.toHaveBeenCalled()
  })

  it("retains the existing routes() result and marks static non-matches", () => {
    const app = new Orvaxis()
    app.policy({ name: "users", scope: { path: "/api/users" }, evaluate: () => ({ allow: true }) })
    app.group({ prefix: "/api", routes: [{ method: "GET", path: "/health", handler: () => {} }] })

    expect(app.routes()).toEqual([{ method: "GET", path: "/api/health", prefix: "/api" }])
    expect(app.inspectRoutes()[0].policies[0].applicability).toEqual({
      status: "never",
      reason: "path-no-match",
    })
  })

  it("reports GET policy scopes conditionally when implicit HEAD fallback is possible", () => {
    const app = new Orvaxis()
    app.policy({ name: "get-only", scope: { method: "GET" }, evaluate: () => ({ allow: true }) })
    app.policy({ name: "head-only", scope: { method: "HEAD" }, evaluate: () => ({ allow: true }) })
    app.group({ prefix: "/api", routes: [{ method: "GET", path: "/resource", handler: () => {} }] })

    const methods = app.inspectRoutes()[0].policies
    expect(methods.map(({ applicability }) => applicability)).toEqual([
      { status: "conditional", reason: "method-alias" },
      { status: "conditional", reason: "method-alias" },
    ])
  })

  it("accounts for an explicit HEAD route when inspecting a GET route", () => {
    const app = new Orvaxis()
    app.policy({ name: "head-only", scope: { method: "HEAD" }, evaluate: () => ({ allow: true }) })
    app.group({
      prefix: "/api",
      routes: [
        { method: "GET", path: "/resource", handler: () => {} },
        { method: "HEAD", path: "/resource", handler: () => {} },
      ],
    })

    expect(app.inspectRoutes()[0].policies[0].applicability).toEqual({
      status: "never",
      reason: "method-mismatch",
    })
  })
})
