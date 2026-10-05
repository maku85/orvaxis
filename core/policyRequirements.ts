import type { HttpMethod, RouteInspection } from "../types/index.js"

export type PolicyRequirementException = {
  /** Exact path or glob (`*` matches one segment, `**` matches zero or more). */
  path: string
  methods?: readonly HttpMethod[]
  reason: string
}

export type PolicyRequirement = {
  /** Stable identifier used in reports, unique within a check. */
  name: string
  /** Route path templates or globs. `/api/private/**` includes the base and descendants. */
  paths: readonly string[]
  methods?: readonly HttpMethod[]
  /** Policy names that must apply to every selected route. */
  requirePolicies: readonly string[]
  exceptions?: readonly PolicyRequirementException[]
}

export type PolicyRequirementStatus = "pass" | "fail" | "unverifiable" | "excluded"

export type PolicyRequirementResult = {
  requirement: string
  method: string
  path: string
  status: PolicyRequirementStatus
  missingPolicies: string[]
  unverifiablePolicies: string[]
  exceptionReason?: string
  message?: string
}

export type PolicyRequirementReport = {
  passed: boolean
  results: PolicyRequirementResult[]
}

export type PolicyRequirementOptions = {
  /** Treat routes with conditionally applicable policy scopes as failures. Defaults to false. */
  failOnUnverifiable?: boolean
}

/**
 * Check static route-policy declarations without executing predicates, evaluators, or handlers.
 * Conditional scopes remain visible as unverifiable unless strict mode is enabled.
 */
export function checkPolicyRequirements(
  routes: readonly RouteInspection[],
  requirements: readonly PolicyRequirement[],
  options: PolicyRequirementOptions = {}
): PolicyRequirementReport {
  const results: PolicyRequirementResult[] = []

  for (const requirement of requirements) {
    for (const pattern of [
      ...requirement.paths,
      ...(requirement.exceptions?.map((exception) => exception.path) ?? []),
    ]) {
      const segments = pattern.split("/").filter(Boolean)
      if (segments.slice(0, -1).includes("**")) {
        throw new TypeError("Policy requirement glob '**' must be the last path segment")
      }
    }
    if (requirement.exceptions?.some((exception) => !exception.reason.trim())) {
      throw new TypeError("Policy requirement exceptions must have a non-empty reason")
    }
    const selected = routes.filter(
      (route) =>
        pathMatchesAny(route.path, requirement.paths) &&
        methodMatchesAny(route.method, requirement.methods)
    )

    if (selected.length === 0) {
      results.push({
        requirement: requirement.name,
        method: "*",
        path: requirement.paths.join(", ") || "<no path selector>",
        status: "fail",
        missingPolicies: [...requirement.requirePolicies],
        unverifiablePolicies: [],
        message: "selector matched no routes",
      })
      continue
    }

    if (requirement.requirePolicies.length === 0) {
      for (const route of selected) {
        results.push({
          requirement: requirement.name,
          method: route.method,
          path: route.path,
          status: "fail",
          missingPolicies: [],
          unverifiablePolicies: [],
          message: "requirePolicies must list at least one policy",
        })
      }
      continue
    }

    for (const route of selected) {
      const exception = requirement.exceptions?.find(
        (candidate) =>
          pathMatches(route.path, candidate.path) &&
          methodMatchesAny(route.method, candidate.methods)
      )
      if (exception) {
        results.push({
          requirement: requirement.name,
          method: route.method,
          path: route.path,
          status: "excluded",
          missingPolicies: [],
          unverifiablePolicies: [],
          exceptionReason: exception.reason,
        })
        continue
      }

      const missingPolicies: string[] = []
      const unverifiablePolicies: string[] = []
      for (const name of requirement.requirePolicies) {
        const matching = route.policies.filter((policy) => policy.name === name)
        if (matching.some((policy) => policy.applicability.status === "always")) continue
        if (matching.some((policy) => policy.applicability.status === "conditional")) {
          unverifiablePolicies.push(name)
        } else {
          missingPolicies.push(name)
        }
      }

      const status: PolicyRequirementStatus =
        missingPolicies.length > 0
          ? "fail"
          : unverifiablePolicies.length > 0
            ? "unverifiable"
            : "pass"
      results.push({
        requirement: requirement.name,
        method: route.method,
        path: route.path,
        status,
        missingPolicies,
        unverifiablePolicies,
      })
    }
  }

  return {
    passed: results.every(
      (result) =>
        result.status !== "fail" &&
        !(options.failOnUnverifiable && result.status === "unverifiable")
    ),
    results,
  }
}

/** Format static policy requirement results for test output and CI logs. */
export function formatPolicyRequirementReport(report: PolicyRequirementReport): string {
  const lines = [`Policy requirements: ${report.passed ? "PASS" : "FAIL"}`]
  for (const result of report.results) {
    const missing = result.missingPolicies.length
      ? `; missing: ${result.missingPolicies.join(", ")}`
      : ""
    const unknown = result.unverifiablePolicies.length
      ? `; scope not verified: ${result.unverifiablePolicies.join(", ")}`
      : ""
    const exception = result.exceptionReason ? `; exception: ${result.exceptionReason}` : ""
    const message = result.message ? `; ${result.message}` : ""
    lines.push(
      `${result.status.toUpperCase()} | ${result.requirement} | ${result.method} ${result.path}${missing}${unknown}${exception}${message}`
    )
  }
  return lines.join("\n")
}

function methodMatchesAny(method: string, methods?: readonly HttpMethod[]): boolean {
  return (
    methods === undefined ||
    methods.some((candidate) => candidate.toUpperCase() === method.toUpperCase())
  )
}

function pathMatchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pathMatches(path, pattern))
}

function pathMatches(path: string, pattern: string): boolean {
  const pathSegments = path.split("/").filter(Boolean)
  const patternSegments = pattern.split("/").filter(Boolean)
  let pathIndex = 0
  let patternIndex = 0

  while (patternIndex < patternSegments.length) {
    const patternSegment = patternSegments[patternIndex]
    if (patternSegment === "**") return true
    const pathSegment = pathSegments[pathIndex]
    if (pathSegment === undefined) return false
    if (patternSegment !== "*" && patternSegment !== pathSegment) return false
    pathIndex++
    patternIndex++
  }
  return pathIndex === pathSegments.length
}
