import type { PolicyInspection, RouteInspection } from "../types/index.js"

type Applicability = PolicyInspection["applicability"]

export type ProtectionEntry = {
  name: string
  layer: PolicyInspection["layer"]
  phase: PolicyInspection["phase"]
  scope?: PolicyInspection["scope"]
  /** `conditional` covers regular expressions, predicates and path-dependent scopes. */
  applicability: Applicability["status"]
  reason: Applicability["reason"]
}

export type ProtectionRoute = {
  method: string
  /** Full route template including the group prefix. */
  path: string
  policies: ProtectionEntry[]
}

export type ProtectionReport = {
  schemaVersion: 1
  routes: ProtectionRoute[]
}

type RouteKey = { method: string; path: string }

export type ProtectionChange =
  | { kind: "route-added"; route: RouteKey; policies: number }
  | { kind: "route-removed"; route: RouteKey }
  | { kind: "policy-added"; route: RouteKey; policy: ProtectionEntry }
  | { kind: "policy-removed"; route: RouteKey; policy: ProtectionEntry }
  | {
      kind: "policy-changed"
      route: RouteKey
      before: ProtectionEntry
      after: ProtectionEntry
      /** The policy applies less often than before (always → conditional/never, conditional → never). */
      weakened: boolean
    }

export type ProtectionViolationKind = "policy-removed" | "policy-weakened"

export type ProtectionViolation = {
  kind: ProtectionViolationKind
  route: RouteKey
  policy: string
  message: string
}

export type ProtectionDiffOptions = {
  /**
   * Change kinds that fail the comparison. Empty by default: a diff reports changes, and only
   * the kinds listed here become violations.
   */
  failOn?: readonly ProtectionViolationKind[]
}

export type ProtectionDiff = {
  schemaVersion: 1
  changes: ProtectionChange[]
  violations: ProtectionViolation[]
  passed: boolean
}

const PHASES = ["preValidation", "postValidation"] as const
const LAYERS = ["global", "group", "route"] as const
const RANK: Record<ProtectionEntry["applicability"], number> = {
  never: 0,
  conditional: 1,
  always: 2,
}

/**
 * Describe which declared policies attach to each route, deterministically and statically.
 * Nothing is executed: no handler, evaluator or scope predicate runs. A policy being attached
 * does not prove that it authorizes correctly; `conditional` entries depend on request data.
 * Declaration indexes, priorities and evaluation order are left out so that reordering
 * declarations does not change the report.
 */
export function buildProtectionReport(routes: readonly RouteInspection[]): ProtectionReport {
  return {
    schemaVersion: 1,
    routes: routes
      .map((route) => ({
        method: route.method,
        path: route.path,
        policies: route.policies.map(toEntry).sort(compareEntries),
      }))
      .sort((a, b) => compareText(a.path, b.path) || compareText(a.method, b.method)),
  }
}

/** Compare a stored baseline with the current report. Additions are reported, not failed. */
export function diffProtectionReports(
  baseline: ProtectionReport,
  current: ProtectionReport,
  options: ProtectionDiffOptions = {}
): ProtectionDiff {
  assertReport(baseline, "baseline")
  assertReport(current, "current")
  const before = new Map(baseline.routes.map((route) => [routeId(route), route]))
  const after = new Map(current.routes.map((route) => [routeId(route), route]))
  const changes: ProtectionChange[] = []

  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort(compareText)) {
    const previous = before.get(id)
    const next = after.get(id)
    if (previous && !next) {
      changes.push({ kind: "route-removed", route: routeKey(previous) })
    } else if (!previous && next) {
      changes.push({ kind: "route-added", route: routeKey(next), policies: next.policies.length })
    } else if (previous && next) {
      changes.push(...diffRoute(previous, next))
    }
  }

  const failOn = new Set(options.failOn ?? [])
  const violations: ProtectionViolation[] = []
  for (const change of changes) {
    if (change.kind === "policy-removed" && change.policy.applicability !== "never") {
      if (failOn.has("policy-removed")) {
        violations.push({
          kind: "policy-removed",
          route: change.route,
          policy: change.policy.name,
          message: `${change.policy.layer} policy ${change.policy.name} was removed`,
        })
      }
    } else if (
      change.kind === "policy-changed" &&
      change.weakened &&
      failOn.has("policy-weakened")
    ) {
      violations.push({
        kind: "policy-weakened",
        route: change.route,
        policy: change.after.name,
        message: `${change.after.layer} policy ${change.after.name} now applies ${change.after.applicability} (was ${change.before.applicability})`,
      })
    }
  }
  return { schemaVersion: 1, changes, violations, passed: violations.length === 0 }
}

/** Markdown table of the report, for pull request summaries and artifacts. */
export function formatProtectionReportMarkdown(report: ProtectionReport): string {
  assertReport(report, "report")
  const lines = [
    "# Route protection report",
    "",
    "Static declarations only. A listed policy does not prove that requests are authorized correctly, and `conditional` policies depend on request data.",
    "",
  ]
  if (report.routes.length === 0) return `${lines.join("\n")}No routes.\n`
  lines.push("| Route | Phase | Layer | Policy | Applies | Scope |", "|---|---|---|---|---|---|")
  for (const route of report.routes) {
    const label = cell(`${route.method} ${route.path}`)
    if (route.policies.length === 0) {
      lines.push(`| ${label} | — | — | _none_ | — | — |`)
      continue
    }
    for (const policy of route.policies) {
      lines.push(
        `| ${label} | ${policy.phase} | ${policy.layer} | ${cell(policy.name)} | ${policy.applicability} | ${cell(describeScope(policy.scope))} |`
      )
    }
  }
  return `${lines.join("\n")}\n`
}

