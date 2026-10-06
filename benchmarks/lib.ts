// Pure helpers for benchmarks/compare.ts, kept free of I/O so tests/benchCompare.test.ts can cover
// every failure mode with fixtures.

export const SNAPSHOT_VERSION = 2
export const DEFAULT_THRESHOLD = 15

export type BenchEntry = { hz: number; mean: number; p99: number; rme: number }

export type SnapshotMeta = {
  date: string
  commit: string
  dirty: boolean
  node: string
  platform: string
  arch: string
  cpu: string
  runner: "ci" | "local"
  vitest: string
  command: string
  /** Throughput is operations per second; `mean` and `p99` are milliseconds; `rme` is percent. */
  units: { hz: "ops/s"; mean: "ms"; p99: "ms"; rme: "%" }
}

export type BenchSnapshot = {
  schemaVersion: typeof SNAPSHOT_VERSION
  meta: SnapshotMeta
  results: Record<string, BenchEntry>
}

export class BenchError extends Error {}

type VitestBenchJson = {
  files?: { filepath?: string; groups?: { fullName?: string; benchmarks?: Record<string, unknown>[] }[] }[]
}

/** Read vitest's `--outputJson` structure; anything unexpected is an error, never an empty result. */
export function parseBenchJson(json: unknown): Record<string, BenchEntry> {
  const files = (json as VitestBenchJson | null)?.files
  if (!Array.isArray(files)) throw new BenchError("Benchmark output has no 'files' array")
  const results: Record<string, BenchEntry> = {}
  for (const file of files) {
    for (const group of file.groups ?? []) {
      for (const bench of group.benchmarks ?? []) {
        const name = `${group.fullName ?? file.filepath ?? "?"} > ${String(bench.name)}`
        if (name in results) throw new BenchError(`Duplicate benchmark name: ${name}`)
        results[name] = {
          hz: positive(bench.hz, name, "hz"),
          mean: positive(bench.mean, name, "mean"),
          p99: positive(bench.p99, name, "p99"),
          rme: nonNegative(bench.rme, name, "rme"),
        }
      }
    }
  }
  if (Object.keys(results).length === 0) throw new BenchError("Benchmark output contains no results")
  return results
}

function positive(value: unknown, name: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new BenchError(`Invalid ${field} (${String(value)}) for benchmark: ${name}`)
  }
  return value
}

function nonNegative(value: unknown, name: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new BenchError(`Invalid ${field} (${String(value)}) for benchmark: ${name}`)
  }
  return value
}

/** Validate a stored baseline; an empty or foreign file must never read as "no regressions". */
export function validateSnapshot(value: unknown, label: string): BenchSnapshot {
  const snapshot = value as Partial<BenchSnapshot> | null
  if (!snapshot || typeof snapshot !== "object") throw new BenchError(`The ${label} is not an object`)
  if (snapshot.schemaVersion !== SNAPSHOT_VERSION) {
    throw new BenchError(
      `The ${label} has schemaVersion ${String(snapshot.schemaVersion)}, expected ${SNAPSHOT_VERSION}; regenerate it with 'pnpm bench:save'`
    )
  }
  if (!snapshot.meta || typeof snapshot.meta !== "object") throw new BenchError(`The ${label} has no meta`)
  const results = snapshot.results
  if (!results || typeof results !== "object" || Object.keys(results).length === 0) {
    throw new BenchError(`The ${label} contains no results`)
  }
  for (const [name, entry] of Object.entries(results)) {
    positive(entry?.hz, name, "hz")
    positive(entry?.mean, name, "mean")
    positive(entry?.p99, name, "p99")
    nonNegative(entry?.rme, name, "rme")
  }
  return snapshot as BenchSnapshot
}

export function parseThreshold(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_THRESHOLD
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || value >= 100) {
    throw new BenchError(`Threshold must be a number above 0 and below 100 (percent), received '${raw}'`)
  }
  return value
}

export type Row = {
  name: string
  status: "regression" | "improvement" | "unchanged" | "new" | "removed"
  before?: number
  after?: number
  deltaPercent?: number
}

export type Comparison = {
  rows: Row[]
  /** Reasons the two runs are not comparable (different Node major, platform, architecture, runner). */
  mismatches: string[]
  regressions: Row[]
  removed: Row[]
  added: Row[]
}

