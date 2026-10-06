import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runPolicyDiagnostics } from "../examples/policy-diagnostics"
import type { PolicyDiagnosticSnapshot } from "../examples/policy-diagnostics-types"
import { tenantTaskScenarios } from "../examples/tenant-tasks"

const outputDirectory = join(process.cwd(), "docs/public/demo")
const outputPath = join(outputDirectory, "policy-scenarios.json")

// What each single-purpose scenario must show. The build fails if the runtime disagrees, so the
// published demo can never describe behavior the code no longer has.
const expectedBasics = new Map([
  [
    "allowed",
    {
      status: 200,
      outcome: "completed",
      handlerExecuted: true,
      route: "/documents/:id",
      terminal: null,
    },
  ],
  [
    "denied",
    {
      status: 403,
      outcome: "denied",
      handlerExecuted: false,
      route: "/documents/:id",
      terminal: "document-owner",
    },
  ],
  [
    "policy-error",
    {
      status: 500,
      outcome: "error",
      handlerExecuted: false,
      route: "/ledger/:period",
      terminal: "ledger-access",
    },
  ],
  [
    "validation-failed",
    { status: 422, outcome: "error", handlerExecuted: false, route: "/uploads", terminal: null },
  ],
  [
    "handler-error",
    {
      status: 500,
      outcome: "error",
      handlerExecuted: true,
      route: "/documents/:id",
      terminal: null,
    },
  ],
  [
    "trace-truncated",
    {
      status: 403,
      outcome: "denied",
      handlerExecuted: false,
      route: "/audit/:id",
      terminal: "audit-reader",
    },
  ],
])

const PRIVATE = [
  "private storage detail",
  "private lookup failure",
  "Demo ownership check failed",
  "Demo role check failed",
]

function fail(message: string): never {
  throw new Error(message)
}

function validateSnapshots(snapshots: PolicyDiagnosticSnapshot[]) {
  const ids = new Set(snapshots.map((snapshot) => snapshot.id))
  if (ids.size !== snapshots.length) fail("Duplicate policy demo scenario id")

  const basics = snapshots.filter((snapshot) => snapshot.group === "basics")
  if (basics.length !== expectedBasics.size) fail("Unexpected policy demo scenario count")
  for (const snapshot of basics) {
    const expected =
      expectedBasics.get(snapshot.id) ?? fail(`Unexpected demo scenario: ${snapshot.id}`)
    if (
      snapshot.status !== expected.status ||
      snapshot.outcome !== expected.outcome ||
      snapshot.handlerExecuted !== expected.handlerExecuted ||
      snapshot.route !== expected.route ||
      snapshot.terminalPolicy !== expected.terminal
    ) {
      fail(`Policy demo scenario did not match its expected result: ${snapshot.id}`)
    }
  }
  const truncated = snapshots.find((snapshot) => snapshot.id === "trace-truncated")
  if (
    !truncated?.report.trace.truncated ||
    truncated.report.terminalDecision.state !== "recorded"
  ) {
    fail("The truncated-trace scenario must be truncated and still record its terminal decision")
  }

  // Tenant scenarios: every named scenario of the permission matrix must come out as declared, and
  // every combination must be internally consistent.
  const tenant = snapshots.filter((snapshot) => snapshot.group === "tenant")
  if (tenant.length === 0) fail("The tenant scenarios are missing")
  for (const named of tenantTaskScenarios) {
    const key = (named.request as { headers?: Record<string, string> }).headers?.["x-api-key"]
    const identity = key ? key.replace("key-", "") : "anonymous"
    const resource = named.request.path.endsWith("task-1")
      ? "task-1"
      : named.request.path.endsWith("task-3")
        ? "task-3"
        : "overview"
    const snapshot = snapshots.find(
      (candidate) => candidate.id === `tenant:${identity}:${resource}`
    )
    if (
      !snapshot ||
      snapshot.status !== named.expected.status ||
      snapshot.terminalPolicy !== named.expected.policy ||
      snapshot.handlerExecuted !== named.expected.handlerExecuted
    ) {
      fail(`Tenant scenario does not match the permission matrix: ${named.name}`)
    }
  }
  for (const snapshot of tenant) {
    if (snapshot.outcome === "denied" && (snapshot.handlerExecuted || !snapshot.terminalPolicy)) {
      fail(`Inconsistent denied tenant scenario: ${snapshot.id}`)
    }
    if (snapshot.status === 200 && (!snapshot.handlerExecuted || snapshot.terminalPolicy)) {
      fail(`Inconsistent allowed tenant scenario: ${snapshot.id}`)
    }
  }

  // Facts come from the request report, which must agree with the snapshot built from it.
  for (const snapshot of snapshots) {
    if ((snapshot.report.handler === "executed") !== snapshot.handlerExecuted)
      fail(`Report and snapshot disagree: ${snapshot.id}`)
    if (!snapshot.command.startsWith("pnpm exec tsx ") || !snapshot.source || !snapshot.test) {
      fail(`Missing source, test or command: ${snapshot.id}`)
    }
  }

  // No private text in the published data. Demo API keys appear only in the explicit curl field.
  const published = JSON.stringify(snapshots.map(({ curl: _curl, ...rest }) => rest))
  for (const secret of [
    ...PRIVATE,
    "key-alice",
    "key-bob",
    "key-maya",
    "key-admin",
    "x-api-key",
    "x-demo-owner",
  ]) {
    if (published.includes(secret)) fail(`Policy demo output contains private text: ${secret}`)
  }
}

async function main() {
  const snapshots = await runPolicyDiagnostics()
  validateSnapshots(snapshots)
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(snapshots, null, 2)}\n`)
  console.log(`Generated ${snapshots.length} policy trace scenarios from the runtime.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Policy demo generation failed")
  process.exitCode = 1
})
