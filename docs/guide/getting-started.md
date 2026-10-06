# Get started

This quickstart registers one authentication policy and one route-specific authorization policy. Express provides the HTTP transport; Orvaxis matches the declared route and invokes its handler.

## Install

Create a project and install Orvaxis, Express (the HTTP transport) a TypeScript runner and the type declarations Express does not bundle:

```bash
mkdir orvaxis-quickstart && cd orvaxis-quickstart
npm init -y
npm install orvaxis express
npm install -D tsx typescript @types/node @types/express
```

Orvaxis requires Node.js 22.13 or later. Install only the adapter peer dependency used by your application; Express and Fastify are optional peers, and `orvaxis`, `orvaxis/testing` and `orvaxis/openapi` need neither.

## Protect a route

Save this as `server.ts`:

<!-- snippet: examples/quickstart.ts#imports,app,serve -->
```ts
import { createExpressServer } from "orvaxis/express"
import { Orvaxis, type Policy } from "orvaxis"

const authenticate: Policy = {
  name: "authenticate-user",
  evaluate(ctx) {
    const userId = ctx.req.headers["x-user-id"]
    return typeof userId === "string"
      ? { allow: true, modify: { userId } }
      : { allow: false, status: 401, reason: "X-User-ID header required" }
  },
}

const ownerOnly: Policy = {
  name: "report-owner",
  evaluate(ctx) {
    return ctx.meta.userId === ctx.params.ownerId
      ? { allow: true }
      : { allow: false, status: 403, reason: "Only the report owner can view it" }
  },
}

const app = new Orvaxis()
app.policy(authenticate)
app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/reports/:ownerId",
      policies: [ownerOnly],
      handler: (ctx) => ctx.res.json({ ownerId: ctx.params.ownerId, report: "quarterly" }),
    },
  ],
})

createExpressServer(app).listen(3000)
```

Start it with `npx tsx server.ts`, then try an allowed, a denied and an unauthenticated request:

```bash
curl -i -H 'x-user-id: bob' http://localhost:3000/api/reports/alice   # 403
curl -i -H 'x-user-id: alice' http://localhost:3000/api/reports/alice  # 200
curl -i http://localhost:3000/api/reports/alice                       # 401
```

The 403 comes from `report-owner`, which denies the request before the handler runs; the 200 is the handler's response. The `x-user-id` header is only a demo identity input. Use identity established by trusted authentication middleware or verified tokens in an application.

This code is [`examples/quickstart.ts`](https://github.com/maku85/orvaxis/blob/main/examples/quickstart.ts); a repository script runs this exact snippet in a clean project against the packed package. Next, find out why a request was blocked in [Diagnose a 403](/guide/diagnose-403), or add policy checks around an existing route with [Integrate with an existing route](/guide/integrate-existing-route).
