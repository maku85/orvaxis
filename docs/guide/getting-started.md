# Get started

This quickstart registers one authentication policy and one route-specific authorization policy. Express provides the HTTP transport; Orvaxis matches the declared route and invokes its handler.

## Install

```bash
npm install orvaxis express
```

Orvaxis requires Node.js 22.13 or later. Install only the adapter peer dependency used by your application; Express and Fastify are optional peers.

## Protect a route

```ts
import { Orvaxis, type Policy } from "orvaxis"
import { createExpressServer } from "orvaxis/express"

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
  routes: [{
    method: "GET",
    path: "/reports/:ownerId",
    policies: [ownerOnly],
    handler: (ctx) => ctx.res.json({ ownerId: ctx.params.ownerId, report: "quarterly" }),
  }],
})

createExpressServer(app).listen(3000)
```

Try an allowed and denied request after starting the server:

```bash
curl -i -H 'x-user-id: bob' http://localhost:3000/api/reports/alice
curl -i -H 'x-user-id: alice' http://localhost:3000/api/reports/alice
```

The first request returns 403 because `report-owner` denies it; the second returns 200. The `x-user-id` header is only a demo identity input. Use identity established by trusted authentication middleware or verified tokens in an application.

For the runnable source and full commands, see [`examples/quickstart.ts`](https://github.com/maku85/orvaxis/blob/main/examples/quickstart.ts). To add policy checks around an existing route instead, use [Integrate with an existing route](/guide/integrate-existing-route).
