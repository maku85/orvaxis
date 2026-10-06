import { z } from "zod"
import { Orvaxis, type Policy, schemaValidationPlugin } from "../../index"

// The application the testing guide tests. Nothing here is specific to testing: it is an
// ordinary Orvaxis app with a policy, input validation, middleware, a failing route and a stream.

export function createApp(options: { brokenAuthentication?: boolean } = {}) {
  const authenticate: Policy = {
    name: "authenticate",
    evaluate: (ctx) => {
      const user = ctx.req.headers["x-user"]
      if (options.brokenAuthentication) return { allow: true } // a bug: lets everyone in
      return typeof user === "string"
        ? { allow: true, modify: { user } }
        : { allow: false, status: 401, reason: "Sign in first" }
    },
  }

  const ownerOrAdmin: Policy = {
    name: "owner-or-admin",
    evaluate: (ctx) =>
      ctx.meta.user === ctx.params.id || ctx.meta.user === "root"
        ? { allow: true }
        : { allow: false, status: 403, reason: "Not your profile" },
  }

  const app = new Orvaxis()
  app.register(schemaValidationPlugin)
  app.policy(authenticate)

  app.group({
    prefix: "/api",
    // Middleware leaves a mark on the request state so a test can see it ran.
    middleware: [
      async (ctx, next) => {
        ctx.state.audited = true
        await next()
      },
    ],
    routes: [
      {
        method: "GET",
        path: "/users/:id",
        policies: [ownerOrAdmin],
        handler: (ctx) => ctx.res.json({ id: ctx.params.id }),
      },
      {
        method: "POST",
        path: "/users",
        schema: { body: z.object({ name: z.string().min(1) }) },
        handler: (ctx) =>
          ctx.res.status(201).json({ name: (ctx.req.body as { name: string }).name }),
      },
      {
        method: "GET",
        path: "/report",
        handler: () => {
          throw new Error("report failed")
        },
      },
      {
        method: "GET",
        path: "/stream",
        handler: (ctx) => {
          ctx.res.write("chunk1")
          ctx.res.write("chunk2")
          ctx.res.end()
        },
      },
    ],
  })
  return app
}
