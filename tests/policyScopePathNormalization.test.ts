import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import type { Policy } from "../types"

function build(scope: Policy["scope"]) {
  const app = new Orvaxis()
  app.policy({ name: "deny", scope, evaluate: () => ({ allow: false, status: 403 }) })
  app.group({
    prefix: "/admin",
    routes: [{ method: "GET", path: "/users", handler: (ctx) => ctx.res.json({ secret: true }) }],
  })
  return app
}

describe("policy scope uses the same normalized path as the router", () => {
  const paths = [
    "/admin/users",
    "//admin/users",
    "/admin//users",
    "///admin///users",
    "/admin/users/",
  ]

  it.each([
    ["string", "/admin"],
    ["regexp", /^\/admin(\/|$)/],
    ["predicate", (p: string) => p.startsWith("/admin")],
  ] as const)("denies every slash variant with a %s scope", async (_kind, path) => {
    const app = build({ path })
    for (const p of paths) {
      const result = await testRequest(app, { path: p })
      expect(result.status, p).toBe(403)
    }
  })

  it("still lets unrelated paths through", async () => {
    const app = new Orvaxis()
    app.policy({ name: "deny", scope: { path: "/admin" }, evaluate: () => ({ allow: false }) })
    app.group({
      prefix: "/adminx",
      routes: [{ method: "GET", path: "", handler: (ctx) => ctx.res.json({ ok: true }) }],
    })
    expect((await testRequest(app, { path: "//adminx" })).status).toBe(200)
  })
})
