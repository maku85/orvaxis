import { describe, expect, it } from "vitest"
import {
  BenchError,
  type BenchSnapshot,
  compareSnapshots,
  decide,
  formatComparison,
  parseBenchJson,
  parseThreshold,
  validateSnapshot,
} from "../benchmarks/lib"

const entry = (hz: number) => ({ hz, mean: 1000 / hz, p99: 2000 / hz, rme: 1 })
const meta = (over: Partial<BenchSnapshot["meta"]> = {}): BenchSnapshot["meta"] => ({
  date: "2026-10-06T00:00:00.000Z",
  commit: "abc1234",
  dirty: false,
  node: "v22.23.2",
  platform: "darwin",
  arch: "arm64",
  cpu: "test",
  runner: "local",
  vitest: "4.1.5",
  command: "vitest bench run",
  units: { hz: "ops/s", mean: "ms", p99: "ms", rme: "%" },
  ...over,
})
const snapshot = (
  results: Record<string, ReturnType<typeof entry>>,
  over?: Partial<BenchSnapshot["meta"]>
): BenchSnapshot => ({
  schemaVersion: 2,
  meta: meta(over),
  results,
})
const vitestJson = (benches: Record<string, unknown>[]) => ({
  files: [
    {
      filepath: "/x/a.bench.ts",
      groups: [{ fullName: "benchmarks/a.bench.ts > Suite", benchmarks: benches }],
    },
  ],
})

describe("parseBenchJson", () => {
  it("reads vitest's structured output", () => {
    const parsed = parseBenchJson(
      vitestJson([{ name: "one", hz: 1000, mean: 1, p99: 2, rme: 0.5 }])
    )
    expect(parsed["benchmarks/a.bench.ts > Suite > one"]).toEqual({
      hz: 1000,
      mean: 1,
      p99: 2,
      rme: 0.5,
    })
  })

  it.each([
    ["no files", {}],
    ["empty files", { files: [] }],
    ["files without benchmarks", { files: [{ groups: [{ fullName: "g", benchmarks: [] }] }] }],
  ])("fails on empty output (%s)", (_label, json) => {
    expect(() => parseBenchJson(json)).toThrow(BenchError)
  })

  it.each([
    ["NaN throughput", { hz: Number.NaN }],
    ["zero throughput", { hz: 0 }],
    ["negative mean", { mean: -1 }],
    ["string p99", { p99: "fast" }],
    ["infinite rme", { rme: Number.POSITIVE_INFINITY }],
  ])("fails on invalid numbers (%s)", (_label, override) => {
    const bench = { name: "one", hz: 10, mean: 1, p99: 2, rme: 1, ...override }
    expect(() => parseBenchJson(vitestJson([bench]))).toThrow(/Invalid/)
  })

  it("fails on duplicate names", () => {
    const bench = { name: "one", hz: 10, mean: 1, p99: 2, rme: 1 }
    expect(() => parseBenchJson(vitestJson([bench, bench]))).toThrow(/Duplicate/)
  })
})

describe("validateSnapshot", () => {
  it("rejects the legacy empty baseline and other unusable files", () => {
    expect(() => validateSnapshot({ date: "x", node: "v22", results: {} }, "baseline")).toThrow(
      /schemaVersion/
    )
    expect(() => validateSnapshot(snapshot({}), "baseline")).toThrow(/no results/)
    expect(() => validateSnapshot(null, "baseline")).toThrow(BenchError)
    expect(() =>
      validateSnapshot({ ...snapshot({ a: entry(1) }), meta: undefined }, "baseline")
    ).toThrow(/no meta/)
    expect(() => validateSnapshot(snapshot({ a: { ...entry(1), hz: 0 } }), "baseline")).toThrow(
      /Invalid hz/
    )
  })

  it("accepts a complete snapshot", () => {
    expect(validateSnapshot(snapshot({ a: entry(100) }), "baseline").results.a.hz).toBe(100)
  })
})

describe("parseThreshold", () => {
  it("defaults to 15 and validates input", () => {
    expect(parseThreshold(undefined)).toBe(15)
    expect(parseThreshold("20")).toBe(20)
    for (const bad of ["0", "-5", "100", "abc", "NaN"])
      expect(() => parseThreshold(bad)).toThrow(BenchError)
  })
})

describe("compareSnapshots and decide", () => {
  const base = snapshot({ a: entry(1000), b: entry(1000), c: entry(1000) })

  it("passes only when every case is present and within the threshold", () => {
    const current = snapshot({ a: entry(950), b: entry(1100), c: entry(1000) })
    const result = compareSnapshots(base, current, 15)
    expect(result.regressions).toEqual([])
    expect(decide(result).code).toBe(0)
  })

  it("flags regressions with exit 1 and improvements without failing", () => {
    const current = snapshot({ a: entry(800), b: entry(1300), c: entry(1000) })
    const result = compareSnapshots(base, current, 15)
    expect(result.regressions.map((r) => r.name)).toEqual(["a"])
    expect(result.rows.find((r) => r.name === "b")?.status).toBe("improvement")
    expect(decide(result).code).toBe(1)
    expect(formatComparison(result, 15)).toContain("-20.0%")
  })

  it("does not pass when baseline cases disappeared, unless explicitly allowed", () => {
    const result = compareSnapshots(base, snapshot({ a: entry(1000) }), 15)
    expect(result.removed.map((r) => r.name)).toEqual(["b", "c"])
    expect(decide(result).code).toBe(2)
    expect(decide(result, { removed: true }).code).toBe(0)
  })

  it("reports new cases without failing", () => {
    const result = compareSnapshots(
      base,
      snapshot({ a: entry(1000), b: entry(1000), c: entry(1000), d: entry(5) }),
      15
    )
    expect(result.added.map((r) => r.name)).toEqual(["d"])
    const verdict = decide(result)
    expect(verdict.code).toBe(0)
    expect(verdict.messages.join()).toMatch(/new case/)
  })

  it("refuses non-homogeneous comparisons, even over a regression", () => {
    const current = snapshot(
      { a: entry(500), b: entry(1000), c: entry(1000) },
      { node: "v24.1.0", runner: "ci" }
    )
    const result = compareSnapshots(base, current, 15)
    expect(result.mismatches).toEqual(["Node v22.23.2 vs v24.1.0", "runner local vs ci"])
    expect(decide(result).code).toBe(2)
    expect(decide(result, { mismatch: true }).code).toBe(1)
  })

  it("tolerates a differing Node minor version", () => {
    const current = snapshot(
      { a: entry(1000), b: entry(1000), c: entry(1000) },
      { node: "v22.99.0" }
    )
    expect(compareSnapshots(base, current, 15).mismatches).toEqual([])
  })
})
