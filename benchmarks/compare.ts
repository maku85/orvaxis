#!/usr/bin/env node
/**
 * Usage:
 *   tsx benchmarks/compare.ts --save               run the suite and store it as the baseline
 *   tsx benchmarks/compare.ts --compare            run the suite and compare with the baseline
 *   tsx benchmarks/compare.ts                      run the suite only
 *
 * Options:
 *   --threshold <percent>   throughput drop reported as a regression (default 15; or BENCH_THRESHOLD)
 *   --allow-mismatch        compare even when Node major, platform, architecture or runner differ
 *   --allow-removed         accept baseline cases that this run no longer produces
 *
 * Exit status: 0 clean, 1 regression, 2 the comparison cannot be trusted (empty or invalid
 * results, missing baseline cases, non-homogeneous runs) — never a silent pass.
 *
 * Results come from vitest's structured `--outputJson`, not from parsing terminal output.
 */
import { execFileSync, execSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { cpus, tmpdir } from "node:os"
import { join } from "node:path"
import {
  BenchError,
  type BenchSnapshot,
  compareSnapshots,
  decide,
  formatComparison,
  parseBenchJson,
  parseThreshold,
  SNAPSHOT_VERSION,
  validateSnapshot,
} from "./lib"

const here = __dirname
const root = join(here, "..")
const BASELINE_PATH = join(here, "baseline.json")
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function git(command: string): string {
  try {
    return execSync(`git ${command}`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return "unknown"
  }
}

function runSuite(): BenchSnapshot {
  const files = readdirSync(here).filter((name) => name.endsWith(".bench.ts")).sort()
  const directory = mkdtempSync(join(tmpdir(), "orvaxis-bench-"))
  const output = join(directory, "bench.json")
  const command = `vitest bench run ${files.map((f) => `benchmarks/${f}`).join(" ")}`
  try {
    execFileSync(
      "npx",
      ["vitest", "bench", "run", ...files.map((f) => `benchmarks/${f}`), "--config", "vitest.bench.config.ts", "--outputJson", output],
      { cwd: root, stdio: "inherit" }
    )
    const results = parseBenchJson(JSON.parse(readFileSync(output, "utf8")))
    // Every benchmark file must have produced at least one result.
    for (const file of files) {
      if (!Object.keys(results).some((name) => name.startsWith(`benchmarks/${file} `))) {
        throw new BenchError(`No results were recorded for benchmarks/${file}`)
      }
    }
    const vitest = JSON.parse(readFileSync(join(root, "node_modules/vitest/package.json"), "utf8")).version
    return {
      schemaVersion: SNAPSHOT_VERSION,
      meta: {
        date: new Date().toISOString(),
        commit: git("rev-parse --short HEAD"),
        dirty: git("status --porcelain") !== "",
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model ?? "unknown",
        runner: process.env.CI ? "ci" : "local",
        vitest,
        command,
        units: { hz: "ops/s", mean: "ms", p99: "ms", rme: "%" },
      },
      results,
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

try {
  const threshold = parseThreshold(option("--threshold") ?? process.env.BENCH_THRESHOLD)
  if (flag("--compare") && !existsSync(BASELINE_PATH)) {
    throw new BenchError(`No baseline at ${BASELINE_PATH}. Run with --save first.`)
  }
  // Validate the baseline before spending minutes on a run that cannot be compared.
  const baseline = flag("--compare")
    ? validateSnapshot(JSON.parse(readFileSync(BASELINE_PATH, "utf8")), "baseline")
    : undefined

  const current = runSuite()
  console.log(`\n${Object.keys(current.results).length} benchmark results (${current.meta.node}, ${current.meta.platform}/${current.meta.arch}, ${current.meta.runner}, commit ${current.meta.commit}${current.meta.dirty ? "+dirty" : ""})`)

  if (flag("--save")) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`)
    console.log(`Baseline saved → ${BASELINE_PATH}`)
  }
  if (baseline) {
    console.log(`\nComparing with the baseline from ${baseline.meta.date} (${baseline.meta.node}, ${baseline.meta.platform}/${baseline.meta.arch}, ${baseline.meta.runner}, commit ${baseline.meta.commit})\n`)
    const comparison = compareSnapshots(baseline, current, threshold)
    console.log(formatComparison(comparison, threshold))
    const verdict = decide(comparison, { mismatch: flag("--allow-mismatch"), removed: flag("--allow-removed") })
    for (const message of verdict.messages) console.log(`\n${verdict.code === 0 ? "ℹ" : "⚠"} ${message}`)
    console.log(
      verdict.code === 0
        ? `\n✅ No regressions at a ${threshold}% threshold`
        : verdict.code === 1
          ? "\n❌ Regressions detected"
          : "\n⛔ The comparison cannot be trusted (see above); no verdict on regressions"
    )
    process.exit(verdict.code)
  }
} catch (error) {
  console.error(error instanceof BenchError ? `Benchmark error: ${error.message}` : error)
  process.exit(2)
}
