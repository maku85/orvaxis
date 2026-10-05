import { basename } from "node:path"
import { testRequest } from "../core/testHarness"
import { buildExecutionSummary, formatExecutionSummary, Orvaxis } from "../index"
import type { PolicyDiagnosticSnapshot } from "./policy-diagnostics-types"

export const policyDiagnosticScenarios = [
  {
    id: "allowed",
    label: "Allowed",
    description: "The ownership policy allows the request and the handler completes.",
    path: "/documents/alice",
    owner: "alice",
  },
  {
    id: "denied",
    label: "Denied (403)",
    description: "The ownership policy denies the request before the handler runs.",
    path: "/documents/bob",
    owner: "alice",
  },
  {
    id: "handler-error",
    label: "Handler error (500)",
    description: "The policy allows the request, then the handler fails.",
    path: "/documents/broken",
    owner: "broken",
  },
] as const

export async function runPolicyDiagnostics(): Promise<PolicyDiagnosticSnapshot[]> {
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

  const snapshots: PolicyDiagnosticSnapshot[] = []
  for (const scenario of policyDiagnosticScenarios) {
    const result = await testRequest(app, {
      path: scenario.path,
      headers: { "x-demo-owner": scenario.owner },
    })
    if (!result.ctx) throw new Error(`No context captured for ${scenario.label}`)
    const summary = buildExecutionSummary(result.ctx)
    const terminalPolicy = summary.stoppedByPolicy?.meta?.policy
    const policyOutcome = summary.stoppedByPolicy?.meta?.outcome
    const contextError = result.ctx.error as (Error & { status?: unknown }) | undefined
    const status = contextError
      ? Number.isInteger(contextError.status)
        ? Number(contextError.status)
        : 500
      : result.status
    snapshots.push({
      id: scenario.id,
      label: scenario.label,
      description: scenario.description,
      method: "GET",
      route: summary.route?.route.path ?? "<unmatched route>",
      status,
      outcome:
        policyOutcome === "deny"
          ? "denied"
          : policyOutcome === "error" || result.ctx.error
            ? "error"
            : "completed",
      terminalPolicy: typeof terminalPolicy === "string" ? terminalPolicy : null,
      handlerExecuted: result.ctx.meta.trace?.handlerExecuted ?? false,
      decisions: summary.policyDecisions.map((event) => ({
        policy: String(event.meta?.policy ?? "unknown"),
        layer: String(event.meta?.layer ?? "unknown"),
        phase: String(event.meta?.phase ?? "unknown"),
        outcome: String(event.meta?.outcome ?? "unknown"),
        terminal: event.meta?.terminal === true,
      })),
      notReachedStages: summary.notReachedStages,
      formattedSummary: formatExecutionSummary(result.ctx),
    })
  }
  return snapshots
}

if (basename(process.argv[1] ?? "") === "policy-diagnostics.ts") {
  runPolicyDiagnostics()
    .then((snapshots) => {
      for (const snapshot of snapshots) {
        console.log(`=== ${snapshot.label.toUpperCase()} ===`)
        console.log(snapshot.formattedSummary)
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.name : "Demo failed")
      process.exitCode = 1
    })
}