/** Markdown summary of a comparison: violations first, then every change. */
export function formatProtectionDiffMarkdown(diff: ProtectionDiff): string {
  const lines = ["# Route protection changes", ""]
  lines.push(
    diff.changes.length === 0
      ? "No changes against the baseline."
      : `${diff.changes.length} change(s) against the baseline. Changes are informational unless listed as violations.`,
    ""
  )
  if (diff.violations.length > 0) {
    lines.push("## Violations", "")
    for (const violation of diff.violations) {
      lines.push(
        `- ${code(`${violation.route.method} ${violation.route.path}`)}: ${violation.message}`
      )
    }
    lines.push("")
  }
  if (diff.changes.length > 0) {
    lines.push("## Changes", "")
    for (const change of diff.changes) lines.push(`- ${describeChange(change)}`)
    lines.push("")
  }
  return lines.join("\n")
}

function describeChange(change: ProtectionChange): string {
  const route = code(`${change.route.method} ${change.route.path}`)
  switch (change.kind) {
    case "route-added":
      return `Route added ${route} (${change.policies} polic${change.policies === 1 ? "y" : "ies"})`
    case "route-removed":
      return `Route removed ${route}`
    case "policy-added":
      return `Policy added on ${route}: ${describeEntry(change.policy)}`
    case "policy-removed":
      return `Policy removed on ${route}: ${describeEntry(change.policy)}`
    case "policy-changed":
      return `Policy changed on ${route}${change.weakened ? " (applies less)" : ""}: ${describeEntry(change.before)} → ${describeEntry(change.after)}`
  }
}

function describeEntry(entry: ProtectionEntry): string {
  const scope = entry.scope ? `, scope ${describeScope(entry.scope)}` : ""
  return `${code(entry.name)} (${entry.layer}, ${entry.phase}, ${entry.applicability}${scope})`
}

function diffRoute(previous: ProtectionRoute, next: ProtectionRoute): ProtectionChange[] {
  const route = routeKey(next)
  const changes: ProtectionChange[] = []
  const groups = new Map<string, { before: ProtectionEntry[]; after: ProtectionEntry[] }>()
  const group = (entry: ProtectionEntry) => {
    const key = `${entry.layer}\u0000${entry.name}`
    const existing = groups.get(key)
    if (existing) return existing
    const created = { before: [], after: [] }
    groups.set(key, created)
    return created
  }
  for (const entry of previous.policies) group(entry).before.push(entry)
  for (const entry of next.policies) group(entry).after.push(entry)

  for (const key of [...groups.keys()].sort(compareText)) {
    const { before, after } = groups.get(key) as {
      before: ProtectionEntry[]
      after: ProtectionEntry[]
    }
    const unmatchedBefore: ProtectionEntry[] = []
    const remaining = [...after]
    const pairs: [ProtectionEntry, ProtectionEntry][] = []
    for (const entry of before) {
      const index = remaining.findIndex((candidate) => sameIdentity(candidate, entry))
      if (index >= 0) pairs.push([entry, remaining.splice(index, 1)[0] as ProtectionEntry])
      else unmatchedBefore.push(entry)
    }
    while (unmatchedBefore.length > 0 && remaining.length > 0) {
      pairs.push([unmatchedBefore.shift() as ProtectionEntry, remaining.shift() as ProtectionEntry])
    }
    for (const [was, now] of pairs) {
      if (
        was.applicability === now.applicability &&
        was.reason === now.reason &&
        sameIdentity(was, now)
      ) {
        continue
      }
      changes.push({
        kind: "policy-changed",
        route,
        before: was,
        after: now,
        weakened: RANK[now.applicability] < RANK[was.applicability],
      })
    }
    for (const policy of unmatchedBefore) changes.push({ kind: "policy-removed", route, policy })
    for (const policy of remaining) changes.push({ kind: "policy-added", route, policy })
  }
  return changes
}

function toEntry(policy: PolicyInspection): ProtectionEntry {
  return {
    name: policy.name,
    layer: policy.layer,
    phase: policy.phase,
    ...(policy.scope ? { scope: { ...policy.scope } } : {}),
    applicability: policy.applicability.status,
    reason: policy.applicability.reason,
  }
}

function scopeKey(scope: ProtectionEntry["scope"]): string {
  return `${scope?.method ?? ""}\u0000${scope?.pathType ?? ""}\u0000${scope?.path ?? ""}`
}

function sameIdentity(a: ProtectionEntry, b: ProtectionEntry): boolean {
  return a.phase === b.phase && scopeKey(a.scope) === scopeKey(b.scope)
}

function compareEntries(a: ProtectionEntry, b: ProtectionEntry): number {
  return (
    PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) ||
    LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer) ||
    compareText(a.name, b.name) ||
    compareText(scopeKey(a.scope), scopeKey(b.scope)) ||
    compareText(a.applicability, b.applicability)
  )
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function routeId(route: RouteKey): string {
  return `${route.method}\u0000${route.path}`
}

function routeKey(route: RouteKey): RouteKey {
  return { method: route.method, path: route.path }
}

function describeScope(scope: ProtectionEntry["scope"]): string {
  if (!scope) return "—"
  const parts = [
    scope.method,
    scope.path !== undefined ? `${scope.pathType ?? "literal"} ${scope.path}` : "",
  ]
  return parts.filter(Boolean).join(" ") || "—"
}

function cell(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replaceAll("|", "\\|")
}

function code(value: string): string {
  return `\`${value.replace(/[\r\n`]+/g, " ")}\``
}

function assertReport(report: ProtectionReport, label: string): void {
  if (
    typeof report !== "object" ||
    report === null ||
    report.schemaVersion !== 1 ||
    !Array.isArray(report.routes)
  ) {
    throw new TypeError(`The ${label} is not a protection report with schemaVersion 1`)
  }
}
