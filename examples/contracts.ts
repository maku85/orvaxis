import { basename } from "node:path"
import { z } from "zod"
import { testRequest } from "../core/testHarness"
import {
  buildErrorBody,
  defineRoute,
  Orvaxis,
  type Policy,
  responseValidationPlugin,
  schemaValidationPlugin,
} from "../index"

// Request validation, post-validation policies and response contracts in one application.
// `events` is filled by the application's own policy, handler and violation callback.

type Mode = "strict" | "warn"

export function createContractsApp(events: string[], mode: Mode = "strict") {
  const app = new Orvaxis()
  app.register(schemaValidationPlugin)
  app.register(
    responseValidationPlugin({
      mode,
      onViolation: (issue) => events.push(`violation ${issue.kind} status ${issue.status}`),
    })
  )

  // #region post-validation-policy
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
  // #endregion

  // #region request-route
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
  // #endregion

  // #region response-routes
  app.group({
    prefix: "/api/contracts",
    routes: [
      {
        // The schema is chosen by the status the handler sets; 404 has its own contract.
        method: "GET",
        path: "/lookup/:id",
        responses: {
          200: z.object({ id: z.string(), name: z.string() }),
          404: z.object({ error: z.string() }),
        },
        handler: (ctx) => {
          if (ctx.params.id === "missing")
            return ctx.res.status(404).json({ error: "No such item" })
          if (ctx.params.id === "teapot") return ctx.res.status(418).json({ anything: true })
          ctx.res.json({ id: ctx.params.id, name: ctx.params.id === "bad" ? 42 : "Example" })
        },
      },
      {
        // Validator output is what the client receives, so transforms apply to responses too.
        method: "GET",
        path: "/price",
        responses: { 200: z.object({ price: z.number().transform((n) => n.toFixed(2)) }) },
        handler: (ctx) => ctx.res.json({ price: 5 }),
      },
      {
        // Streaming is never buffered, so a declared schema cannot be checked.
        method: "GET",
        path: "/stream",
        responses: { 200: z.string() },
        handler: (ctx) => {
          ctx.res.write("data: hello\n\n")
          ctx.res.end()
        },
      },
    ],
  })
  // #endregion
  return app
}

type Scenario = {
  id: string
  label: string
  mode?: Mode
  request: Parameters<typeof testRequest>[1]
}

const post = (id: string, body: unknown) => ({
  method: "POST",
  path: `/api/items/${id}`,
  body,
})

export const contractScenarios: Scenario[] = [
  { id: "valid", label: "A valid request", request: post("7", { quantity: "3" }) },
  {
    id: "invalid-body",
    label: "The body fails its schema",
    request: post("7", { quantity: "many" }),
  },
  {
    id: "invalid-params",
    label: "A path parameter fails its schema",
    request: post("abc", { quantity: 3 }),
  },
  {
    id: "over-quota",
    label: "Valid data, but the post-validation policy denies it",
    request: post("7", { quantity: 50 }),
  },
  {
    id: "invalid-never-reaches-policy",
    label: "Invalid data never reaches the policy",
    request: post("7", { quantity: -1 }),
  },
  {
    id: "lookup-ok",
    label: "Response matches the 200 contract",
    request: { path: "/api/contracts/lookup/a" },
  },
  {
    id: "lookup-invalid-strict",
    label: "Response violates the 200 contract (strict)",
    request: { path: "/api/contracts/lookup/bad" },
  },
  {
    id: "lookup-invalid-warn",
    label: "Response violates the 200 contract (warn)",
    mode: "warn",
    request: { path: "/api/contracts/lookup/bad" },
  },
  {
    id: "lookup-404",
    label: "A 404 is checked against the 404 contract",
    request: { path: "/api/contracts/lookup/missing" },
  },
  {
    id: "lookup-undeclared",
    label: "A status with no declared contract passes through",
    request: { path: "/api/contracts/lookup/teapot" },
  },
  {
    id: "transformed",
    label: "A transform in the contract changes what is sent",
    request: { path: "/api/contracts/price" },
  },
  {
    id: "stream-strict",
    label: "Streaming a route with a response schema (strict)",
    request: { path: "/api/contracts/stream" },
  },
  {
    id: "stream-warn",
    label: "Streaming a route with a response schema (warn)",
    mode: "warn",
    request: { path: "/api/contracts/stream" },
  },
]

export async function runContract(scenario: Scenario) {
  const events: string[] = []
  const app = createContractsApp(events, scenario.mode ?? "strict")
  const result = await testRequest(app, scenario.request)
  const error = result.error as (Error & { details?: unknown; status?: number }) | undefined
  return {
    status: result.status,
    // What the HTTP adapters send for a failed request: the standard error envelope.
    envelope: error ? buildErrorBody(error, "req-1") : undefined,
    body: result.body,
    chunks: result.chunks,
    events,
  }
}

// #region config-errors
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
// #endregion

if (basename(process.argv[1] ?? "") === "contracts.ts") {
  ;(async () => {
    for (const scenario of contractScenarios) {
      const r = await runContract(scenario)
      console.log(
        `=== ${scenario.label} ===\n${JSON.stringify({ status: r.status, envelope: r.envelope, body: r.body, chunks: r.chunks.length ? r.chunks : undefined, events: r.events }, null, 2)}\n`
      )
    }
    const apps = createMisconfiguredApps()
    for (const [name, app] of Object.entries(apps)) {
      const r = await testRequest(app, {
        method: "POST",
        path: "/api/items",
        body: { quantity: 1 },
      })
      console.log(`=== config: ${name} ===\n${r.status} ${r.error?.message}`)
    }
  })()
}
