import { fullRoutePath } from "../core/Router.js"
import type { OrvaxisContext } from "../types/index.js"
import { buildExecutionSummary } from "./buildExecutionSummary.js"

export type RequestReportOptions = {
  /** Include the request ID. Off by default: IDs can be supplied by clients. */
  includeRequestId?: boolean
  /** Include the terminal decision's reason when `detailed` tracing recorded a redacted one. */
  includeReasons?: boolean
}

export type RequestReport = {
  schemaVersion: 1
  requestId?: string
  /** Request method, not the matched route's; they differ for HEAD → GET. */
  method: string
  /** Matched route; `null` when no route matched. The template is configuration, never the URL. */
  route: { method: string; template: string } | null
  outcome: "completed" | "denied" | "error" | "unknown"
  response: {
    sent: boolean
    /** Status actually sent, or carried by the error; `null` when it cannot be known. */
    status: number | null
    statusSource: "sent" | "error" | "unknown"
  }
  durationMs: number | null
  handler: "executed" | "not-executed" | "unknown"
  terminalDecision:
    | { state: "none" }
    | { state: "unknown"; cause: "collection-off" | "not-recorded" }
    | {
        state: "recorded"
        kind: "deny" | "error"
        policy: string
        policyId: string | null
        layer: string
        phase: string
        reason?: string
      }
  trace: {
    policyCollection: "summary" | "detailed" | "off" | "unknown"
    recordedDecisions: number
    droppedDecisions: number
    truncated: boolean
    maxEvents: number | null
  }
}

const MAX_LABEL = 100
const MAX_REASON = 200

/**
 * Build a JSON-serializable report of one request that is safe to attach to an issue or a
 * structured log. Only fixed, bounded fields are copied: never HTTP objects, credentials, URLs,
 * params, headers, bodies, stacks, error messages, `ctx.meta` values or `ctx.state`. Names of
 * routes and policies are configuration labels and stay under the application's responsibility.
 */
export function buildRequestReport(
  ctx: OrvaxisContext,
  options: RequestReportOptions = {}
): RequestReport {
  const summary = buildExecutionSummary(ctx)
  const trace = ctx.meta.trace
  const match = summary.route
  const failed = ctx.error !== undefined || trace?.outcome === "error"
  const sent = ctx.res.sent === true
  const thrownStatus = errorStatus(ctx.error)
  const terminal = summary.stoppedByPolicy?.meta
  const finished = trace?.outcome !== undefined || ctx.error !== undefined

  const outcome: RequestReport["outcome"] = terminal
    ? terminal.outcome === "deny"
      ? "denied"
      : "error"
    : failed
      ? "error"
      : finished
        ? "completed"
        : "unknown"

  const statusSource = sent ? "sent" : thrownStatus !== undefined ? "error" : "unknown"
  const status = sent ? finiteStatus(ctx.res.statusCode) : (thrownStatus ?? null)

  let terminalDecision: RequestReport["terminalDecision"]
  if (terminal) {
    const reason =
      options.includeReasons && typeof terminal.reason === "string"
        ? { reason: safeLabel(terminal.reason, MAX_REASON) }
        : {}
    terminalDecision = {
      state: "recorded",
      kind: terminal.outcome === "deny" ? "deny" : "error",
      policy: safeLabel(terminal.policy),
      policyId: typeof terminal.policyId === "string" ? safeLabel(terminal.policyId) : null,
      layer: safeLabel(terminal.layer),
      phase: safeLabel(terminal.phase),
      ...reason,
    }
  } else if (summary.policyTrace.mode === "off") {
    terminalDecision = { state: "unknown", cause: "collection-off" }
  } else if (failed && hasPolicyName(ctx.error)) {
    terminalDecision = { state: "unknown", cause: "not-recorded" }
  } else {
    terminalDecision = { state: "none" }
  }

  const requestId =
    options.includeRequestId && typeof summary.requestId === "string"
      ? { requestId: safeLabel(summary.requestId, 128) }
      : {}

  return {
    schemaVersion: 1,
    ...requestId,
    method: safeLabel(ctx.req.method).toUpperCase(),
    route: match
      ? {
          method: safeLabel(match.route.method).toUpperCase(),
          template: safeLabel(fullRoutePath(match.group.prefix, match.route.path), 200),
        }
      : null,
    outcome,
    response: { sent, status, statusSource },
    durationMs:
      summary.duration !== null && Number.isFinite(summary.duration) ? summary.duration : null,
    handler:
      trace === undefined
        ? "unknown"
        : trace.handlerExecuted === true
          ? "executed"
          : "not-executed",
    terminalDecision,
    trace: {
      policyCollection: summary.policyTrace.mode ?? "unknown",
      recordedDecisions: summary.policyDecisions.length,
      droppedDecisions: summary.policyTrace.droppedDecisions,
      truncated: summary.policyTrace.truncated,
      maxEvents: summary.policyTrace.maxEvents ?? null,
    },
  }
}

/** Status carried by a thrown value, only when it is an integer HTTP status (100–599). */
export function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined
  const status = error.status
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined
}

export function safeLabel(value: unknown, max = MAX_LABEL): string {
  if (typeof value !== "string" && typeof value !== "number") return "unknown"
  return Array.from(String(value).slice(0, max), (char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7f ? " " : char
  }).join("")
}

function finiteStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function hasPolicyName(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "policyName" in error &&
    typeof error.policyName === "string"
  )
}
