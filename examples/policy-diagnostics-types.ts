export type PolicyDiagnosticSnapshot = {
  id: "allowed" | "denied" | "handler-error"
  label: string
  description: string
  method: string
  route: string
  status: number
  outcome: "completed" | "denied" | "error"
  terminalPolicy: string | null
  handlerExecuted: boolean
  decisions: Array<{
    policy: string
    layer: string
    phase: string
    outcome: string
    terminal: boolean
  }>
  notReachedStages: string[]
  formattedSummary: string
}
