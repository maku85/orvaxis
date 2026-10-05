import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runPolicyDiagnostics } from "../examples/policy-diagnostics"
import type { PolicyDiagnosticSnapshot } from "../examples/policy-diagnostics-types"

const outputDirectory = join(process.cwd(), "docs/public/demo")
const outputPath = join(outputDirectory, "policy-scenarios.json")

function validateSnapshots(snapshots: PolicyDiagnosticSnapshot[]) {
  const expected = new Map([
    ["allowed", { status: 200, outcome: "completed", handlerExecuted: true }],
    ["denied", { status: 403, outcome: "denied", handlerExecuted: false }],
    ["handler-error", { status: 500, outcome: "error", handlerExecuted: true }],
  ])

  if (snapshots.length !== expected.size) throw new Error("Unexpected policy demo scenario count")
  for (const snapshot of snapshots) {
    const result = expected.get(snapshot.id)
    if (
      !result ||
      snapshot.status !== result.status ||
      snapshot.outcome !== result.outcome ||
      snapshot.handlerExecuted !== result.handlerExecuted
    ) {
      throw new Error(`Policy demo scenario did not match its expected result: ${snapshot.id}`)
    }
    if (snapshot.route !== "/:id") throw new Error(`Unexpected demo route: ${snapshot.route}`)
    if (JSON.stringify(snapshot).includes("private storage detail")) {
      throw new Error("Policy demo output contains a private error message")
    }
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
