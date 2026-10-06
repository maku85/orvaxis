import { basename } from "node:path"
import { z } from "zod"
import { testRequest } from "../core/testHarness"
import { type Middleware, Orvaxis, type Policy, schemaValidationPlugin } from "../index"

// One application that records everything the runtime does around a request, so the order of
// hooks, policies and middleware can be read off instead of assumed. `events` is filled by the
// application's own hooks, policies and middleware; Orvaxis adds nothing to it.

// #region feature-gate
// A feature gate is an ordinary policy that consults application-defined state. Orvaxis has no
// feature-flag service; `enabledFeatures` stands in for whatever store your application uses.
export const enabledFeatures = new Set<string>(["reports"])

export const featureGate = (feature: string): Policy => ({
  name: `feature:${feature}`,
  evaluate: () =>
    enabledFeatures.has(feature)
      ? { allow: true }
      : { allow: false, status: 404, reason: "Feature not available" },
})
// #endregion

export function createOrderedApp(events: string[], options: { answerNotFound?: boolean } = {}) {
  const note = (label: string) => () => {
    events.push(label)
  }
  const policy = (
    name: string,
    decide: (ctx: Parameters<Policy["evaluate"]>[0]) => boolean
  ): Policy => ({
    name,
    evaluate: (ctx) => {
      events.push(`policy ${name}`)
      return decide(ctx) ? { allow: true } : { allow: false, status: 403, reason: "denied" }
    },
  })
  const middleware =
    (label: string, stopWhen?: (header: unknown) => boolean): Middleware =>
    async (ctx, next) => {
      events.push(`middleware ${label}`)
      if (stopWhen?.(ctx.req.headers["x-stop"])) {
        ctx.res.status(202).json({ stoppedBy: label })
        return
      }
      await next()
    }

  // #region app
  const app = new Orvaxis()
  app.register(schemaValidationPlugin)

  // Hooks observe the lifecycle; the ones that run before the handler may also send a response.
  for (const hook of [
    "onRequest",
    "beforePipeline",
    "onValidation",
    "beforeHandler",
    "afterHandler",
    "afterPipeline",
  ] as const) {
    app.on(hook, note(`hook ${hook}`))
  }
  app.on("onError", note("hook onError"))
  app.on("onNotFound", (ctx) => {
    events.push("hook onNotFound")
    // A hook that sends a response ends the request normally: onError is not triggered.
    if (options.answerNotFound) ctx.res.status(404).json({ error: "Not Found" })
  })
  app.on("onMethodNotAllowed", note("hook onMethodNotAllowed"))

  app.policy(policy("global-auth", (ctx) => ctx.req.headers["x-user"] !== undefined))
  app.use(middleware("global"))

  app.group({
    prefix: "/api",
    policies: [policy("group-tenant", (ctx) => ctx.req.headers["x-tenant"] !== "blocked")],
    middleware: [middleware("group", (header) => header === "group")],
    routes: [
      {
        method: "GET",
        path: "/orders/:id",
        schema: { params: z.object({ id: z.string() }) },
        policies: [
          policy("route-owner", (ctx) => ctx.req.headers["x-user"] !== "mallory"),
          {
            ...policy("route-post-check", () => true),
            phase: "postValidation",
            requires: ["params"],
          },
        ],
        middleware: [middleware("route", (header) => header === "route")],
        handler: (ctx) => {
          events.push("handler")
          if (ctx.req.headers["x-fail"]) throw new Error("handler failed")
          ctx.res.json({ id: ctx.params.id })
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
  request: Parameters<typeof testRequest>[1]
  answerNotFound?: boolean
}

export const orderScenarios: Scenario[] = [
  {
    id: "success",
    label: "A request that completes",
    request: { path: "/api/orders/42", headers: { "x-user": "alice" } },
  },
  {
    id: "denied",
    label: "A route policy denies it",
    request: { path: "/api/orders/42", headers: { "x-user": "mallory" } },
  },
  {
    id: "unauthenticated",
    label: "The first global policy denies it",
    request: { path: "/api/orders/42" },
  },
  {
    id: "short-circuit",
    label: "Group middleware answers without calling next()",
    request: { path: "/api/orders/42", headers: { "x-user": "alice", "x-stop": "group" } },
  },
  {
    id: "handler-error",
    label: "The handler throws",
    request: { path: "/api/orders/42", headers: { "x-user": "alice", "x-fail": "1" } },
  },
  {
    id: "head",
    label: "HEAD falls back to the GET route",
    request: { path: "/api/orders/42", method: "HEAD", headers: { "x-user": "alice" } },
  },
  {
    id: "not-found",
    label: "No route matches",
    request: { path: "/api/missing", headers: { "x-user": "alice" } },
  },
  {
    id: "not-found-answered",
    label: "No route matches and onNotFound answers",
    request: { path: "/api/missing", headers: { "x-user": "alice" } },
    answerNotFound: true,
  },
  {
    id: "method-not-allowed",
    label: "The path exists but not for this method",
    request: { path: "/api/orders/42", method: "POST", headers: { "x-user": "alice" } },
  },
  {
    id: "options",
    label: "OPTIONS on a registered path",
    request: { path: "/api/orders/42", method: "OPTIONS", headers: { "x-user": "alice" } },
  },
]

export async function observe(scenario: Scenario) {
  const events: string[] = []
  const app = createOrderedApp(events, { answerNotFound: scenario.answerNotFound })
  const result = await testRequest(app, scenario.request)
  return { events, status: result.status, headers: result.headers }
}

if (basename(process.argv[1] ?? "") === "execution-order.ts") {
  for (const scenario of orderScenarios) {
    observe(scenario).then(({ events, status }) => {
      console.log(`=== ${scenario.label} (${status}) ===\n${events.join("\n")}\n`)
    })
  }
}
