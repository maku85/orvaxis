import { basename } from "node:path"
import { z } from "zod"
import { testRequest } from "../core/testHarness"
import {
  buildExecutionSummary,
  buildRequestReport,
  formatExecutionSummary,
  Orvaxis,
  schemaValidationPlugin,
} from "../index"
import type { PolicyDiagnosticSnapshot } from "./policy-diagnostics-types"
import { demoIdentities, tenantTasksApp } from "./tenant-tasks"

const SOURCE = "examples/policy-diagnostics.ts"
const TEST = "tests/policyDiagnosticsDemo.test.ts"

// ─── single-purpose scenarios ────────────────────────────────────────────────

function documentsApp(options: ConstructorParameters<typeof Orvaxis>[0] = {}) {
  const app = new Orvaxis(options)
  app.register(schemaValidationPlugin)
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
  app.group({
    prefix: "/ledger",
    routes: [
      {
        method: "GET",
        path: "/:period",
        policies: [
          {
            name: "ledger-access",
            evaluate: () => {
              throw new Error("private lookup failure")
            },
          },
        ],
        handler: (ctx) => ctx.res.json({ period: ctx.params.period }),
      },
    ],
  })
  app.group({
    prefix: "/uploads",
    routes: [
      {
        method: "POST",
        path: "",
        schema: { body: z.object({ name: z.string().min(1) }) },
        policies: [{ name: "uploader", evaluate: () => ({ allow: true }) }],
        handler: (ctx) => ctx.res.status(201).json({ ok: true }),
      },
    ],
  })
  return app
}

/** One app whose five policies run before the denial, with room for only two recorded decisions. */
function auditApp() {
  const app = new Orvaxis({ policyTrace: { mode: "summary", maxEvents: 2 } })
  for (const name of ["rate-limit", "authenticate", "tenant-member", "feature-enabled"]) {
    app.policy({ name, evaluate: () => ({ allow: true }) })
  }
  app.group({
    prefix: "/audit",
    routes: [
      {
        method: "GET",
        path: "/:id",
        policies: [
          {
            name: "audit-reader",
            evaluate: () => ({ allow: false, reason: "Demo role check failed" }),
          },
        ],
        handler: (ctx) => ctx.res.json({ id: ctx.params.id }),
      },
    ],
  })
  return app
}

const basics = [
  {
    id: "allowed",
    label: "Allowed",
    description: "The ownership policy allows the request and the handler completes.",
    explanation: "Every policy allowed the request, so the handler ran and no policy is terminal.",
    app: "documents",
    request: { path: "/documents/alice", headers: { "x-demo-owner": "alice" } },
  },
  {
    id: "denied",
    label: "Denied (403)",
    description: "The ownership policy denies the request before the handler runs.",
    explanation:
      "A policy said no. It is the terminal decision, and every later stage was never reached.",
    app: "documents",
    request: { path: "/documents/bob", headers: { "x-demo-owner": "alice" } },
  },
  {
    id: "policy-error",
    label: "Policy evaluation error (500)",
    description: "A policy throws while it is being evaluated.",
    explanation:
      "The policy failed instead of deciding: the terminal decision is an error, not a denial. Fix the policy; the caller did nothing wrong. The handler did not run.",
    app: "documents",
    request: { path: "/ledger/q1" },
  },
  {
    id: "validation-failed",
    label: "Validation failed (422)",
    description: "The request body does not match the route schema.",
    explanation:
      "No policy stopped this request: the schema rejected the body before post-validation policies and the handler. The terminal decision is none; look at the validation stage, not the policies.",
    app: "documents",
    request: { path: "/uploads", method: "POST", body: { name: "" } },
  },
  {
    id: "handler-error",
    label: "Handler error (500)",
    description: "The policy allows the request, then the handler fails.",
    explanation:
      "Policies allowed it and the handler ran and failed. The summary never repeats the error message; it can contain private data.",
    app: "documents",
    request: { path: "/documents/broken", headers: { "x-demo-owner": "broken" } },
  },
  {
    id: "trace-truncated",
    label: "Trace truncated, denial kept",
    description: "Five policies run before a denial, but only two decisions may be recorded.",
    explanation:
      "The decision limit dropped some allowed decisions, which the report counts, but the terminal denial is always recorded so the cause is still known.",
    app: "audit",
    request: { path: "/audit/q1" },
  },
] as const

export const policyDiagnosticScenarios = basics

// ─── multi-tenant fixtures ───────────────────────────────────────────────────

const identityChoices = [
  { id: "anonymous", label: "No API key", key: undefined },
  { id: "alice", label: "alice · member of acme", key: "key-alice" },
  { id: "bob", label: "bob · member of acme", key: "key-bob" },
  { id: "maya", label: "maya · member of globex", key: "key-maya" },
  { id: "admin", label: "root · admin of acme", key: "key-admin" },
] as const

const resourceChoices = [
  { id: "task-1", label: "acme task-1 (alice's task)", path: "/api/tenants/acme/tasks/task-1" },
  { id: "task-2", label: "acme task-2 (bob's task)", path: "/api/tenants/acme/tasks/task-2" },
  { id: "task-3", label: "globex task-3 (maya's task)", path: "/api/tenants/globex/tasks/task-3" },
  { id: "overview", label: "acme admin overview", path: "/api/tenants/acme/admin/overview" },
] as const

