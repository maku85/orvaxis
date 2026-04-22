#!/usr/bin/env node
/**
 * Usage:
 *   tsx benchmarks/compare.ts --save          # run benchmarks and save as new baseline
 *   tsx benchmarks/compare.ts --compare       # run benchmarks and compare against baseline
 *   tsx benchmarks/compare.ts                 # run benchmarks only (no save, no compare)
 *
 * Baseline file: benchmarks/baseline.json
 * Regression threshold: -10% in hz (configurable via BENCH_THRESHOLD env var)
 */

import { execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASELINE_PATH = join(__dirname, "baseline.json")
const THRESHOLD = Number(process.env.BENCH_THRESHOLD ?? 15)

type BenchEntry = { hz: number; mean: number; p99: number; rme: string }
type BenchSnapshot = { date: string; node: string; results: Record<string, BenchEntry> }

// ─── parse vitest bench output ────────────────────────────────────────────────

function parseOutput(raw: string): Record<string, BenchEntry> {
  const results: Record<string, BenchEntry> = {}
  let currentSuite = ""

  for (const line of raw.split("\n")) {
    // suite header: " ✓ benchmarks/policy.bench.ts > PolicyEngine — N always-allow policies 2967ms"
    const suiteMatch = line.match(/✓\s+\S+\s+>\s+(.+?)\s+\d+ms/)
    if (suiteMatch) {
      currentSuite = suiteMatch[1].trim()
      continue
    }

    // result row: "   · minimal request    12,841,381.72  0.0001  0.1775  0.0001  0.0001  0.0001  0.0001  0.0002  ±0.13%  ..."
    const rowMatch = line.match(/·\s+(.+?)\s{2,}([\d,]+\.\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+).+?(±[\d.]+%)/)
    if (rowMatch && currentSuite) {
      const [, name, hzRaw, , , mean, , rme] = rowMatch
      const p99Match = line.match(/(?:[\d.]+\s+){6}([\d.]+)/)
      results[`${currentSuite} > ${name.trim()}`] = {
        hz: Number(hzRaw.replace(/,/g, "")),
        mean: Number(mean),
        p99: p99Match ? Number(p99Match[1]) : 0,
        rme,
      }
    }
  }

  return results
}

// ─── run benchmarks ───────────────────────────────────────────────────────────

console.log("Running benchmarks…\n")
const raw = execSync("npx vitest bench run benchmarks/", {
  cwd: join(__dirname, ".."),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
})

process.stdout.write(raw)

const results = parseOutput(raw)
const snapshot: BenchSnapshot = {
  date: new Date().toISOString(),
  node: process.version,
  results,
}

// ─── save ─────────────────────────────────────────────────────────────────────

if (process.argv.includes("--save")) {
  writeFileSync(BASELINE_PATH, JSON.stringify(snapshot, null, 2))
  console.log(`\nBaseline saved → ${BASELINE_PATH}`)
  process.exit(0)
}

// ─── compare ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--compare")) {
  if (!existsSync(BASELINE_PATH)) {
    console.error(`No baseline found at ${BASELINE_PATH}. Run with --save first.`)
    process.exit(1)
  }

  const baseline: BenchSnapshot = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))

  console.log(`\nComparing against baseline from ${baseline.date} (Node ${baseline.node})\n`)

  const regressions: string[] = []
  const rows: { name: string; before: string; after: string; delta: string; status: string }[] = []

  for (const [name, current] of Object.entries(results)) {
    const prev = baseline.results[name]
    if (!prev) {
      rows.push({ name, before: "—", after: fmtHz(current.hz), delta: "new", status: "🆕" })
      continue
    }

    const pct = ((current.hz - prev.hz) / prev.hz) * 100
    const delta = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
    const status = pct <= -THRESHOLD ? "❌" : pct >= THRESHOLD ? "✅" : "  "

    rows.push({ name, before: fmtHz(prev.hz), after: fmtHz(current.hz), delta, status })

    if (pct <= -THRESHOLD) regressions.push(`  ${name}: ${delta}`)
  }

  // print table
  const nameW = Math.max(...rows.map((r) => r.name.length), 4)
  const header = `${"Benchmark".padEnd(nameW)}  ${"Before".padStart(14)}  ${"After".padStart(14)}  ${"Δ".padStart(8)}`
  console.log(header)
  console.log("─".repeat(header.length))
  for (const r of rows) {
    console.log(
      `${r.status} ${r.name.padEnd(nameW)}  ${r.before.padStart(14)}  ${r.after.padStart(14)}  ${r.delta.padStart(8)}`,
    )
  }

  if (regressions.length > 0) {
    console.log(`\n❌ Regressions detected (threshold: −${THRESHOLD}%):\n${regressions.join("\n")}`)
    process.exit(1)
  } else {
    console.log(`\n✅ No regressions detected (threshold: −${THRESHOLD}%)`)
  }
}

function fmtHz(hz: number): string {
  return hz >= 1_000_000
    ? `${(hz / 1_000_000).toFixed(2)}M/s`
    : hz >= 1_000
      ? `${(hz / 1_000).toFixed(1)}k/s`
      : `${hz.toFixed(0)}/s`
}
