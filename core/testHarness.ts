import { buildExecutionSummary } from "../debug/buildExecutionSummary.js"
import type { OrvaxisContext, OrvaxisRequest, OrvaxisResponse } from "../types/index.js"
import { runWithContextCapture } from "./contextStore.js"
import { createMockResponse } from "./mockResponse.js"

export type TestRequestInit = {
  path: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
  query?: Record<string, string | string[]>
  id?: string
  [key: string]: unknown
}

export type TestResponse = {
  status: number
  body: unknown
  headers: Record<string, string | string[]>
  chunks: unknown[]
  ended: boolean
  ctx: OrvaxisContext | undefined
  error: Error | undefined
}

export async function testRequest(
  app: { handle(req: OrvaxisRequest, res: OrvaxisResponse): Promise<OrvaxisContext> },
  init: TestRequestInit
): Promise<TestResponse> {
  const { path, method = "GET", headers = {}, ...rest } = init
  const req: OrvaxisRequest = { path, method, headers, ...rest }
  const res = createMockResponse()

  let ctx: OrvaxisContext | undefined
  let error: Error | undefined
  let failed = false

  try {
    ctx = await runWithContextCapture(
      (captured) => {
        ctx = captured
      },
      () => app.handle(req, res)
    )
  } catch (err) {
    failed = true
    error = err as Error
  }

  const errStatus = (error as (Error & { status?: number }) | undefined)?.status
  return {
    status: res.sent ? res.statusCode : (errStatus ?? (failed ? 500 : res.statusCode)),
    body: res.body,
    headers: res.sentHeaders,
    chunks: res.chunks,
    ended: res.ended,
    ctx,
    error,
  }
}

export type PolicyMatrixExpectation = {
  status: number
  /** Expected terminal policy name; use `null` to expect no terminal policy denial. */
  policy?: string | null
  /** Whether the Orvaxis route handler should have been invoked. */
  handlerExecuted?: boolean
}

export type PolicyMatrixScenario = {
  name: string
  request: TestRequestInit
  expected: PolicyMatrixExpectation
}

export type PolicyMatrixScenarioResult = {
  name: string
  passed: boolean
  status: number
  policy: string | undefined
  handlerExecuted: boolean | undefined
  mismatches: string[]
}

export type PolicyMatrixReport = {
  passed: boolean
  scenarios: PolicyMatrixScenarioResult[]
}

/** Execute each request once and compare its response and recorded policy trace to expectations. */
export async function testPolicyMatrix(
  app: { handle(req: OrvaxisRequest, res: OrvaxisResponse): Promise<OrvaxisContext> },
  scenarios: readonly PolicyMatrixScenario[]
): Promise<PolicyMatrixReport> {
  const results: PolicyMatrixScenarioResult[] = []

  for (const scenario of scenarios) {
    const response = await testRequest(app, scenario.request)
    const summary = response.ctx ? buildExecutionSummary(response.ctx) : undefined
    const policy =
      typeof summary?.stoppedByPolicy?.meta?.policy === "string"
        ? summary.stoppedByPolicy.meta.policy
        : undefined
    const handlerExecuted = response.ctx?.meta.trace?.handlerExecuted
    const mismatches: string[] = []

    if (response.status !== scenario.expected.status) {
      mismatches.push(`status expected ${scenario.expected.status}, received ${response.status}`)
    }
    if (scenario.expected.policy !== undefined) {
      const expectedPolicy = scenario.expected.policy ?? undefined
      if (policy !== expectedPolicy) {
        mismatches.push(`policy expected ${expectedPolicy ?? "none"}, received ${policy ?? "none"}`)
      }
    }
    if (scenario.expected.handlerExecuted !== undefined) {
      if (handlerExecuted !== scenario.expected.handlerExecuted) {
        mismatches.push(
          `handler expected ${scenario.expected.handlerExecuted ? "executed" : "not executed"}, received ${handlerExecuted === undefined ? "unknown" : handlerExecuted ? "executed" : "not executed"}`
        )
      }
    }

    results.push({
      name: scenario.name,
      passed: mismatches.length === 0,
      status: response.status,
      policy,
      handlerExecuted,
      mismatches,
    })
  }

  return { passed: results.every((scenario) => scenario.passed), scenarios: results }
}

/** Create a plain-text report suitable for test output and CI logs. */
export function formatPolicyMatrixReport(report: PolicyMatrixReport): string {
  const lines = [`Policy matrix: ${report.passed ? "PASS" : "FAIL"}`]
  for (const scenario of report.scenarios) {
    const name = scenario.name.replaceAll("|", " ").replaceAll("\r", " ").replaceAll("\n", " ")
    const handler =
      scenario.handlerExecuted === undefined
        ? "handler unknown"
        : scenario.handlerExecuted
          ? "handler executed"
          : "handler not executed"
    const mismatches = scenario.mismatches.length > 0 ? ` — ${scenario.mismatches.join("; ")}` : ""
    lines.push(
      `${scenario.passed ? "PASS" : "FAIL"} | ${name} | status ${scenario.status} | policy ${scenario.policy ?? "none"} | ${handler}${mismatches}`
    )
  }
  return lines.join("\n")
}
