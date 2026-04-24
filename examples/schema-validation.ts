import { z } from "zod"
import { Orvaxis, schemaValidationPlugin } from "../index"
import { createExpressServer } from "../http/expressAdapter"

const app = new Orvaxis()
app.register(schemaValidationPlugin)

const CreateUserBody = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
})

const UserParams = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
})

app.group({
  prefix: "/api",
  routes: [
    // POST /api/users — body validation
    {
      method: "POST",
      path: "/users",
      schema: { body: CreateUserBody },
      handler: async (ctx) => {
        // ctx.req.body is the Zod-parsed, coerced value
        ctx.res.status(201).json({ created: ctx.req.body })
      },
    },

    // GET /api/users/:id — params validation
    {
      method: "GET",
      path: "/users/:id",
      schema: { params: UserParams },
      handler: async (ctx) => {
        ctx.res.json({ id: ctx.meta.route?.params.id })
      },
    },
  ],
})

// Validation errors are exposed as thrown errors with status 422.
// Use an onError hook or error-handling middleware to shape the response.
app.on("onError", (ctx, err) => {
  const e = err as Error & { status?: number; field?: string }
  if (e.status === 422) {
    ctx.res.status(422).json({
      error: "Validation error",
      field: e.field,
      detail: e.cause instanceof Error ? e.cause.message : String(e.cause),
    })
  }
})

const server = createExpressServer(app)
server.listen(3003).catch(console.error)

// POST /api/users          { name: "Alice", age: 30 }  → 201 { created: { ... } }
// POST /api/users          { name: "", age: -1 }        → 422 { error: "Validation error", field: "body", ... }
// GET  /api/users/42                                    → 200 { id: "42" }
// GET  /api/users/abc                                   → 422 { error: "Validation error", field: "params", ... }
