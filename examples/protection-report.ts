import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  buildProtectionReport,
  diffProtectionReports,
  formatProtectionDiffMarkdown,
  formatProtectionReportMarkdown,
  type ProtectionReport,
  type ProtectionViolationKind,
} from "../testing"
import { tenantTasksApp } from "./tenant-tasks"

// Usage: tsx examples/protection-report.ts [--out dir] [--baseline file] [--update]
//        [--fail-on policy-removed,policy-weakened]
// Reads route declarations only: no handler, policy evaluator, or scope predicate runs.
const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const outDir = option("--out") ?? "protection-report"
const baselinePath = option("--baseline")
const failOn = (option("--fail-on")?.split(",").filter(Boolean) ?? []) as ProtectionViolationKind[]

const report = buildProtectionReport(tenantTasksApp.inspectRoutes())
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, "protection-report.json"), `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(join(outDir, "protection-report.md"), formatProtectionReportMarkdown(report))
console.log(`Wrote ${report.routes.length} route(s) to ${outDir}`)

if (baselinePath && args.includes("--update")) {
  writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Updated baseline ${baselinePath}`)
} else if (baselinePath) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as ProtectionReport
  const diff = diffProtectionReports(baseline, report, { failOn })
  writeFileSync(join(outDir, "protection-diff.json"), `${JSON.stringify(diff, null, 2)}\n`)
  const markdown = formatProtectionDiffMarkdown(diff)
  writeFileSync(join(outDir, "protection-diff.md"), markdown)
  console.log(markdown)
  if (!diff.passed) process.exitCode = 1
}
