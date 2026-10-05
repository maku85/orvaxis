# Add Orvaxis to an existing Express route

Use `createExpressPolicyGuard()` when Express already owns the route handler and you want to add Orvaxis authorization without moving that handler. Orvaxis evaluates a matching route declaration, then Express continues to its existing handler only when every applicable pre-validation policy allows the request.

Install Orvaxis and Express if they are not already present:

```bash
npm install orvaxis express
```

Declare the policy and mirror the protected method and path in Orvaxis. Keep the actual handler in Express:

```bash
pnpm exec tsx examples/express-existing-route.ts
```

This starts the working example on port `3005`. Try one request where the owner matches and one where it does not:

```bash
curl -i -H 'x-user-id: alice' http://localhost:3005/api/documents/alice  # 200
curl -i -H 'x-user-id: bob' http://localhost:3005/api/documents/alice    # 403
```

The implementation lives in [`examples/express-existing-route.ts`](https://github.com/maku85/orvaxis/blob/main/examples/express-existing-route.ts) so the guide and runnable source stay aligned.

Mount the guard after middleware that parses the body or establishes identity, and before the existing handler. The guard adapts the Express request for Orvaxis, so policies can inspect request fields established by earlier Express middleware. The header in this example is only a demonstration input; use verified authentication state in production. Values returned through `modify` are available to later Express middleware at `res.locals.orvaxis`.

The guard executes only pre-validation Orvaxis policies. It does not run Orvaxis plugins, middleware, request validation, or the route handler. A mirrored route that uses `defineRoute()` or post-validation policies is rejected because those require full Orvaxis execution. To roll back, remove the guard from the Express route and its mirrored Orvaxis declaration.

For a new route where Orvaxis should own routing and the handler too, use the [getting-started guide](/guide/getting-started) and an adapter instead.
