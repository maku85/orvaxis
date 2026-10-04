# Find the policy behind an API 403

An HTTP status tells a client what happened; it rarely tells the maintainer which authorization rule caused it. Orvaxis records policy decisions on the request trace, so a denied request can identify the terminal policy and confirm that the handler was skipped.

## Reproduce the denial

Clone the repository, install its dependencies, and run the diagnostics example:

```bash
pnpm install
pnpm exec tsx examples/policy-diagnostics.ts
```

The denied case prints a summary like this:

```text
=== DENIED (403) ===
GET /:id
Outcome: denied (403)
Policy decisions:
  [route.preValidation #1] document-owner: deny, terminal
Stopped by: document-owner
Not reached: beforePipeline → globalPipeline → groupMiddleware → routeMiddleware → validation → global.postValidation → group.postValidation → route.postValidation → beforeHandler → handler
```

`formatExecutionSummary()` formats decisions already captured by the runtime. It does not call policy code a second time, and its default output omits request values and free-form denial reasons. A maintainer can see that `document-owner` denied this request before any middleware or handler ran.

## Fix the cause, then keep a regression case

Inspect the named policy and its inputs: the route template, authenticated identity, resource owner, and any tenant boundary. Avoid changing a policy based only on the status code. Add the failing request as a permission-matrix scenario and assert the terminal policy and `handlerExecuted: false` as well as the status.

The companion [multi-tenant task demo](../guide/multi-tenant-demo.md) demonstrates a user who belongs to the tenant but does not own the requested task. Run `pnpm check:tenant-demo` to see the `task-owner-or-admin` denial and the separate `tenant-access` denial for a user from another tenant.

Keep detailed reasons out of normal traces if they can contain user-controlled or private data. Orvaxis summary traces retain the policy name, layer, phase, order, and outcome; detailed mode requires an explicit reason redactor.
