import { basename } from "node:path"
// #region imports
import express, { type Application } from "express"
import { createExpressPolicyGuard } from "../express"
import { formatExecutionSummary, Orvaxis, type Policy } from "../index"
import { testRequest } from "../testing"

// #endregion

// #region guard
const documentOwner: Policy = {
  name: "document-owner",
  evaluate(ctx) {
    return ctx.req.headers["x-user-id"] === ctx.params.id
      ? { allow: true, modify: { authorizedUserId: ctx.params.id } }
      : { allow: false, reason: "You cannot access this document", status: 403 }
  },
}

// Mirror the protected method and path here; the real handler stays in Express.
export const security = new Orvaxis()
security.group({
  prefix: "/api",
  routes: [{ method: "GET", path: "/documents/:id", policies: [documentOwner], handler: () => {} }],
})

export function createExistingRouteDemo(): Application {
  const server = express()
  server.get("/api/documents/:id", createExpressPolicyGuard(security), (req, res) =>
    res.json({ documentId: req.params.id })
  )
  return server
}
// #endregion

// #region explain
// Replays the request through the mirrored declaration and reports which policy decided.
export async function explainDenial(userId: string, documentId: string) {
  const result = await testRequest(security, {
    path: `/api/documents/${documentId}`,
    headers: { "x-user-id": userId },
  })
  return result.ctx ? formatExecutionSummary(result.ctx) : undefined
}
// #endregion

if (basename(process.argv[1] ?? "") === "express-existing-route.ts") {
  createExistingRouteDemo().listen(3005, () =>
    console.log("Existing Express route demo listening on port 3005")
  )
}
