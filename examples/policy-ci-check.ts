import { Orvaxis } from "../index"
import {
  checkPolicyRequirements,
  formatPolicyMatrixReport,
  formatPolicyRequirementReport,
  testPolicyMatrix,
} from "../testing"

const app = new Orvaxis()
app.policy({
  name: "authenticate",
  scope: { path: "/api/private" },
  evaluate: (ctx) =>
    ctx.req.headers["x-api-key"]
      ? { allow: true }
      : { allow: false, status: 401, reason: "API key required" },
})
app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/private/report",
      handler: (ctx) => ctx.res.json({ report: "demo" }),
    },
    {
      method: "GET",
      path: "/tenants/:tenantId/documents/:id",
      policies: [
        {
          name: "tenant-access",
          scope: { path: (path) => path.includes("/tenants/") },
          evaluate: (ctx) =>
            ctx.req.headers["x-tenant"] === ctx.params.tenantId
              ? { allow: true }
              : { allow: false },
        },
      ],
      handler: (ctx) => ctx.res.json({ id: ctx.params.id }),
    },
    {
      method: "GET",
      path: "/tenants/public/health",
      handler: (ctx) => ctx.res.json({ ok: true }),
    },
  ],
})

async function main() {
  const staticReport = checkPolicyRequirements(app.inspectRoutes(), [
    {
      name: "private API requires authentication",
      paths: ["/api/private/**"],
      requirePolicies: ["authenticate"],
    },
    {
      name: "tenant documents require tenant access",
      paths: ["/api/tenants/**"],
      requirePolicies: ["tenant-access"],
      exceptions: [
        {
          path: "/api/tenants/public/health",
          reason: "Public health check",
        },
      ],
    },
  ])
  console.log(formatPolicyRequirementReport(staticReport))

  const dynamicReport = await testPolicyMatrix(app, [
    {
      name: "private API without key",
      request: { path: "/api/private/report" },
      expected: { status: 401, policy: "authenticate", handlerExecuted: false },
    },
    {
      name: "private API with key",
      request: { path: "/api/private/report", headers: { "x-api-key": "demo-key" } },
      expected: { status: 200, policy: null, handlerExecuted: true },
    },
  ])
  console.log(formatPolicyMatrixReport(dynamicReport))

  if (!staticReport.passed || !dynamicReport.passed) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "Policy CI check failed")
  process.exitCode = 1
})