export const tenantIdentityChoices = identityChoices
export const tenantResourceChoices = resourceChoices

// ─── snapshots ───────────────────────────────────────────────────────────────

async function snapshotOf(
  app: Orvaxis,
  meta: Pick<
    PolicyDiagnosticSnapshot,
    "id" | "group" | "label" | "description" | "explanation" | "identity" | "command" | "curl"
  >,
  request: Parameters<typeof testRequest>[1]
): Promise<PolicyDiagnosticSnapshot> {
  const result = await testRequest(app, request)
  if (!result.ctx) throw new Error(`No context captured for ${meta.label}`)
  const summary = buildExecutionSummary(result.ctx)
  const report = buildRequestReport(result.ctx)
  const terminal = report.terminalDecision
  return {
    ...meta,
    method: report.method,
    route: report.route?.template ?? "<unmatched route>",
    status: result.status,
    outcome: report.outcome === "unknown" ? "error" : report.outcome,
    terminalPolicy: terminal.state === "recorded" ? terminal.policy : null,
    handlerExecuted: report.handler === "executed",
    decisions: summary.policyDecisions.map((event) => ({
      policy: String(event.meta?.policy ?? "unknown"),
      policyId: typeof event.meta?.policyId === "string" ? event.meta.policyId : null,
      layer: String(event.meta?.layer ?? "unknown"),
      phase: String(event.meta?.phase ?? "unknown"),
      outcome: String(event.meta?.outcome ?? "unknown"),
      terminal: event.meta?.terminal === true,
    })),
    notReachedStages: summary.notReachedStages,
    formattedSummary: formatExecutionSummary(result.ctx),
    report: { ...report, durationMs: null },
    source: SOURCE,
    test: TEST,
  }
}

export async function runPolicyDiagnostics(): Promise<PolicyDiagnosticSnapshot[]> {
  const apps = { documents: documentsApp(), audit: auditApp() }
  const snapshots: PolicyDiagnosticSnapshot[] = []

  for (const scenario of basics) {
    snapshots.push(
      await snapshotOf(
        apps[scenario.app],
        {
          id: scenario.id,
          group: "basics",
          label: scenario.label,
          description: scenario.description,
          explanation: scenario.explanation,
          identity: null,
          command: `pnpm exec tsx examples/policy-diagnostics.ts ${scenario.id}`,
          curl: null,
        },
        scenario.request
      )
    )
  }

  for (const identity of identityChoices) {
    for (const resource of resourceChoices) {
      const fixture = identity.key ? demoIdentities[identity.key] : undefined
      const id = `tenant:${identity.id}:${resource.id}`
      snapshots.push(
        await snapshotOf(
          tenantTasksApp,
          {
            id,
            group: "tenant",
            label: `${identity.label} → ${resource.label}`,
            description: "A fixture identity requests a fixture resource of the multi-tenant demo.",
            explanation: tenantExplanation(identity.id, resource.id),
            identity: fixture
              ? {
                  label: identity.label,
                  userId: fixture.userId,
                  tenantId: fixture.tenantId,
                  role: fixture.role,
                }
              : null,
            command: `pnpm exec tsx examples/policy-diagnostics.ts ${id}`,
            curl: `curl -i ${identity.key ? `-H 'x-api-key: ${identity.key}' ` : ""}http://localhost:3002${resource.path}`,
          },
          {
            path: resource.path,
            headers: identity.key ? { "x-api-key": identity.key } : {},
          }
        )
      )
    }
  }
  return snapshots
}

function tenantExplanation(identity: string, resource: string): string {
  if (identity === "anonymous")
    return "No API key: authentication stops the request before any tenant or ownership rule is asked."
  if (identity === "admin")
    return "The admin role crosses tenant boundaries and owns every task, but the admin overview is the only route that requires it."
  if (resource === "overview")
    return "Only admins may open the overview; a member is stopped by require-admin."
  if (identity === "maya" && resource !== "task-3")
    return "maya belongs to globex, so tenant-access stops her at the tenant boundary before ownership is checked."
  if (identity === "maya") return "maya is a member of globex and owns task-3."
  const owner = resource === "task-1" ? "alice" : resource === "task-2" ? "bob" : "maya"
  if (resource === "task-3")
    return "The group's tenant-access policy stops a member of another tenant."
  return identity === owner
    ? "Tenant member and owner of the task: both policies allow and the handler runs."
    : "Same tenant, different owner: tenant-access allows, then task-owner-or-admin stops the request."
}

if (basename(process.argv[1] ?? "") === "policy-diagnostics.ts") {
  const wanted = process.argv[2]
  runPolicyDiagnostics()
    .then((snapshots) => {
      const selected = wanted
        ? snapshots.filter((snapshot) => snapshot.id === wanted)
        : snapshots.filter((s) => s.group === "basics")
      if (selected.length === 0) {
        throw new Error(
          `Unknown scenario '${wanted}'. Known: ${snapshots.map((s) => s.id).join(", ")}`
        )
      }
      for (const snapshot of selected) {
        console.log(`=== ${snapshot.label.toUpperCase()} ===`)
        console.log(snapshot.formattedSummary)
        if (wanted) console.log(`\n${JSON.stringify(snapshot.report, null, 2)}`)
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Demo failed")
      process.exitCode = 1
    })
}
