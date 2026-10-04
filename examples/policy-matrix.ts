import { Orvaxis } from "../index"
import { formatPolicyMatrixReport, testPolicyMatrix } from "../testing"

const app = new Orvaxis()
app.policy({
  name: "authenticate",
  evaluate: (ctx) => (ctx.req.headers["x-user"] ? { allow: true } : { allow: false, status: 401 }),
})
app.group({
  prefix: "/tenants/:tenantId",
  policies: [
    {
      name: "tenant-access",
      evaluate: (ctx) =>
        ctx.req.headers["x-role"] === "admin" || ctx.req.headers["x-tenant"] === ctx.params.tenantId
          ? { allow: true }
          : { allow: false },
    },
  ],
  routes: [
    {
      method: "GET",
      path: "/documents/:documentId",
      policies: [
        {
          name: "document-owner-or-admin",
          evaluate: (ctx) =>
            ctx.req.headers["x-role"] === "admin" || ctx.req.headers["x-user"] === "alice"
              ? { allow: true }
              : { allow: false },
        },
      ],
      handler: (ctx) => ctx.res.json({ documentId: ctx.params.documentId }),
    },
  ],
})

const scenarios = [
  {
    name: "anonymous",
    request: { path: "/tenants/acme/documents/42" },
    expected: { status: 401, policy: "authenticate", handlerExecuted: false },
  },
  {
    name: "document owner",
    request: {
      path: "/tenants/acme/documents/42",
      headers: { "x-user": "alice", "x-tenant": "acme" },
    },
    expected: { status: 200, policy: null, handlerExecuted: true },
  },
  {
    name: "different user in tenant",
    request: {
      path: "/tenants/acme/documents/42",
      headers: { "x-user": "bob", "x-tenant": "acme" },
    },
    expected: { status: 403, policy: "document-owner-or-admin", handlerExecuted: false },
  },
  {
    name: "user from another tenant",
    request: {
      path: "/tenants/acme/documents/42",
      headers: { "x-user": "alice", "x-tenant": "other" },
    },
    expected: { status: 403, policy: "tenant-access", handlerExecuted: false },
  },
  {
    name: "admin",
    request: {
      path: "/tenants/acme/documents/42",
      headers: { "x-user": "root", "x-role": "admin", "x-tenant": "other" },
    },
    expected: { status: 200, policy: null, handlerExecuted: true },
  },
] as const

async function main() {
  const report = await testPolicyMatrix(app, scenarios)
  console.log(formatPolicyMatrixReport(report))
  if (!report.passed) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "Policy matrix demo failed")
  process.exitCode = 1
})
