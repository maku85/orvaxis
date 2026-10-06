# Typed input validation

Orvaxis can parse and transform the four request inputs of a route — `body`, `params`, `query` and `headers` — before the handler runs, and can infer the handler's types from what the validators return. Validation is opt-in: nothing is parsed unless the route declares a schema **and** `schemaValidationPlugin` is registered.

## Any validator with `.parse()`

A schema field is any object with a `parse(data)` method that returns the value or throws. Zod schemas qualify; so does a hand-written object. Orvaxis bundles no validator.

```ts
type SchemaField<TOutput = unknown> = { parse(data: unknown): TOutput }
type RouteSchema = { body?: SchemaField; params?: SchemaField; query?: SchemaField; headers?: SchemaField }
```

What goes into `parse`, and what it replaces, depends on the field:

| Field | Input to `parse` | Replaced by the parsed value |
|---|---|---|
| `body` | `ctx.req.body`, as the adapter parsed it | `ctx.req.body` |
| `params` | the path parameters, all strings | `ctx.params` (and `ctx.meta.route.params`) |
| `query` | `ctx.req.query` (`string` or `string[]` values) | `ctx.req.query` |
| `headers` | `ctx.req.headers` | `ctx.req.headers` |

So there are two values to keep apart: the **input** is what arrived (strings in `params`), the **output** is what the validator returned (a number after `z.coerce.number()`, a default, a transformed value). After validation the handler only sees the output; a validator that strips unknown keys also removes them from `ctx.req.headers` for later code.

Validation runs in the `onValidation` hook, after all middleware and before post-validation policies and the handler ([the stages](/guide/execution-model)).

## Types from the output: `defineRoute()`

On an ordinary route, request fields stay loosely typed. `defineRoute()` types each field from its validator's output:

<!-- snippet: examples/typed-schema.ts#schemas,route -->
```ts
const itemSchema = {
  body: z.object({ quantity: z.coerce.number() }),
  params: z.object({ id: z.coerce.number() }),
  query: z.object({ page: z.coerce.number().default(1) }),
  headers: z.object({ "x-user": z.string().transform((value) => value.length) }),
}

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
```

`ctx.params.id` is a `number`, `ctx.req.query.page` a `number` with a default, `ctx.req.headers["x-user"]` the length returned by the transform. Run `pnpm exec tsx examples/typed-schema.ts` to see the processed values at runtime. The older `defineRoute<TBody, TState>()` form with an explicit body type still works; to combine schema inference with a custom `ctx.state` type, pass the schema type first: `defineRoute<typeof schemas, AppState>({ ... })`.

## A failed parse is a 422

When a field does not parse, the request ends with `422` and `Validation failed: <field>`. The adapters send the standard error envelope, and `details` carries the validator's issues as `{ path, message }` pairs when it reports them (as Zod does). The handler does not run.

<!-- contract: invalid-body status,envelope,events -->
```json
{
  "status": 422,
  "envelope": {
    "error": "Validation failed: body",
    "details": [
      {
        "path": [
          "quantity"
        ],
        "message": "Invalid input: expected number, received NaN"
      }
    ],
    "requestId": "req-1"
  }
}
```

A path parameter that fails is rejected the same way, with `Validation failed: params`. Reproduce these with `pnpm exec tsx examples/contracts.ts`.

## Configuration errors are explicit

Orvaxis refuses to run a route it cannot validate, instead of handing the handler unvalidated data:

<!-- snippet: examples/contracts.ts#config-errors -->
```ts
// Two mistakes the runtime refuses to run, instead of evaluating against unvalidated data:
export function createMisconfiguredApps() {
  // 1. A defineRoute() route without schemaValidationPlugin registered.
  const missingPlugin = new Orvaxis()
  missingPlugin.group({
    prefix: "/api",
    routes: [
      defineRoute({
        method: "POST",
        path: "/items",
        schema: { body: z.object({ quantity: z.number() }) },
        handler: (ctx) => ctx.res.json({ quantity: ctx.req.body.quantity }),
      }),
    ],
  })

  // 2. A post-validation policy that requires `body` on a route that declares no body schema.
  const missingSchema = new Orvaxis()
  missingSchema.register(schemaValidationPlugin)
  missingSchema.group({
    prefix: "/api",
    routes: [
      {
        method: "POST",
        path: "/items",
        policies: [
          {
            name: "needs-body",
            phase: "postValidation",
            requires: ["body"],
            evaluate: () => ({ allow: true }),
          },
        ],
        handler: (ctx) => ctx.res.json({}),
      },
    ],
  })
  return { missingPlugin, missingSchema }
}
```

| Mistake | Result |
|---|---|
| A `defineRoute()` route and no `schemaValidationPlugin` | `500`: `Route defined with defineRoute() requires schemaValidationPlugin to validate its typed request fields` |
| A post-validation policy that `requires` a field the route has no schema for | `500`: `Post-validation policy "needs-body" requires route schema for: body` |

An ordinary route (not `defineRoute()`) with a schema but without the plugin is simply not validated: its schema is only read by tools such as [OpenAPI generation](/guide/openapi). Register the plugin once for the whole application.

## Policies that depend on parsed input

A policy with `phase: "postValidation"` runs after `onValidation`, so it reads parsed values. It must declare a non-empty `requires` list naming the fields it reads.

<!-- snippet: examples/contracts.ts#post-validation-policy -->
```ts
// Runs after `onValidation`, so `ctx.req.body` is the parsed value. `requires` lists the fields
// the policy reads; each must have a schema on the route.
const quota: Policy = {
  name: "quota",
  phase: "postValidation",
  requires: ["body"],
  evaluate(ctx) {
    events.push("policy quota")
    const { quantity } = ctx.req.body as { quantity: number }
    return quantity <= 10
      ? { allow: true }
      : { allow: false, status: 403, reason: "Quantity over quota" }
  },
}
```

Invalid data never reaches it. The same route, with a quantity of `-1`, is rejected by validation and the policy is not evaluated (`events` stays empty); with `50` it parses, the policy runs and denies:

<!-- contract: invalid-never-reaches-policy status,events -->
```json
{
  "status": 422,
  "events": []
}
```

<!-- contract: over-quota status,envelope,events -->
```json
{
  "status": 403,
  "envelope": {
    "error": "Quantity over quota",
    "requestId": "req-1"
  },
  "events": [
    "policy quota"
  ]
}
```

Pre-validation policies (the default) see raw input and are the right place for authentication and other early checks; see [How a request runs](/guide/execution-model) for how the two phases interleave with hooks.

## The request, end to end

<!-- snippet: examples/contracts.ts#request-route -->
```ts
app.group({
  prefix: "/api",
  routes: [
    defineRoute({
      method: "POST",
      path: "/items/:id",
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({ quantity: z.coerce.number().int().positive() }),
      },
      policies: [quota],
      responses: { 201: z.object({ id: z.number(), quantity: z.number() }) },
      handler: (ctx) => {
        events.push("handler")
        ctx.res.status(201).json({ id: ctx.params.id, quantity: ctx.req.body.quantity })
      },
    }),
  ],
})
```

A valid request (`quantity: "3"` is coerced to `3`) reaches the policy and the handler and answers `201`:

<!-- contract: valid status,body,events -->
```json
{
  "status": 201,
  "body": {
    "id": 7,
    "quantity": 3
  },
  "events": [
    "policy quota",
    "handler"
  ]
}
```

The route also declares a `201` contract; see [Response contracts](/guide/response-contracts).
