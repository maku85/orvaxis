import { basename } from "node:path"
import express, { type Application } from "express"
import { createExpressPolicyGuard } from "../http/expressAdapter"
import { Orvaxis, type Policy } from "../index"

export function createExistingRouteDemo(): Application {
  const security = new Orvaxis()
  const documentOwner: Policy = {
    name: "document-owner",
    evaluate(ctx) {
      return ctx.req.headers["x-user-id"] === ctx.params.id
        ? { allow: true, modify: { authorizedUserId: ctx.params.id } }
        : { allow: false, reason: "You cannot access this document", status: 403 }
    },
  }

  security.group({
    prefix: "/api",
    routes: [
      { method: "GET", path: "/documents/:id", policies: [documentOwner], handler: () => {} },
    ],
  })

  const server = express()
  server.get("/api/documents/:id", createExpressPolicyGuard(security), (req, res) =>
    res.json({ documentId: req.params.id })
  )
  return server
}

if (basename(process.argv[1] ?? "") === "express-existing-route.ts") {
  createExistingRouteDemo().listen(3005, () =>
    console.log("Existing Express route demo listening on port 3005")
  )
}
