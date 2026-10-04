# Add Orvaxis to an existing Express route

Use `createExpressPolicyGuard()` when Express already owns the route handler and you want to add Orvaxis authorization without moving that handler. Orvaxis evaluates a matching route declaration, then Express continues to its existing handler only when every applicable pre-validation policy allows the request.

Install Orvaxis and Express if they are not already present:

```bash
npm install orvaxis express
```

Declare the policy and mirror the protected method and path in Orvaxis. Keep the actual handler in Express:

```ts
import express from "express"
import { Orvaxis, type Policy } from "orvaxis"
import { createExpressPolicyGuard } from "orvaxis/express"

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
server.get(
  "/api/documents/:id",
  createExpressPolicyGuard(security),
  (req, res) => res.json({ documentId: req.params.id }),
)
```

Mount the guard after middleware that parses the body or establishes identity, and before the existing handler. The guard adapts the Express request for Orvaxis, so policies can inspect request fields established by earlier Express middleware. The header in this example is only a demonstration input; use verified authentication state in production. Values returned through `modify` are available to later Express middleware at `res.locals.orvaxis`.

The guard executes only pre-validation Orvaxis policies. It does not run Orvaxis plugins, middleware, request validation, or the route handler. A mirrored route that uses `defineRoute()` or post-validation policies is rejected because those require full Orvaxis execution. To roll back, remove the guard from the Express route and its mirrored Orvaxis declaration.

For a new route where Orvaxis should own routing and the handler too, use the [quickstart in the README](../../README.md#quickstart) and an adapter instead.
