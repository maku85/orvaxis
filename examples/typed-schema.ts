import { z } from "zod"
import { defineRoute, Orvaxis, schemaValidationPlugin } from "../index"
import { testRequest } from "../testing"

// #region schemas
const itemSchema = {
  body: z.object({ quantity: z.coerce.number() }),
  params: z.object({ id: z.coerce.number() }),
  query: z.object({ page: z.coerce.number().default(1) }),
  headers: z.object({ "x-user": z.string().transform((value) => value.length) }),
}
// #endregion

// #region route
const app = new Orvaxis()
app.register(schemaValidationPlugin) // required for every defineRoute() route

app.group({
  prefix: "/api",
  routes: [
    defineRoute({
      method: "POST",
      path: "/items/:id",
      schema: itemSchema,
      handler: (ctx) => {
        const response: {
          quantity: number
          id: number
          page: number
          userHeaderLength: number
        } = {
          quantity: ctx.req.body.quantity,
          id: ctx.params.id,
          page: ctx.req.query.page,
          userHeaderLength: ctx.req.headers["x-user"],
        }
        ctx.res.json(response)
      },
    }),
  ],
})
// #endregion

async function main() {
  const result = await testRequest(app, {
    method: "POST",
    path: "/api/items/42",
    body: { quantity: "3" },
    query: { page: "2" },
    headers: { "x-user": "alice" },
  })
  console.log(result.status, result.body)
  if (result.status !== 200) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "Typed schema demo failed")
  process.exitCode = 1
})
