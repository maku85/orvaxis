# Middleware and hooks

Middleware shapes the flow of a request; hooks observe it at fixed points; plugins package both. This page states what each may do, in what order, and what is left running when something stops. Positions in the request flow are in [How a request runs](/guide/execution-model).

## Middleware order and `next()`

Three layers of middleware run in this order: global (`app.use()`), then the route's group, then the route. Within a layer, middleware runs in declaration order.

```ts
app.use(requestId)                       // global
app.group({
  prefix: "/api",
  middleware: [tenantContext],          // group
  routes: [{ method: "GET", path: "/orders", middleware: [audit], handler }], // route
})
```

`next()` follows the contract below. These points were checked against the runtime:

- **Each layer is its own chain.** `await next()` runs the rest of the *current layer* and returns. Code after it runs before the next layer starts: with two global, two group and one route middleware, the order is `global-1 before, global-2 before, global-2 after, global-1 after, group-1 before, group-2 before, group-2 after, group-1 after, route-1 before, route-1 after`, and only then the handler. The handler is not inside any `next()`.
- **Return without `next()` and the request stops.** Later middleware layers, validation and the handler do not run. Send a response or throw before returning; otherwise the connection can stay open until the adapter's timeout. The request still completes through `afterPipeline`.
- **Sending a response stops later stages**, even if the middleware then calls `next()`.
- **Calling `next()` twice is harmless**: the second call does nothing.
- **A thrown error leaves the request.** It skips the remaining stages, finalizes the trace, and reaches `onError` and then the adapter. Middleware can recover from errors thrown by later middleware *in its own layer* by wrapping `await next()` in `try`/`catch` and sending a response; the request then completes through `afterPipeline` and `onError` does not run.

A short-circuit that answers on purpose:

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

## Three kinds of hook

Hooks are registered with `app.on(name, fn)` and run in registration order. They differ in what they may do.

| Hook | Runs | May answer the request? | If it throws |
|---|---|---|---|
| `onRequest` | first, before routing | yes | the request fails with that error |
| `onNotFound`, `onMethodNotAllowed` | when routing finds nothing | yes — it replaces the default 404/405 | the request fails |
| `beforePipeline` | after pre-validation policies | yes | the request fails |
| `onValidation` | after all middleware | yes | the request fails |
| `beforeHandler` | after post-validation policies | yes | the request fails |
| `afterHandler` | after the handler completed | not usefully — the handler has already run | the request fails |
| `afterPipeline` | last, after the trace is finalized | not usefully | the request fails |
| `onError` | when a request fails | possible, but see below | logged; the original error is kept |

1. **Hooks that may answer** (`onRequest`, `onNotFound`, `onMethodNotAllowed`, `beforePipeline`, `onValidation`, `beforeHandler`). A response sent from one of them ends the request normally: later stages are skipped, `afterPipeline` runs, `onError` does not.
2. **Observation hooks** (`afterHandler`, `afterPipeline`, `onError`). Use them for timing, logging and cleanup. `afterHandler` runs only when the handler ran **and** completed; `afterPipeline` runs for every request that completes, including a short-circuit and a hook-answered 404, but **not** for a request that fails with an error; `onError` runs only for requests that fail.
3. **Plugins** register hooks (and middleware or policies) from `apply(runtime)`. `app.register(plugin)` rejects a second plugin with the same name with a `TypeError`.

Details worth knowing:

- An error thrown by a hook other than `onError` fails the request even when the response is already on its way: a throwing `afterHandler` after the handler sent `200` still reaches `onError`, and the adapter logs the error because the response was sent. If several hooks of the same kind throw, the error is an `AggregateError`.
- A failing `onError` hook never replaces the original error; its own failure is only logged.
- `onError` can send a response if none was sent, but the error is still passed on to the adapter, which then logs it instead of building its error envelope. To turn an error into a response, recover in middleware instead.

## A feature gate is a policy

A request condition that is not about permissions — a feature switched on or off — fits a policy as well as a role check does, and it runs at the same place with the same record of decisions. Orvaxis has no feature-flag service: the policy consults whatever state your application defines.

<!-- snippet: examples/execution-order.ts#feature-gate -->
```ts
// A feature gate is an ordinary policy that consults application-defined state. Orvaxis has no
// feature-flag service; `enabledFeatures` stands in for whatever store your application uses.
export const enabledFeatures = new Set<string>(["reports"])

export const featureGate = (feature: string): Policy => ({
  name: `feature:${feature}`,
  evaluate: () =>
    enabledFeatures.has(feature)
      ? { allow: true }
      : { allow: false, status: 404, reason: "Feature not available" },
})
```

Attach it where it applies (`policies: [featureGate("reports")]` on a route or group). With the feature off, the request is denied with `404`, the handler never runs, and the denial appears in the trace as the terminal decision like any other. See the [cookbook](/cookbook#_4-feature-flags) for a path-scoped version that loads the flag asynchronously.

## Examples

- [`examples/execution-order.ts`](https://github.com/maku85/orvaxis/blob/main/examples/execution-order.ts): the application behind these pages; run it with `pnpm exec tsx examples/execution-order.ts`.
- [`examples/hooks-and-plugins.ts`](https://github.com/maku85/orvaxis/blob/main/examples/hooks-and-plugins.ts): `loggerPlugin`, handler timing with `beforeHandler`/`afterHandler`, branded 404 and 405 answers, and an `onError` hook.
- [`examples/wildcard-routing.ts`](https://github.com/maku85/orvaxis/blob/main/examples/wildcard-routing.ts): wildcard routes (see [Routing and groups](/guide/routing-and-groups)).
- [Cookbook](/cookbook): authentication, role-based access, scoping, feature flags, tracing and audit logging.
