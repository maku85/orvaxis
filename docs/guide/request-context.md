# Request context

Every request has one context object, `ctx`, passed to policies, middleware, hooks and handlers. This page covers what it holds, how to type it, how to reach it from code that was never handed `ctx`, and what keeps concurrent requests apart.

## What `ctx` holds

| Member | Owner | Use |
|---|---|---|
| `ctx.req`, `ctx.res` | the adapter | the request and the response; `ctx.req.signal` is aborted on timeout, disconnect and shutdown |
| `ctx.state` | **you** | per-request application data (the current user, a transaction); starts as `{}` |
| `ctx.meta` | the runtime and policies | framework fields (`route`, `trace`, `tracer`, `debug`) plus whatever a policy's `modify` returns |
| `ctx.params` | the runtime | shorthand for the matched route's parameters; `{}` when no route matched |
| `ctx.logs` | **you** | a short per-request list of strings; nothing in Orvaxis writes to it |
| `ctx.error` | the runtime | set when the request failed |

`ctx.meta.userId` set by an authentication policy via `{ allow: true, modify: { userId } }` is how earlier stages hand values to later ones; `ctx.state` is for your own code to keep per-request data.

## Typing `state` and `meta`

`OrvaxisContext` takes two optional type parameters:

<!-- snippet: examples/typed-context.ts#types -->
```ts
type AppState = {
  user: { id: string; role: "admin" | "user" }
}

type AppMeta = {
  apiKey: string
}

type AppContext = OrvaxisContext<AppState, AppMeta>
```

A handler annotated `(ctx: AppContext)` sees `ctx.state.user.role` and `ctx.meta.apiKey` as typed, and `app.group()` infers the two type parameters from such handlers (or takes them explicitly: `app.group<AppState, AppMeta>({ ... })`); the second parameter is intersected with the framework's own `ContextMeta`, so `ctx.meta.route` and `ctx.meta.trace` stay typed too. These are compile-time annotations: nothing validates `state` or `meta` at runtime.

## Reaching the context from anywhere: `getContext()`

`getContext()` returns the current request's context from any function called while that request is running — including after `await` — or `undefined` outside a request. `traceEvent()` uses the same mechanism and does nothing outside a request.

<!-- snippet: examples/typed-context.ts#service -->
```ts
async function getCurrentUserId(): Promise<string | undefined> {
  const ctx = getContext() as AppContext | undefined
  return ctx?.state.user?.id
}

async function logQuery(table: string) {
  // traceEvent picks up the current request context automatically
  traceEvent("db:query", { table })
}
```

Neither function takes `ctx`: that is the point, and also the cost. Code that reads `getContext()` depends on running inside a request, so keep such helpers in a thin layer and pass values explicitly where you can.

Requests to the example application behave as the comments in the source say:

<!-- context: me -->
```json
{
  "anon": {
    "status": 401,
    "message": "Missing X-API-Key header"
  },
  "keyed": {
    "status": 200,
    "body": {
      "id": "u-1",
      "apiKey": "k-123"
    }
  }
}
```

## Isolation between requests

The context is stored with `AsyncLocalStorage`, so concurrent requests each see their own, even when their handlers interleave at `await` points: two overlapping requests that wait different amounts of time each read back their own `ctx.params` through `getContext()`. State kept in module-level variables is **not** isolated; use `ctx.state` for per-request data and your own store for shared data.

## `ctx.logs`

`ctx.logs` is a bounded `string[]` for short audit trails and test assertions. It holds at most 1,000 entries by default; pushing beyond that drops the entry and writes one `console.warn` per request. Change the cap with `new Orvaxis({ logsMaxSize: 5000 })`. It is not a logger: nothing reads it unless your code does (for example in an `afterPipeline` hook), and it is not forwarded to traces, logs or spans. For volume, use a real logger ([Observability](/guide/observability)).

## Examples

- [`examples/typed-context.ts`](https://github.com/maku85/orvaxis/blob/main/examples/typed-context.ts): typed state and meta, `getContext()` in a service function, `traceEvent()` without `ctx` (`pnpm exec tsx examples/typed-context.ts`, port 3004).
- [`examples/debug-trace.ts`](https://github.com/maku85/orvaxis/blob/main/examples/debug-trace.ts): the debugger and `buildExecutionSummary` on a live server (port 3003).
