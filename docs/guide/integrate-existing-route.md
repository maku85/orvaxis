# Add Orvaxis to an existing Express route

Use `createExpressPolicyGuard()` when Express already owns the route handler and you want to add Orvaxis authorization without moving that handler. Orvaxis evaluates a matching route declaration, then Express continues to its existing handler only when every applicable pre-validation policy allows the request.

This guide takes one route from "unprotected" to "first denied request explained".

## 1. Install

```bash
npm install orvaxis express
```

Orvaxis requires Node.js 22.13 or later. Express 4.20+ and Express 5 are supported.

## 2. Declare the policy and put the guard in front of your handler

Mirror the protected method and path in an `Orvaxis` instance and keep the actual handler in Express:

<!-- snippet: examples/express-existing-route.ts#imports,guard -->
```ts
import express, { type Application } from "express"
import { createExpressPolicyGuard } from "orvaxis/express"
import { formatExecutionSummary, Orvaxis, type Policy } from "orvaxis"
import { testRequest } from "orvaxis/testing"

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
```

Mount the guard after middleware that parses the body or establishes identity, and before the existing handler. The header in this example is only a demonstration input; use verified authentication state in production. Values returned through `modify` are available to later Express middleware at `res.locals.orvaxis`.

## 3. Send the first request

From a repository checkout, run the working example on port `3005`:

```bash
pnpm exec tsx examples/express-existing-route.ts
curl -i -H 'x-user-id: alice' http://localhost:3005/api/documents/alice  # 200: your handler ran
curl -i -H 'x-user-id: bob' http://localhost:3005/api/documents/alice    # 403: the guard stopped it
```

The tests run exactly this sequence, so it keeps working.

## 4. Explain the 403

The guard answers `403` but does not keep a trace for you. To learn which policy decided, replay the same request through the mirrored declaration:

<!-- snippet: examples/express-existing-route.ts#explain -->
```ts
// Replays the request through the mirrored declaration and reports which policy decided.
export async function explainDenial(userId: string, documentId: string) {
  const result = await testRequest(security, {
    path: `/api/documents/${documentId}`,
    headers: { "x-user-id": userId },
  })
  return result.ctx ? formatExecutionSummary(result.ctx) : undefined
}
```

> **Unreleased.** The `(route:0)` ID after `Stopped by:` is on `main` only; the 0.4.0 package prints `Stopped by: document-owner`.

`explainDenial("bob", "alice")` returns:

```text
GET /api/documents/:id
Outcome: denied (403)
Policy decisions:
  [route.preValidation #1] document-owner: deny, terminal
Stopped by: document-owner (route:0)
Not reached: beforePipeline → globalPipeline → groupMiddleware → routeMiddleware → validation → global.postValidation → group.postValidation → route.postValidation → beforeHandler → handler
```

The summary leaves out request values and free-form messages, so it is safe to paste into an issue. [Diagnose a 403](/guide/diagnose-403) explains how to read it.

## What the guard does not do

| | Express guard | Full runtime with an adapter |
|---|---|---|
| Handler | Stays in Express | Declared in Orvaxis |
| Pre-validation policies | Yes | Yes |
| Post-validation policies and `requires` | Rejected with an error | Yes |
| Request validation (`defineRoute`, schemas) | Rejected with an error | Yes |
| Orvaxis middleware, hooks and plugins | Not run | Run |
| Response validation, OpenAPI | No | Yes |
| Trace for the request | Not kept; replay with `testRequest` | `ctx.meta.trace` on every request |

A mirrored route that uses `defineRoute()` or post-validation policies is rejected because those require full Orvaxis execution. To roll back, remove the guard from the Express route and its mirrored Orvaxis declaration. For a new route where Orvaxis should own routing and the handler too, use the [getting-started guide](/guide/getting-started) and an adapter instead.
