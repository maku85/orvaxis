# Orvaxis — Performance Benchmarks

Microbenchmarks for each execution layer. Numbers give you a baseline to reason about overhead and catch regressions over time.

---

## Running the benchmarks

```bash
pnpm bench:run      # one-shot, prints results and exits
pnpm bench          # watch mode, re-runs on file save
pnpm bench:save     # run and save current results as baseline
pnpm bench:compare  # run and compare against saved baseline
```

Benchmarks live in `benchmarks/` and use [vitest bench](https://vitest.dev/guide/features.html#benchmarking) (built on [tinybench](https://github.com/tinylibs/tinybench)). No extra dependencies needed.

### Detecting regressions

`bench:save` writes `benchmarks/baseline.json` with the current results. `bench:compare` re-runs the suite, prints a diff table, and exits with code 1 if any benchmark drops more than **15%** (the default threshold for natural microbenchmark noise).

```bash
# typical workflow before merging a PR
pnpm bench:save          # save baseline on main
# ... make changes ...
pnpm bench:compare       # compare — exits 1 if a regression is found
```

To use a stricter or looser threshold:

```bash
BENCH_THRESHOLD=20 pnpm bench:compare   # flag only drops > 20%
```

> **On noise**: microbenchmarks in the nanosecond range have natural run-to-run variance of ±10–20% due to JIT warm-up, GC pauses, and CPU scheduling. A 15% threshold filters out noise while catching real regressions, which typically show as ≥30% drops. Always confirm a flagged regression by running `bench:compare` twice — if it disappears, it was noise.

---

## Results

> Measured on Node.js 22, Linux x86_64. Your numbers will differ by hardware.
> All times are in microseconds (µs). `hz` = operations per second.

### Context creation

`createContext` is the first thing called on every request.

| Scenario | hz | mean (µs) |
|---|---|---|
| Minimal request | ~8,300,000 | 0.0001 |
| Request with headers + id | ~5,100,000 | 0.0002 |
| Including `createMockResponse` | ~6,200,000 | 0.0002 |

Context creation is effectively free — the bottleneck will always be elsewhere.

---

### Pipeline

Cost scales linearly with middleware count. State mutation inside middleware adds measurable overhead due to property writes on `ctx.state`.

**Pass-through middleware**

| Middleware count | hz | mean (µs) | vs 1 mw |
|---|---|---|---|
| 1 | ~1,820,000 | 0.0005 | — |
| 5 | ~880,000 | 0.0011 | 2.1x slower |
| 20 | ~353,000 | 0.0028 | 5.2x slower |

**State-mutating middleware**

| Middleware count | hz | mean (µs) | vs 1 mw |
|---|---|---|---|
| 1 | ~1,600,000 | 0.0006 | — |
| 5 | ~554,000 | 0.0018 | 2.9x slower |
| 20 | ~183,000 | 0.0055 | 8.7x slower |

Most real pipelines have 3–8 middleware. At that count, pipeline overhead is well under 2µs per request.

---

### Policy engine

Each call to `evaluate()` clones and sorts the policy list by priority — the dominant cost at scale.

| Policy count | hz | mean (µs) | vs 1 policy |
|---|---|---|---|
| 1 | ~1,800,000 | 0.0006 | — |
| 5 | ~768,000 | 0.0013 | 2.3x slower |
| 20 | ~285,000 | 0.0035 | 6.3x slower |

**Scope and modification overhead**

| Scenario | hz | mean (µs) |
|---|---|---|
| `allow` + `modify` (meta injection) | ~1,320,000 | 0.0008 |
| Scope: string path match | ~1,510,000 | 0.0007 |
| Scope: string path miss (skipped) | ~1,700,000 | 0.0006 |
| Scope: regex path match | ~1,110,000 | 0.0009 |

Path misses are faster than matches — a scoped policy that doesn't apply is nearly free. Regex scopes cost ~30% more than string scopes.

> If you register many policies, keep priority values stable (don't use dynamic values) and prefer string scopes over regex where possible.

---

### Hook system

Both sync and async listeners have nearly identical throughput — the `await` wrapper overhead is negligible for listeners that return immediately.

**`onRequest` — sync listeners**

| Listeners | hz | mean (µs) | vs 1 listener |
|---|---|---|---|
| 1 | ~2,035,000 | 0.0005 | — |
| 5 | ~1,080,000 | 0.0009 | 1.9x slower |
| 10 | ~567,000 | 0.0018 | 3.6x slower |

**`onRequest` — async listeners**

| Listeners | hz | mean (µs) | vs 1 listener |
|---|---|---|---|
| 1 | ~1,970,000 | 0.0005 | — |
| 5 | ~989,000 | 0.0010 | 2.0x slower |
| 10 | ~592,000 | 0.0017 | 3.3x slower |

---

### Tracer

The tracer wraps `Date.now()` calls and pushes to an internal array. Overhead versus a plain array grows with event count.

| Scenario | hz | mean (µs) |
|---|---|---|
| Plain array (no tracer, 2 pushes) | ~4,310,000 | 0.0002 |
| Tracer — 2 events | ~1,960,000 | 0.0005 |
| Tracer — 5 events | ~1,710,000 | 0.0006 |
| Tracer — 20 events | ~500,000 | 0.0020 |

The tracer is **~2.2x slower** than a raw array at equivalent event counts. For typical request tracing (5–8 events), the absolute cost is under 1µs.

---

### Router

Route matching is a linear scan over groups and routes. The cost is proportional to position in the list.

**Small table (5 routes)**

| Scenario | hz | mean (µs) |
|---|---|---|
| Hit first route | ~853,000 | 0.0012 |
| Hit last route | ~231,000 | 0.0043 |
| No match (wrong path) | ~1,688,000 | 0.0006 |
| No match (wrong method) | ~2,177,000 | 0.0005 |

**Large table (50 routes, 5 groups)**

| Scenario | hz | mean (µs) |
|---|---|---|
| Hit first group, first route | ~459,000 | 0.0022 |
| Hit last group, last route | ~65,500 | 0.0153 |
| No match | ~913,000 | 0.0011 |

**Param routes**

| Scenario | hz | mean (µs) |
|---|---|---|
| Match with `:id` param | ~174,000 | 0.0057 |

No-match exits early at the group prefix check, which is why it outperforms a hit on the last route. Registering high-traffic routes in the first group and early in the route list measurably reduces matching cost.

---

### Full pipeline overhead

End-to-end cost of `app.handle()` — the call an HTTP adapter makes for every request. Includes context creation, tracer, request validation, routing, policies, hooks, middleware, and handler. Compared against a bare `createContext + handler` call with no Orvaxis involved.

| Scenario | hz | mean (µs) | overhead vs baseline |
|---|---|---|---|
| Baseline: `createContext` + direct handler | ~2,900,000 | 0.0003 | — |
| Orvaxis minimal: routing only (0 policies · 0 middleware · 0 hooks) | ~126,000 | 0.0079 | +7.6µs |
| Orvaxis typical: 1 policy · 3 middleware · 2 hooks | ~103,000 | 0.0097 | +9.4µs |
| Orvaxis heavy: 3 policies · 5 middleware · 5 hooks | ~81,000 | 0.0124 | +12.1µs |

The fixed cost of a minimal Orvaxis request is ~7.6µs, driven by `AsyncLocalStorage` context propagation, `crypto.randomUUID()` for the request tracer, and the route lookup. Policies, middleware, and hooks add incrementally on top.

To put this in perspective: a typical Express route handler (including framework parsing and routing) takes 50–150µs. Orvaxis adds 8–12µs on top, representing roughly 5–15% overhead depending on the workload — well within acceptable range for the observability and control it provides.

---

## Reading the numbers

All measurements are isolated microbenchmarks — they do not include network I/O, JSON serialization, or framework overhead. Real request latency will be dominated by those factors.

Use these numbers to:
- **Compare layers against each other** — e.g. a 20-policy engine costs about the same as a 5-middleware pipeline
- **Detect regressions** — run `bench:run` before and after a change to a core module
- **Set expectations** — the total overhead of a typical Orvaxis request (1 policy, 3 middleware, 5 trace events, 1 hook) is around 5–10µs, excluding handler execution
