import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import { formatExecutionSummary } from "../debug/formatExecutionSummary"

describe("formatExecutionSummary", () => {
  it("identifies a failure even when the thrown value is falsy", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [
        {
          method: "GET",
          path: "/fail",
          handler: () => {
            throw null
          },
        },
      ],
    })
    const result = await testRequest(app, { path: "/api/fail" })
    if (!result.ctx) throw new Error("expected a request context")
    expect(formatExecutionSummary(result.ctx)).toContain("Outcome: error (500)")
  })

  it("formats allowed, denied, and failed requests without request or message data", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/documents",
      routes: [
        {
          method: "GET",
          path: "/:id",
          policies: [
            {
              name: "document-owner",
              evaluate: (ctx) =>
                ctx.req.headers["x-owner"] === "yes"
                  ? { allow: true }
                  : { allow: false, reason: `private ${ctx.req.headers["x-owner"]}` },
            },
          ],
          handler: (ctx) => {
            if (ctx.params.id === "explode") throw new Error("private database details")
            ctx.res.json({ ok: true })
          },
        },
      ],
    })

    const allowed = await testRequest(app, {
      path: "/documents/secret-id",
      headers: { "x-owner": "yes" },
    })
    const denied = await testRequest(app, {
      path: "/documents/private-id",
      headers: { "x-owner": "private-header-value" },
    })
    const failed = await testRequest(app, {
      path: "/documents/explode",
      headers: { "x-owner": "yes", authorization: "secret-token" },
    })

    if (!allowed.ctx || !denied.ctx || !failed.ctx) throw new Error("expected request contexts")

    expect(formatExecutionSummary(allowed.ctx)).toContain("Outcome: completed (200)")
    const deniedText = formatExecutionSummary(denied.ctx)
    expect(deniedText).toContain("Outcome: denied (403)")
    expect(deniedText).toContain("Stopped by: document-owner")
    expect(deniedText).toContain("Not reached:")
    expect(deniedText).not.toContain("private-header-value")
    expect(deniedText).not.toContain("private private-header-value")
    const failedText = formatExecutionSummary(failed.ctx)
    expect(failedText).toContain("Outcome: error (500)")
    expect(failedText).not.toContain("private database details")
    expect(failedText).not.toContain("secret-token")
  })

  it("does not expose raw paths when no route matches", async () => {
    const result = await testRequest(new Orvaxis(), { path: "/users/private-id" })
    if (!result.ctx) throw new Error("expected a request context")
    const text = formatExecutionSummary(result.ctx)
    expect(text).toContain("GET <unmatched route>")
    expect(text).not.toContain("private-id")
  })

  it.each([
    ["a truthy string", "boom", "Outcome: error (500)"],
    ["a truthy number", 42, "Outcome: error (500)"],
    ["zero", 0, "Outcome: error (500)"],
    ["an empty string", "", "Outcome: error (500)"],
    ["false", false, "Outcome: error (500)"],
    ["an ordinary error", new Error("x"), "Outcome: error (500)"],
    ["an invalid status", Object.assign(new Error("x"), { status: 99 }), "Outcome: error (500)"],
    [
      "a non-numeric status",
      Object.assign(new Error("x"), { status: "404" }),
      "Outcome: error (500)",
    ],
    ["a valid status", Object.assign(new Error("x"), { status: 418 }), "Outcome: error (418)"],
  ])("handles %s thrown by a handler", async (_label, thrown, expected) => {
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/fail",
          handler: () => {
            throw thrown
          },
        },
      ],
    })
    const result = await testRequest(app, { path: "/fail" })
    if (!result.ctx) throw new Error("expected a request context")
    expect(formatExecutionSummary(result.ctx)).toContain(expected)
  })

  it("keeps the sent status when a later hook fails", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [{ method: "GET", path: "/ok", handler: (ctx) => ctx.res.json({ ok: true }) }],
    })
    app.on("afterHandler", () => {
      throw new Error("hook failure")
    })
    const result = await testRequest(app, { path: "/api/ok" })
    if (!result.ctx) throw new Error("expected a request context")
    const text = formatExecutionSummary(result.ctx)
    expect(text).toContain("Outcome: error (200, response already sent)")
    expect(text).not.toContain("hook failure")
  })

  it("shows the full group route template and the HEAD request method", async () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api/v1",
      routes: [{ method: "GET", path: "/items/:id", handler: (ctx) => ctx.res.json({}) }],
    })
    const get = await testRequest(app, { path: "/api/v1/items/secret" })
    const head = await testRequest(app, { path: "/api/v1/items/secret", method: "HEAD" })
    if (!get.ctx || !head.ctx) throw new Error("expected request contexts")
    const getText = formatExecutionSummary(get.ctx)
    expect(getText).toContain("GET /api/v1/items/:id")
    expect(getText).not.toContain("secret")
    const headText = formatExecutionSummary(head.ctx)
    expect(headText).toContain("HEAD (matched GET) /api/v1/items/:id")
    expect(headText).not.toContain("secret")
  })
})
