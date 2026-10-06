# Orvaxis — Performance Benchmarks

Microbenchmarks for each execution layer. Numbers give you a baseline to reason about overhead and catch regressions over time. Reproduce them with `pnpm bench:run`.

---

## Running the benchmarks

```bash
pnpm bench:run      # one-shot, prints results and exits
pnpm bench          # watch mode, re-runs on file save
pnpm bench:save     # run and save current results as this machine's baseline
pnpm bench:compare  # run and compare against the saved baseline
```

Benchmarks live in `benchmarks/` and use [vitest bench](https://vitest.dev/guide/features.html#benchmarking) (built on [tinybench](https://github.com/tinylibs/tinybench)). No extra dependencies needed. Microbenchmarks (`policy`, `trace`, `router`, …) exercise one layer without I/O; `http.bench.ts` sends real requests over a loopback socket and is meant to be compared only with its own rows.

### Comparing runs

`bench:save` reads vitest's structured JSON output and writes `benchmarks/baseline.json` with the results and the environment they came from: commit (and whether the tree was dirty), Node version, platform, architecture, CPU, runner (`local` or `ci`), vitest version, the command, and units (`hz` in operations per second, `mean` and `p99` in milliseconds, `rme` in percent). The file is ignored by Git because a baseline is only meaningful on the machine and Node version that produced it.

`bench:compare` re-runs the suite and prints a before/after table. Its exit status never turns a problem into a pass:

| Exit | Meaning |
|---|---|
| 0 | Every baseline case was measured and none dropped by the threshold |
| 1 | At least one case dropped by the threshold or more |
| 2 | The comparison cannot be trusted: no or invalid baseline (including the old format), empty output, a non-positive or non-numeric measurement, a benchmark file without results, baseline cases missing from this run, or runs that differ in Node major version, platform, architecture or runner |

New cases are listed but do not fail. `--allow-removed` accepts missing cases and `--allow-mismatch` accepts a non-homogeneous comparison; neither hides regressions. The threshold is **15%** by default, set with `--threshold <percent>` or `BENCH_THRESHOLD` (above 0 and below 100).

```bash
pnpm bench:save                                  # on main, before your change
pnpm bench:compare                               # after it
pnpm bench:compare --threshold 20
```

> **On noise**: microbenchmarks in the nanosecond to microsecond range vary between runs because of JIT warm-up, garbage collection and CPU scheduling. Two consecutive runs on the same machine, with no code change, reported two cases (async hook listeners) beyond the 15% threshold. Treat a flagged case as a lead: run the comparison again and look at its `rme`. The repository's CI does not run `bench:compare` as a gate, because no threshold has been validated against shared-runner noise.

---

## Results

### Policy trace collection

Environment of these measurements: Apple M3 Pro, macOS arm64, Node.js v24.16.0 (launched through pnpm), vitest 4.1.5, commit 96f7667 plus uncommitted changes, 2026-10-06, local runner. Throughput is operations per second and `rme` is the relative margin of error reported by tinybench; when it is large, differences of that size are not meaningful. Command: `pnpm bench:save` (the full suite). Numbers describe this machine and workload only; they are not a promise about your cost.

**Policy engine microbenchmark** (`trace.bench.ts`, no routing or HTTP; each iteration also creates a context, identically in every row). Throughput in ops/s, `rme` in parentheses:

| Outcome | Policies | `off` | `summary` | `detailed` |
|---|---:|---:|---:|---:|
| allow | 1 | 975,574 (±8.7%) | 485,722 (±29.4%) | 466,969 (±28.6%) |
| allow | 5 | 710,051 (±6.6%) | 264,685 (±16.7%) | 281,031 (±19.4%) |
| allow | 20 | 337,771 (±5.5%) | 116,185 (±11.4%) | 121,739 (±7.8%) |
| deny | 1 | 245,207 (±8.4%) | 187,416 (±12.4%) | 185,349 (±16.6%) |
| deny | 5 | 235,237 (±6.3%) | 149,950 (±11.2%) | 153,104 (±11.0%) |
| deny | 20 | 173,183 (±4.1%) | 87,430 (±2.7%) | 83,728 (±9.5%) |

In this isolated workload, collecting decisions costs between roughly 1 µs (one policy) and 5.7 µs (20 allowed policies) per evaluation, which is a large relative share of the engine itself. `summary` and `detailed` are indistinguishable within their margins; these allow cases never call the redactor, and the denial rows include one redactor call. A denial is slower than an allow because it constructs and throws an `HttpError`.

**Truncation.** With 20 allowed policies in `summary` mode: `maxEvents` 1 → 149,313, 5 → 144,450, 100 → 119,290 ops/s (rme ±10–13%). With 20 policies ending in a denial: `maxEvents` 1 → 95,289 and 100 → 74,740 ops/s; the terminal decision is recorded in both. A smaller limit stores fewer events, so it is cheaper, but it also keeps less of the trace.

**Full runtime and HTTP.** Five always-allow policies through `app.handle()` (context, routing, JSON handler, no network): `off` 167,899 (±8.4%), `summary` 125,295 (±8.5%), `detailed` 122,877 (±10.5%) ops/s. Over a real loopback socket through Express, with five policies, 8,143 (`off`, allow), 9,158 (`summary`, allow), 9,495 (`off`, deny) and 9,357 (`summary`, deny) ops/s, rme ±3.7–4.7%: the differences between these four rows are within the noise, because socket and event-loop time dominate. A single run of the HTTP file under Node 22 measured about 600 ops/s, roughly an order of magnitude lower than under Node 24 here, so do not compare HTTP numbers across Node versions or machines.

**Policy ordering.** Policies are sorted by priority on every evaluation. `sortPolicies` alone: 1 policy 15.4M, 5 policies 5.7M, 20 policies 2.4M, 100 policies 613k ops/s, which is about 0.18 µs, 0.41 µs and 1.6 µs for 5, 20 and 100 policies. Against the 1.4 µs and 3.0 µs engine evaluation of 5 and 20 allowed policies with tracing off, that is a visible share of the engine alone and a small share of a full request. A cache is not implemented: policy arrays are plain mutable arrays (`register()` appends and route or group `policies` can be changed after declaration), and caching would first need a defined contract for mutation and invalidation. Revisit it if profiling a real application points at this sort.

### Historical results

These tables are historical measurements from an earlier runtime. They do not measure the current radix trie or the new default policy-decision collection; rerun the benchmarks on the release candidate before using numbers for capacity planning.

> Measured on Node.js 22, Linux x86_64. Your numbers will differ by hardware.
> Times are shown in milliseconds (ms), derived from the displayed throughput as `mean (ms) = 1,000 / hz`; `hz` means operations per second. The recorded throughput and means are rounded, so rerun the command above for measurements on your machine.

### Context creation

`createContext` is the first thing called on every request.

| Scenario | hz | mean (ms) |
|---|---|---|
| Minimal request | ~8,300,000 | 0.0001205 |
| Request with headers + id | ~5,100,000 | 0.0001961 |
| Including `createMockResponse` | ~6,200,000 | 0.0001613 |

Context creation is effectively free — the bottleneck will always be elsewhere.

---

### Pipeline

Cost scales linearly with middleware count. State mutation inside middleware adds measurable overhead due to property writes on `ctx.state`.

**Pass-through middleware**

| Middleware count | hz | mean (ms) | vs 1 mw |
|---|---|---|---|
| 1 | ~1,820,000 | 0.0005495 | — |
| 5 | ~880,000 | 0.0011364 | 2.1x slower |
| 20 | ~353,000 | 0.0028329 | 5.2x slower |

**State-mutating middleware**

| Middleware count | hz | mean (ms) | vs 1 mw |
|---|---|---|---|
| 1 | ~1,600,000 | 0.0006250 | — |
| 5 | ~554,000 | 0.0018051 | 2.9x slower |
| 20 | ~183,000 | 0.0054645 | 8.7x slower |

Most real pipelines have 3–8 middleware. At that count, pipeline overhead is well under 2µs per request.

---

### Policy engine

Each call to `evaluate()` clones and sorts the policy list by priority — the dominant cost at scale.

| Policy count | hz | mean (ms) | vs 1 policy |
|---|---|---|---|
| 1 | ~1,800,000 | 0.0005556 | — |
| 5 | ~768,000 | 0.0013021 | 2.3x slower |
| 20 | ~285,000 | 0.0035088 | 6.3x slower |

**Scope and modification overhead**

| Scenario | hz | mean (ms) |
|---|---|---|
| `allow` + `modify` (meta injection) | ~1,320,000 | 0.0007576 |
| Scope: string path match | ~1,510,000 | 0.0006623 |
| Scope: string path miss (skipped) | ~1,700,000 | 0.0005882 |
| Scope: regex path match | ~1,110,000 | 0.0009009 |

Path misses are faster than matches — a scoped policy that doesn't apply is nearly free. Regex scopes cost ~30% more than string scopes.

> If you register many policies, keep priority values stable (don't use dynamic values) and prefer string scopes over regex where possible.

---

### Hook system

Both sync and async listeners have nearly identical throughput — the `await` wrapper overhead is negligible for listeners that return immediately.

**`onRequest` — sync listeners**

| Listeners | hz | mean (ms) | vs 1 listener |
|---|---|---|---|
| 1 | ~2,035,000 | 0.0004914 | — |
| 5 | ~1,080,000 | 0.0009259 | 1.9x slower |
| 10 | ~567,000 | 0.0017637 | 3.6x slower |

**`onRequest` — async listeners**

| Listeners | hz | mean (ms) | vs 1 listener |
|---|---|---|---|
| 1 | ~1,970,000 | 0.0005076 | — |
| 5 | ~989,000 | 0.0010111 | 2.0x slower |
| 10 | ~592,000 | 0.0016892 | 3.3x slower |

---

### Tracer

The tracer wraps `Date.now()` calls and pushes to an internal array. Overhead versus a plain array grows with event count.

| Scenario | hz | mean (ms) |
|---|---|---|
| Plain array (no tracer, 2 pushes) | ~4,310,000 | 0.0002320 |
| Tracer — 2 events | ~1,960,000 | 0.0005102 |
| Tracer — 5 events | ~1,710,000 | 0.0005848 |
| Tracer — 20 events | ~500,000 | 0.0020000 |

The tracer is **~2.2x slower** than a raw array at equivalent event counts. For typical request tracing (5–8 events), the absolute cost is under 1µs.

---

### Router

The current router uses a radix trie with static → parameter → wildcard priority. The historical table below measured the former linear-scan implementation and is retained for comparison only.

**Small table (5 routes)**

| Scenario | hz | mean (ms) |
|---|---|---|
| Hit first route | ~853,000 | 0.0011723 |
| Hit last route | ~231,000 | 0.0043290 |
| No match (wrong path) | ~1,688,000 | 0.0005924 |
| No match (wrong method) | ~2,177,000 | 0.0004593 |

**Large table (50 routes, 5 groups)**

| Scenario | hz | mean (ms) |
|---|---|---|
| Hit first group, first route | ~459,000 | 0.0021786 |
| Hit last group, last route | ~65,500 | 0.0152672 |
| No match | ~913,000 | 0.0010953 |

**Param routes**

| Scenario | hz | mean (ms) |
|---|---|---|
| Match with `:id` param | ~174,000 | 0.0057471 |

Registration order does not determine matching cost in the current trie; path depth and the need for backtracking do.

---

### Full pipeline overhead

End-to-end cost of `app.handle()` — the call an HTTP adapter makes for every request. Includes context creation, tracer, request validation, routing, policies, hooks, middleware, and handler. Compared against a bare `createContext + handler` call with no Orvaxis involved.

| Scenario | hz | mean (ms) | overhead vs baseline |
|---|---|---|---|
| Baseline: `createContext` + direct handler | ~2,900,000 | 0.0003448 | — |
| Orvaxis minimal: routing only (0 policies · 0 middleware · 0 hooks) | ~126,000 | 0.0079365 | +7.6µs |
| Orvaxis typical: 1 policy · 3 middleware · 2 hooks | ~103,000 | 0.0097087 | +9.4µs |
| Orvaxis heavy: 3 policies · 5 middleware · 5 hooks | ~81,000 | 0.0123457 | +12.1µs |

The fixed cost of a minimal Orvaxis request is ~7.6µs, driven by `AsyncLocalStorage` context propagation, `crypto.randomUUID()` for the request tracer, and the route lookup. Policies, middleware, and hooks add incrementally on top.

These historical pipeline values do not establish the overhead of the current release. Measure your own workload, including framework parsing, serialization, policy tracing, and application I/O.

---

## Reading the numbers

All measurements are isolated microbenchmarks — they do not include network I/O, JSON serialization, or framework overhead. Real request latency will be dominated by those factors.

Use these numbers to:
- **Compare layers against each other** — e.g. a 20-policy engine costs about the same as a 5-middleware pipeline
- **Detect regressions** — run `bench:run` before and after a change to a core module
- **Set expectations** — the total overhead of a typical Orvaxis request (1 policy, 3 middleware, 5 trace events, 1 hook) is around 5–10µs, excluding handler execution
