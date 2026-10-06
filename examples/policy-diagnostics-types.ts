import type { RequestReport } from "../debug/requestReport"

export type PolicyDiagnosticSnapshot = {
  id: string
  /** `basics` are single-purpose scenarios; `tenant` are identity × resource fixture combinations. */
  group: "basics" | "tenant"
  label: string
  description: string
  /** What to look at in this scenario and how it differs from its neighbours. */
  explanation: string
  method: string
  route: string
  /** The status the HTTP adapters send for this outcome. */
  status: number
  outcome: "completed" | "denied" | "error"
  terminalPolicy: string | null
  handlerExecuted: boolean
  decisions: Array<{
    policy: string
    policyId: string | null
    layer: string
    phase: string
    outcome: string
    terminal: boolean
  }>
  notReachedStages: string[]
  formattedSummary: string
  /** `buildRequestReport(ctx)` with the volatile duration removed. */
  report: RequestReport
  /** Demonstration identity, for tenant scenarios. Never a real user. */
  identity: { label: string; userId: string; tenantId: string; role: string } | null
  /** Repository paths that define and verify the scenario. */
  source: string
  test: string
  /** Replays the scenario locally through the runtime. */
  command: string
  /** For tenant scenarios: the same request against the local demo server. */
  curl: string | null
}