export function compareSnapshots(
  baseline: BenchSnapshot,
  current: BenchSnapshot,
  threshold: number
): Comparison {
  const rows: Row[] = []
  for (const [name, now] of Object.entries(current.results)) {
    const was = baseline.results[name]
    if (!was) {
      rows.push({ name, status: "new", after: now.hz })
      continue
    }
    const deltaPercent = ((now.hz - was.hz) / was.hz) * 100
    const status =
      deltaPercent <= -threshold ? "regression" : deltaPercent >= threshold ? "improvement" : "unchanged"
    rows.push({ name, status, before: was.hz, after: now.hz, deltaPercent })
  }
  for (const [name, was] of Object.entries(baseline.results)) {
    if (!(name in current.results)) rows.push({ name, status: "removed", before: was.hz })
  }
  const a = baseline.meta
  const b = current.meta
  const mismatches: string[] = []
  const major = (version: string) => version.replace(/^v/, "").split(".")[0]
  if (major(a.node) !== major(b.node)) mismatches.push(`Node ${a.node} vs ${b.node}`)
  for (const field of ["platform", "arch", "runner"] as const) {
    if (a[field] !== b[field]) mismatches.push(`${field} ${a[field]} vs ${b[field]}`)
  }
  return {
    rows,
    mismatches,
    regressions: rows.filter((row) => row.status === "regression"),
    removed: rows.filter((row) => row.status === "removed"),
    added: rows.filter((row) => row.status === "new"),
  }
}

export function formatHz(hz: number): string {
  return hz >= 1_000_000
    ? `${(hz / 1_000_000).toFixed(2)}M/s`
    : hz >= 1_000
      ? `${(hz / 1_000).toFixed(1)}k/s`
      : `${hz.toFixed(0)}/s`
}

export function formatComparison(comparison: Comparison, threshold: number): string {
  const label = { regression: "❌", improvement: "✅", unchanged: "  ", new: "🆕", removed: "🗑 " }
  const nameWidth = Math.max(...comparison.rows.map((row) => row.name.length), 9)
  const lines = [`${"Benchmark".padEnd(nameWidth)}  ${"Before".padStart(11)}  ${"After".padStart(11)}  ${"Δ".padStart(8)}`]
  for (const row of comparison.rows) {
    const delta =
      row.deltaPercent === undefined
        ? row.status
        : `${row.deltaPercent >= 0 ? "+" : ""}${row.deltaPercent.toFixed(1)}%`
    lines.push(
      `${label[row.status]} ${row.name.padEnd(nameWidth)}  ${(row.before === undefined ? "—" : formatHz(row.before)).padStart(11)}  ${(row.after === undefined ? "—" : formatHz(row.after)).padStart(11)}  ${delta.padStart(8)}`
    )
  }
  lines.push(
    "",
    `Threshold: a throughput drop of ${threshold}% or more is reported as a regression. Microbenchmarks vary between runs; confirm a flagged case by running the comparison again.`
  )
  return lines.join("\n")
}

/**
 * Exit status: 0 clean, 1 regression, 2 the comparison cannot be trusted (incomplete or
 * non-homogeneous). `allow` relaxes one kind of problem at a time and never hides regressions.
 */
export function decide(
  comparison: Comparison,
  allow: { mismatch?: boolean; removed?: boolean } = {}
): { code: 0 | 1 | 2; messages: string[] } {
  const messages: string[] = []
  let invalid = false
  if (comparison.mismatches.length > 0) {
    messages.push(`Runs are not homogeneous: ${comparison.mismatches.join("; ")}`)
    if (!allow.mismatch) invalid = true
  }
  if (comparison.removed.length > 0) {
    messages.push(
      `${comparison.removed.length} baseline case(s) missing from this run: ${comparison.removed.map((r) => r.name).join("; ")}`
    )
    if (!allow.removed) invalid = true
  }
  if (comparison.added.length > 0) {
    messages.push(`${comparison.added.length} new case(s) not in the baseline (refresh it with 'pnpm bench:save')`)
  }
  if (comparison.regressions.length > 0) {
    messages.push(`${comparison.regressions.length} regression(s): ${comparison.regressions.map((r) => r.name).join("; ")}`)
  }
  // An untrustworthy comparison outranks a regression it may have produced.
  return { code: invalid ? 2 : comparison.regressions.length > 0 ? 1 : 0, messages }
}
