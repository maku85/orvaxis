// #region imports
import { createExpressServer } from "../express"
import { Orvaxis, type Policy } from "../index"

// #endregion

// #region app
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
// #endregion

// #region serve
createExpressServer(app).listen(3000)
// #endregion
