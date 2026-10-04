import { formatExecutionSummary } from "../index"
import {
  checkPolicyRequirements,
  formatPolicyMatrixReport,
  formatPolicyRequirementReport,
  testPolicyMatrix,
  testRequest,
} from "../testing"
import { tenantTaskScenarios, tenantTasksApp } from "./tenant-tasks"

async function main() {
  const requirements = checkPolicyRequirements(tenantTasksApp.inspectRoutes(), [
    {
      name: "task routes require tenant and owner checks",
      paths: ["/api/tenants/:tenantId/tasks/:taskId"],
      requirePolicies: ["authenticate", "tenant-access", "task-owner-or-admin"],
    },
    {
      name: "admin overview requires authentication, tenant access, and admin role",
      paths: ["/api/tenants/:tenantId/admin/overview"],
      requirePolicies: ["authenticate", "tenant-access", "require-admin"],
    },
  ])
  console.log(formatPolicyRequirementReport(requirements))

  const matrix = await testPolicyMatrix(tenantTasksApp, tenantTaskScenarios)
  console.log(formatPolicyMatrixReport(matrix))

  for (const name of ["different member in the same tenant", "member from another tenant"]) {
    const scenario = tenantTaskScenarios.find((candidate) => candidate.name === name)
    if (!scenario) throw new Error(`Missing demo scenario: ${name}`)
    const result = await testRequest(tenantTasksApp, scenario.request)
    if (!result.ctx) throw new Error(`No request context captured for: ${name}`)
    console.log(`=== TRACE: ${name} ===`)
    console.log(formatExecutionSummary(result.ctx))
  }

  if (!requirements.passed || !matrix.passed) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "Tenant task demo check failed")
  process.exitCode = 1
})
