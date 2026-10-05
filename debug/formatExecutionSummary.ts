import type { OrvaxisContext } from "../types/index.js"
import { buildExecutionSummary } from "./buildExecutionSummary.js"

/**
 * Format a request's recorded decisions for logs and bug reports.
 * Request values and free-form error/denial messages are deliberately omitted.
 */
export function formatExecutionSummary(ctx: OrvaxisContext): string {
  const summary = buildExecutionSummary(ctx)
  const route = summary.route
  const method = safeLabel(route?.route.method ?? ctx.req.method).toUpperCase()
  const path = safeLabel(route?.route.path ?? "<unmatched route>")
  const failed = Boolean(ctx.error) || ctx.meta.trace?.outcome === "error"
  const status = Number.isInteger(ctx.error && "status" in ctx.error ? ctx.error.status : undefined)
    ? (ctx.error as Error & { status: number }).status
    : failed
      ? 500
      : ctx.res.statusCode
  const outcome = summary.stoppedByPolicy
    ? summary.stoppedByPolicy.meta?.outcome === "deny"
      ? "denied"
      : "error"
    : failed
      ? "error"
      : "completed"
  const lines = [`${method} ${path}`, `Outcome: ${outcome} (${status})`, "Policy decisions:"]

  if (summary.policyDecisions.length === 0) {
    lines.push("  none recorded")
  } else {
    for (const event of summary.policyDecisions) {
      const meta = event.meta ?? {}
      const policy = safeLabel(meta.policy)
      const layer = safeLabel(meta.layer)
      const phase = safeLabel(meta.phase)
      const order = Number.isInteger(meta.order) ? ` #${meta.order}` : ""
      const outcomeText = safeLabel(meta.outcome)
      const terminal =
        meta.terminal === true || event === summary.stoppedByPolicy ? ", terminal" : ""
      const detail = meta.outcome === "error" ? " (evaluation error)" : ""
      lines.push(`  [${layer}.${phase}${order}] ${policy}: ${outcomeText}${detail}${terminal}`)
    }
  }

  if (summary.stoppedByPolicy) {
    lines.push(`Stopped by: ${safeLabel(summary.stoppedByPolicy.meta?.policy)}`)
  }
  if (summary.notReachedStages.length > 0) {
    lines.push(`Not reached: ${summary.notReachedStages.join(" → ")}`)
  }
  return lines.join("\n")
}

function safeLabel(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "unknown"
  return String(value)
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("\t", " ")
    .slice(0, 100)
}
