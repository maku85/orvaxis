# Diagnose a 403 response

A `403` means a policy denied an authenticated or otherwise recognized request. A `401` usually means the request did not establish an identity. Orvaxis stops at the first denying policy, so later policies and the route handler do not run.

Start by inspecting the finalized request trace. The default policy trace records policy name, layer, phase, order, and outcome, while omitting request values and free-form denial reasons. `formatExecutionSummary()` reports the terminal policy and stages that did not run:

```ts
import { formatExecutionSummary } from "orvaxis"
import { testRequest } from "orvaxis/testing"

const result = await testRequest(app, {
  path: "/api/documents/42",
  headers: { "x-user-id": "bob" },
})

if (result.ctx) console.log(formatExecutionSummary(result.ctx))
```

The `(route:0)` policy ID after `Stopped by:` is printed from 0.5.0; 0.4.0 prints `Stopped by: document-owner`. Everything else below matches 0.4.0.

A denial will look like this:

```text
GET /api/documents/:id
Outcome: denied (403)
Policy decisions:
  [route.preValidation #1] document-owner: deny, terminal
Stopped by: document-owner (route:0)
Not reached: beforePipeline → globalPipeline → groupMiddleware → routeMiddleware → validation → global.postValidation → group.postValidation → route.postValidation → beforeHandler → handler
```

Run the complete working demo from the repository checkout:

```bash
pnpm exec tsx examples/policy-diagnostics.ts
```

It prints six scenarios: allowed, denied, policy evaluation error, validation failure, handler error, and a truncated trace. Pass a scenario id (`pnpm exec tsx examples/policy-diagnostics.ts policy-error`) for one of them plus its JSON request report; the [interactive demo](/demo/policy-traces) lists every id and command. To verify permission behavior as well as inspect it, run `pnpm exec tsx examples/policy-matrix.ts`; each scenario asserts the expected status, terminal policy, and whether the handler ran.

If the wrong policy is terminal, check the declarations in execution order: global, group, then route; within a layer, higher priority runs first. Confirm that a scoped policy matches the request method and path, and that a post-validation policy declares `requires` fields with matching route schemas and `schemaValidationPlugin` installed. `app.inspectRoutes()` helps check which policies are attached to a route without executing policy code. See [policy and lifecycle reference](../reference/lifecycle.md) for ordering details.
