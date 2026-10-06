import { z } from "zod"
import { defineRoute } from "../core/defineRoute"
import { Orvaxis } from "../core/Orvaxis"
import type { OrvaxisContext } from "../types"

const schemas = {
  body: z.object({ amount: z.coerce.number() }),
  params: z.object({ id: z.coerce.number() }),
  query: z.object({ page: z.coerce.number().default(1) }),
  headers: z.object({ "x-user": z.string().transform((value) => value.length) }),
}

defineRoute({
  method: "POST",
  path: "/items/:id",
  schema: schemas,
  handler(ctx) {
    const amount: number = ctx.req.body.amount
    const id: number = ctx.params.id
    const routeId: number | undefined = ctx.meta.route?.params.id
    const page: number = ctx.req.query.page
    const user: number = ctx.req.headers["x-user"]

    // @ts-expect-error the schema output is a number, not its string input
    const incorrect: string = ctx.req.body.amount
    // @ts-expect-error transformed params are numbers
    const incorrectParams: string = ctx.params.id
    // @ts-expect-error transformed query values are numbers
    const incorrectQuery: string = ctx.req.query.page
    // @ts-expect-error transformed header values are numbers
    const incorrectHeaders: string = ctx.req.headers["x-user"]
    void [
      amount,
      id,
      routeId,
      page,
      user,
      incorrect,
      incorrectParams,
      incorrectQuery,
      incorrectHeaders,
    ]
  },
})

type AuthState = { userId: string }
defineRoute<typeof schemas, AuthState>({
  method: "POST",
  path: "/typed-state/:id",
  schema: schemas,
  handler(ctx) {
    const id: number = ctx.params.id
    const userId: string = ctx.state.userId
    void [id, userId]
  },
})

defineRoute<z.infer<typeof schemas.body>>({
  method: "POST",
  path: "/legacy-body-generic",
  schema: { body: schemas.body },
  handler(ctx) {
    const amount: number = ctx.req.body.amount
    void amount
  },
})

// app.group() infers the state and meta types from handlers annotated with a typed context.
type GroupState = { user: { id: string } }
type GroupMeta = { apiKey: string }
const typedGroupApp = new Orvaxis()
typedGroupApp.group({
  prefix: "/typed",
  routes: [
    {
      method: "GET",
      path: "/me",
      handler: (ctx: OrvaxisContext<GroupState, GroupMeta>) => {
        const id: string = ctx.state.user.id
        const key: string = ctx.meta.apiKey
        // @ts-expect-error `user.id` is a string, not a number
        const wrong: number = ctx.state.user.id
        ctx.res.json({ id, key, wrong })
      },
    },
  ],
})
