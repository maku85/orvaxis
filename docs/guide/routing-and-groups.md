# Routing and groups

Routes are declared in groups. A group contributes a path prefix, policies and middleware to every route it contains, and the router matches a request against the full path. This page describes the matching rules and the answers to requests that match nothing.

## Groups, prefixes and parameters

```ts
app.group({
  prefix: "/api",
  policies: [tenantPolicy],
  middleware: [auditMiddleware],
  routes: [
    { method: "GET", path: "/orders/:id", handler },
    { method: "POST", path: "/orders", handler },
  ],
})
```

- The prefix must start with `/` and, unless it is `/`, must not end with one. A route path is empty or starts with `/`. The full route template is `prefix + path`: `GET /api/orders/:id`.
- `:name` matches exactly one segment and is available as `ctx.params.name`.
- Everything declared on the group applies to all of its routes. Policies run global, then group, then route; middleware runs global, then group, then route. See [How a request runs](/guide/execution-model).
- Several groups may share a prefix, and the same pattern may exist under different prefixes or with different methods.
- `Route.method` is one of `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`; it is normalized to uppercase when registering and matching, and any other method is rejected with a `TypeError`.

## Nested groups

A group can contain groups. The child's `prefix` is appended to its parent's, and it inherits the parent's middleware, policies, `timeout` and `bodyLimit`:

```ts
app.group({
  prefix: "/api",
  policies: [authenticate],
  middleware: [requestLog],
  groups: [
    {
      prefix: "/tenants/:tenantId",
      policies: [tenantMember],
      routes: [{ method: "GET", path: "/projects", handler }],
      groups: [
        { prefix: "/admin", policies: [adminOnly], routes: [{ method: "GET", path: "/audit", handler }] },
      ],
    },
  ],
})
// GET /api/tenants/:tenantId/projects        -> authenticate, tenantMember
// GET /api/tenants/:tenantId/admin/audit     -> authenticate, tenantMember, adminOnly
```

- A parent may have no `routes`. A child prefix follows the same rules as a top-level one (starts with `/`, no trailing `/`); `"/"` adds nothing.
- Policies and middleware of the ancestors run before the child's, then the route's. A child's policies never apply to its parent's routes or to siblings.
- The policies of a group and its ancestors form one `group` layer, so `priority` orders them together: a child policy with a higher `priority` than its parent's runs first. Give an ancestor policy a higher priority than anything below it when it must always run first.
- Duplicate and conflicting routes are detected across levels, and `app.routes()`, `app.inspectRoutes()`, the protection report and span names show the full prefix.
- A route's own `timeout` and `bodyLimit` win over its group's, the nearest group wins over its parent (see [Timeouts](/guide/timeouts-and-shutdown#per-route-options)).

## Wildcards

A segment starting with `*` captures the rest of the path and must be last. `*filepath` is available as `ctx.params.filepath`; a bare `*` is `ctx.params["*"]`.

<!-- snippet: examples/wildcard-routing.ts#routes -->
```ts
app.group({
  prefix: "/",
  routes: [
    // Named wildcard: captures the full sub-path as `filepath`.
    // GET /files/docs/readme.md → filepath = "docs/readme.md"
    // GET /files/img/logo.png   → filepath = "img/logo.png"
    {
      method: "GET",
      path: "/files/*filepath",
      handler: async (ctx) => {
        // biome-ignore lint/style/noNonNullAssertion: route is always defined inside a route handler
        const { filepath } = ctx.meta.route!.params
        // In a real app you would resolve and stream the file from disk.
        ctx.res.json({ filepath })
      },
    },

    // More specific static routes registered under the same prefix
    // still win over the wildcard thanks to the static > param > wildcard priority.
    // GET /api/status → handled here, never falls through to the catch-all below.
    {
      method: "GET",
      path: "/api/status",
      handler: async (ctx) => {
        ctx.res.json({ status: "ok" })
      },
    },

    // Unnamed catch-all: matches any GET path not handled above.
    // The matched portion is available as params["*"].
    // GET /anything/at/all → params["*"] = "anything/at/all"
    {
      method: "GET",
      path: "/*",
      handler: async (ctx) => {
        ctx.res.status(404).json({ error: "Not Found", path: ctx.req.path })
      },
    },
  ],
})
```

Run it with `pnpm exec tsx examples/wildcard-routing.ts` (port 3005).

## Which route wins

At each segment the router prefers, in order, a static segment, then a `:param`, then a wildcard, and backtracks automatically if a more specific branch dead-ends. So `/users/me` beats `/users/:id`, which beats `/users/*`. Matching depends on the path depth, not on the number of routes.

## Conflicts are rejected at registration

Registering the same method and pattern twice throws immediately, as does naming the parameter at one position two ways for the same method:

```text
TypeError: Duplicate route: GET /api/users
TypeError: Route conflict: GET /api/:userId — param ":userId" conflicts with ":id" already registered at this position
```

## HEAD, OPTIONS, 404 and 405

These are the behaviors of the router and runtime as tested, using the application from the previous page:

- **HEAD** with no dedicated `HEAD` route falls back to the `GET` route. The `GET` route runs in full — policies, middleware, hooks and handler — and only the body is suppressed. A dedicated `HEAD` route always takes priority.
- **OPTIONS** on a path that has registered routes is answered with `204` and an `Allow` header listing the registered methods (`HEAD` is added when `GET` is registered). Only `onRequest` and, because the request completes, `afterPipeline` run; policies, middleware and the handler do not.
- **405** — the path exists but not for this method: `onMethodNotAllowed` runs (with `ctx.meta.allowedMethods` set), the response carries `Allow`, and without a hook that answers the request ends in a `405` error and `onError`.
- **404** — no route: `onNotFound` runs; if no hook answers, a `404` error and `onError` follow.

A hook that sends a response ends the request normally, so `onError` does not run and `afterPipeline` does:

<!-- observed: not-found -->
```text
hook onRequest
hook onNotFound
hook onError
```

<!-- observed: not-found-answered -->
```text
hook onRequest
hook onNotFound
hook afterPipeline
```

<!-- observed: method-not-allowed -->
```text
hook onRequest
hook onMethodNotAllowed
hook onError
```

<!-- observed: options -->
```text
hook onRequest
hook afterPipeline
```

## Inspecting routes

`app.routes()` lists every registered route as `{ method, path, prefix }` with the full template, and `app.inspectRoutes()` adds each route's policies, schema and response contracts without running anything. Use them for admin tooling, [OpenAPI export](/reference/core-concepts#response-contracts-and-openapi) and [CI checks](/guide/testing).
