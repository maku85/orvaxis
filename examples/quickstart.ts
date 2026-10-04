import { createExpressServer } from "../express"
import { Orvaxis, type Policy } from "../index"

const authenticate: Policy = {
  name: "authenticate-user",
  evaluate(ctx) {
    const userId = ctx.req.headers["x-user-id"]
    if (typeof userId !== "string") {
      return { allow: false, status: 401, reason: "X-User-ID header required" }
    }
    return { allow: true, modify: { userId } }
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

const port = Number(process.env.PORT ?? 3000)
createExpressServer(app)
  .listen(port)
  .then(() => console.log(`Quickstart listening at http://localhost:${port}`))
