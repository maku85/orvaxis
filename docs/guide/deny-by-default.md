# Deny by default

A forgotten policy is the most common way an authorization hole ships: a new route is added, nobody attaches a check, and it works. `denyByDefault` turns that into an error before the server accepts a request.

```ts
const app = new Orvaxis({ denyByDefault: true })
```

With it on, every route must be **covered** or declare itself **public**.

## What counts as covered

A route is covered when at least one policy applies to it **unconditionally**: a global, group or route policy with no `scope`, or one whose scope matches the route statically (a `"/api"` path scope on a route under `/api`, a `method` scope equal to the route's method). Orvaxis decides this from the same analysis as `app.inspectRoutes()`, without running any policy.

A policy whose scope depends on the request (a predicate function, a `RegExp`, a path that runs through a `:parameter`) does **not** count, because it may not run for that route. Cover the route with an unscoped policy, or mark it `public: true`.

## Declaring a public route

```ts
app.group({
  prefix: "/",
  routes: [{ method: "GET", path: "/health", public: true, handler: (ctx) => ctx.res.json({ ok: true }) }],
})
```

`public: true` is a declaration for the check, not a bypass: it does not skip any policy. A global policy still runs on a public route and can deny it. `inspectRoutes()` reports it as `public: true`, so a review can see which routes opted out.

## When it fails

- **At startup.** `createExpressServer(app).listen()` and `createFastifyServer(app).listen()` reject with a `TypeError` that lists every uncovered route (`GET /api/forgotten, ...`) and says how to fix it. The server never starts.
- **At request time, as a safety net.** A request that reaches an uncovered route anyway (a custom adapter, `testRequest`, the Express policy guard) fails with `500` and code `ROUTE_UNPROTECTED`, and its handler does not run. The check is recomputed when groups or global policies are added.

## Without enabling it

The two checks are available separately, so you can run them in a test or at startup:

```ts
app.unprotectedRoutes() // [{ method: "GET", path: "/api/forgotten", prefix: "/api" }]
app.assertProtected()   // throws a TypeError naming them
```

`checkPolicyRequirements()` answers a different question: whether *specific* policies are present on *specific* routes. Use it with this one; see [Authorization checks in CI](/articles/authorization-requirements-in-ci).

## Limits

Coverage says a policy is attached, not that it decides correctly: an `allow: true` policy covers a route. Pair it with a permission matrix ([Testing](/guide/testing)). Routes that Orvaxis does not own (Express routes outside the adapter or the guard) are outside the check.
