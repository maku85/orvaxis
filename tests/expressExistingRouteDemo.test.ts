import { readFileSync } from "node:fs"
import { createServer as createHttpServer } from "node:http"
import { describe, expect, it } from "vitest"
import { createExistingRouteDemo, explainDenial } from "../examples/express-existing-route"

describe("existing Express route demo", () => {
  it("runs the original handler only when its owner policy allows the request", async () => {
    const server = createHttpServer(createExistingRouteDemo())
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Expected an ephemeral port")

    try {
      const baseUrl = `http://127.0.0.1:${address.port}/api/documents/alice`
      const allowed = await fetch(baseUrl, { headers: { "x-user-id": "alice" } })
      expect(allowed.status).toBe(200)
      expect(await allowed.json()).toEqual({ documentId: "alice" })

      const denied = await fetch(baseUrl, { headers: { "x-user-id": "bob" } })
      expect(denied.status).toBe(403)
      expect(await denied.json()).not.toHaveProperty("documentId")
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it("explains the first denied request exactly as the guide shows it", async () => {
    const guide = readFileSync("docs/guide/integrate-existing-route.md", "utf8")
    const shown = /```text\n(GET \/api\/documents\/:id[\s\S]*?)\n```/.exec(guide)?.[1]
    expect(shown).toBeDefined()
    expect(await explainDenial("bob", "alice")).toBe(shown)
    const allowed = await explainDenial("alice", "alice")
    expect(allowed).toContain("Outcome: completed (200)")
    expect(allowed).not.toContain("Stopped by")
  })
})
