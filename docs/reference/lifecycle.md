# Request lifecycle and policy order

Orvaxis separates authorization decisions, request flow, lifecycle hooks, and route handling. The runtime executes these stages in this order for a matched request:

1. Validate the request and run `onRequest`.
2. Match a route; unmatched paths and wrong methods go through `onNotFound` or `onMethodNotAllowed`.
3. Evaluate pre-validation policies: global, group, then route. Within each layer, higher `priority` runs first; equal priorities retain declaration order.
4. Run `beforePipeline`, the global `app.use()` pipeline, group middleware, and route middleware.
5. Run `onValidation`; `schemaValidationPlugin` parses declared request fields here.
6. Evaluate post-validation policies in global, group, route order.
7. Run `beforeHandler`, the route handler, `afterHandler`, finalize the trace, then run `afterPipeline`.

Any denial or unhandled error stops the remaining stages. A successful short-circuit response from a hook or middleware also stops later stages and completes through `afterPipeline`. `afterHandler` runs only when the route handler has run and completed. Errors before completion finalize the trace before `onError` and skip `afterPipeline`.

```text
onRequest → route match → pre-validation policies
          → beforePipeline → global → group → route middleware
          → onValidation → post-validation policies
          → beforeHandler → handler → afterHandler
          → trace finalization → afterPipeline
```

Post-validation policies must declare a non-empty `requires` list (`body`, `params`, `query`, or `headers`). The matching route must declare every required schema, and `schemaValidationPlugin` must be registered. Otherwise Orvaxis returns a configuration error rather than evaluating against unvalidated data.

Policy scopes filter a policy by method and path. String path scopes match the named path and its descendants at segment boundaries; regular expressions and predicates are evaluated per request. A policy can deny with a status and reason. The first denial is terminal; subsequent policies do not execute.

Policy trace collection defaults to a bounded summary of at most 100 decisions. It excludes request values and free-form denial reasons. Use `formatExecutionSummary(ctx)` to identify the terminal policy and skipped stages. Detailed traces require an explicit reason redactor. See the [403 diagnostic guide](../guide/diagnose-403.md) for a practical workflow.
