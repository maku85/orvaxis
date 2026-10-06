# How a request runs

Orvaxis runs every request through one explicit sequence. This guide explains it with an application that records everything it does, so each order below is observed, not assumed. The [request lifecycle reference](/reference/lifecycle) is the normative description; this page shows it in action.

## The application

The source is [`examples/execution-order.ts`](https://github.com/maku85/orvaxis/blob/main/examples/execution-order.ts). The helpers `note`, `policy` and `middleware` only append a label to an `events` array before doing their job, so the lists on this page are the application's own record of what ran:

<!-- snippet: examples/execution-order.ts#app -->
```ts
const app = new Orvaxis()
app.register(schemaValidationPlugin)

// Hooks observe the lifecycle; the ones that run before the handler may also send a response.
for (const hook of [
  "onRequest",
  "beforePipeline",
  "onValidation",
  "beforeHandler",
  "afterHandler",
  "afterPipeline",
] as const) {
  app.on(hook, note(`hook ${hook}`))
}
app.on("onError", note("hook onError"))
app.on("onNotFound", (ctx) => {
  events.push("hook onNotFound")
  // A hook that sends a response ends the request normally: onError is not triggered.
  if (options.answerNotFound) ctx.res.status(404).json({ error: "Not Found" })
})
app.on("onMethodNotAllowed", note("hook onMethodNotAllowed"))

app.policy(policy("global-auth", (ctx) => ctx.req.headers["x-user"] !== undefined))
app.use(middleware("global"))

app.group({
  prefix: "/api",
  policies: [policy("group-tenant", (ctx) => ctx.req.headers["x-tenant"] !== "blocked")],
  middleware: [middleware("group", (header) => header === "group")],
  routes: [
    {
      method: "GET",
      path: "/orders/:id",
      schema: { params: z.object({ id: z.string() }) },
      policies: [
        policy("route-owner", (ctx) => ctx.req.headers["x-user"] !== "mallory"),
        {
          ...policy("route-post-check", () => true),
          phase: "postValidation",
          requires: ["params"],
        },
      ],
      middleware: [middleware("route", (header) => header === "route")],
      handler: (ctx) => {
        events.push("handler")
        if (ctx.req.headers["x-fail"]) throw new Error("handler failed")
        ctx.res.json({ id: ctx.params.id })
      },
    },
  ],
})
```

## The stages of a matched request

| # | Stage | What runs | Can it stop the request? |
|---|---|---|---|
| 1 | Request check and `onRequest` | validation of method and path, then the `onRequest` hooks | a hook that sends a response |
| 2 | Route match | the router; no match goes to `onNotFound` / `onMethodNotAllowed` | yes: 404, 405, or `OPTIONS` answered with 204 |
| 3 | Pre-validation policies | global, then group, then route; higher `priority` first within a layer | a denial or an error |
| 4 | `beforePipeline` and middleware | the hook, then global `app.use()`, group, route middleware | a response, or not calling `next()` |
| 5 | `onValidation` | the hook; `schemaValidationPlugin` parses declared fields here | a response, or a validation error |
| 6 | Post-validation policies | global, group, route; they receive validated data | a denial or an error |
| 7 | `beforeHandler`, handler, `afterHandler` | the hook, your handler, then the hook | a response from the hook; an error |
| 8 | Finalization | the trace is finished, then `afterPipeline` runs | an error thrown by the hook |

Policies are not all ahead of every hook: `onRequest` runs before any policy, and `beforePipeline`, `onValidation` and `beforeHandler` run between policy phases. Pre-validation policies sit between routing and `beforePipeline`; post-validation policies sit between `onValidation` and `beforeHandler`.

## A request that completes

<!-- observed: success -->
```text
hook onRequest
policy global-auth
policy group-tenant
policy route-owner
hook beforePipeline
middleware global
middleware group
middleware route
hook onValidation
policy route-post-check
hook beforeHandler
handler
hook afterHandler
hook afterPipeline
```

Hooks, policies and middleware appear in exactly the stage order above. `afterHandler` and `afterPipeline` close the request after the handler. The HTTP response for this request is `200`.

## What happens after a stop

How a request ends decides which later steps still run. The cases below come from the same application:

| Ending | Later stages | `afterHandler` | `afterPipeline` | `onError` |
|---|---|---|---|---|
| Completes | — | runs | runs | no |
| A policy denies or fails | skipped | no | **no** | runs |
| Middleware or a hook sends a response | skipped | no | runs | no |
| Handler throws | skipped | **no** | **no** | runs |
| `onNotFound` / `onMethodNotAllowed` sends a response | — | no | runs | no |
| No hook answers a 404 or 405 | — | no | no | runs |

A route policy denies the request:

<!-- observed: denied -->
```text
hook onRequest
policy global-auth
policy group-tenant
policy route-owner
hook onError
```

The first denial is terminal: later policies, middleware and the handler never run, and the trace is finalized before `onError`.

The very first global policy denies it, before group and route policies are asked:

<!-- observed: unauthenticated -->
```text
hook onRequest
policy global-auth
hook onError
```

Group middleware answers without calling `next()`:

<!-- observed: short-circuit -->
```text
hook onRequest
policy global-auth
policy group-tenant
policy route-owner
hook beforePipeline
middleware global
middleware group
hook afterPipeline
```

A response sent from middleware stops every later stage, but the request still completes through `afterPipeline` so logging and tracing close normally. `afterHandler` does not run because the handler did not.

The handler throws:

<!-- observed: handler-error -->
```text
hook onRequest
policy global-auth
policy group-tenant
policy route-owner
hook beforePipeline
middleware global
middleware group
middleware route
hook onValidation
policy route-post-check
hook beforeHandler
handler
hook onError
```

`beforeHandler` ran, `afterHandler` did not, and `onError` observed the failure. The status reaches the client through the adapter's error envelope.

## Where to go next

- [Routing and groups](/guide/routing-and-groups): how routes are matched, including HEAD, OPTIONS, 404 and 405.
- [Middleware and hooks](/guide/middleware-and-hooks): `next()`, short-circuits, which hooks may answer, and plugins.
- [Diagnose a 403](/guide/diagnose-403): read the recorded policy decisions when the request ends in a denial.
