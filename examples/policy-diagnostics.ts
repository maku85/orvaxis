import { testRequest } from "../core/testHarness"
import { formatExecutionSummary, Orvaxis } from "../index"

async function main() {
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
              ctx.req.headers["x-demo-owner"] === ctx.params.id
                ? { allow: true }
                : { allow: false, reason: "Demo ownership check failed" },
          },
        ],
        handler: (ctx) => {
          if (ctx.params.id === "broken") throw new Error("private storage detail")
          ctx.res.json({ id: ctx.params.id })
        },
      },
    ],
  })

  const scenarios = [
    { label: "ALLOWED", path: "/documents/alice", headers: { "x-demo-owner": "alice" } },
    { label: "DENIED (403)", path: "/documents/bob", headers: { "x-demo-owner": "alice" } },
    {
      label: "FAILED (handler error)",
      path: "/documents/broken",
      headers: { "x-demo-owner": "broken" },
    },
  ]

  for (const scenario of scenarios) {
    const result = await testRequest(app, { path: scenario.path, headers: scenario.headers })
    if (!result.ctx) throw new Error(`No context captured for ${scenario.label}`)
    console.log(`=== ${scenario.label} ===`)
    console.log(formatExecutionSummary(result.ctx))
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "Demo failed")
  process.exitCode = 1
})
