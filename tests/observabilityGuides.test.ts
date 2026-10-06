import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { createPluggedApp } from "../examples/custom-plugin"
import { compact, observe, observedScenarios } from "../examples/observability"
import { otelScenarios, outline, recordSpans } from "../examples/otel-local"
import { app as typedContextApp } from "../examples/typed-context"
import { corsPlugin, getContext, Orvaxis, traceEvent } from "../index"
import { testRequest } from "../testing"

// Keeps the observability guides honest: printed records are produced by the examples and compared
// with the runtime here; each rule stated in prose has a check.
const read = (name: string) => readFileSync(`docs/guide/${name}.md`, "utf8")
const blocks = (text: string, kind: string, lang: string) =>
  [
    ...text.matchAll(
      new RegExp(`<!-- ${kind}: (\\S+) -->\\n\`\`\`${lang}\\n([\\s\\S]*?)\\n\`\`\``, "g")
    ),
  ].map((match) => ({ id: match[1], printed: match[2] }))

describe("printed records", () => {
  it.each(
    observedScenarios.map((s) => s.id)
  )("observability scenario %s matches the runtime", async (id) => {
    const scenario = observedScenarios.find((s) => s.id === id)
    if (!scenario) throw new Error("unknown scenario")
    const printed = blocks(read("observability"), "observability", "json").filter(
      (b) => b.id === id
    )
    expect(printed).toHaveLength(1)
    expect(JSON.parse(printed[0].printed)).toEqual(
      JSON.parse(JSON.stringify(compact(await observe(scenario))))
    )
  })

  it.each(otelScenarios.map((s) => s.id))("span outline %s matches the plugin", async (id) => {
    const scenario = otelScenarios.find((s) => s.id === id)
    if (!scenario) throw new Error("unknown scenario")
    const printed = blocks(read("opentelemetry"), "spans", "text").filter((b) => b.id === id)
    expect(printed).toHaveLength(1)
    expect(printed[0].printed).toBe(outline(await recordSpans(scenario)))
  })

  it("prints the root span attributes the plugin sets", async () => {
    const [printed] = blocks(read("opentelemetry"), "attributes", "json")
    const [root] = await recordSpans(otelScenarios[0])
    expect(JSON.parse(printed.printed)).toEqual(root.attributes)
  })

  it("prints what the context example answers", async () => {
    const [printed] = blocks(read("request-context"), "context", "json")
    const anonymous = await testRequest(typedContextApp, { path: "/api/me" })
    const keyed = await testRequest(typedContextApp, {
      path: "/api/me",
      headers: { "x-api-key": "k-123" },
    })
    expect(JSON.parse(printed.printed)).toEqual({
      anon: { status: anonymous.status, message: anonymous.error?.message },
      keyed: { status: keyed.status, body: keyed.body },
    })
  })
})

describe("observability rules", () => {
  it("separates the runtime outcome from the response, and keeps policy decisions bounded", async () => {
    const stream = await observe(
      observedScenarios.find((s) => s.id === "stream") ?? observedScenarios[0]
    )
    expect(stream.trace).toMatchObject({
      outcome: "success",
      responseSentAtRuntimeEnd: true,
      responseCompletedAtRuntimeEnd: false,
    })
    const denied = await observe(
      observedScenarios.find((s) => s.id === "denied") ?? observedScenarios[0]
    )
    expect(denied.report.terminalDecision).toMatchObject({
      state: "recorded",
      policy: "authenticate",
    })
    expect(denied.logs.map(([, record]) => record.type)).toEqual(["request", "error"]) // no response record
  })

  it("does not redact what loggerPlugin logs", async () => {
    const failed = await observe(
      observedScenarios.find((s) => s.id === "handler-error") ?? observedScenarios[0]
    )
    const [, errorRecord] = failed.logs.find(([level]) => level === "error") ?? []
    expect(errorRecord).toMatchObject({ type: "error", message: "database password is hunter2" })
    const ok = await observe(observedScenarios[0])
    expect(ok.logs[0][1]).toMatchObject({ path: "/api/orders/42" })
    // Policy-decision data and reports, by contrast, never carry the message.
    expect(JSON.stringify(failed.report)).not.toContain("hunter2")
  })

  it("makes the debugger's enabled flag read-only", () => {
    const app = new Orvaxis()
    expect(() => {
      ;(app.debugger as unknown as { enabled: boolean }).enabled = true
    }).toThrow(TypeError)
    app.debugger.enable()
    expect(app.debugger.enabled).toBe(true)
  })

  it("emits trace events only inside a request", async () => {
    expect(() => traceEvent("outside")).not.toThrow()
    expect(getContext()).toBeUndefined()
  })

  it("records policy decisions according to the mode", async () => {
    const decisionsFor = async (policyTrace: ConstructorParameters<typeof Orvaxis>[0]) => {
      const app = new Orvaxis(policyTrace)
      app.policy({ name: "p", evaluate: () => ({ allow: false, reason: "private reason" }) })
      app.group({ prefix: "/", routes: [{ method: "GET", path: "/x", handler: () => {} }] })
      const result = await testRequest(app, { path: "/x" })
      return (
        result.ctx?.meta.trace?.events
          .filter((event) => event.type === "POLICY_DECISION")
          .map((e) => e.meta) ?? []
      )
    }
    const [summary] = await decisionsFor({ policyTrace: { mode: "summary" } })
    expect(summary).toMatchObject({
      policy: "p",
      policyId: "global:0",
      layer: "global",
      outcome: "deny",
    })
    expect(summary).not.toHaveProperty("reason")
    const [detailed] = await decisionsFor({
      policyTrace: { mode: "detailed", redact: () => "[redacted]" },
    })
    expect(detailed).toMatchObject({ reason: "[redacted]" })
    expect(await decisionsFor({ policyTrace: { mode: "off" } })).toEqual([])
  })
})

describe("request context rules", () => {
  it("starts state empty, resolves params, and isolates concurrent requests", async () => {
    const seen: string[] = []
    const app = new Orvaxis()
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/x/:n",
          handler: async (ctx) => {
            expect(ctx.state).toEqual({})
            await new Promise((resolve) => setTimeout(resolve, ctx.params.n === "1" ? 20 : 1))
            seen.push(`${ctx.params.n}:${getContext()?.params.n}`)
            ctx.res.json({})
          },
        },
      ],
    })
    await Promise.all([testRequest(app, { path: "/x/1" }), testRequest(app, { path: "/x/2" })])
    expect(seen.sort()).toEqual(["1:1", "2:2"])
    const unmatched = await testRequest(app, { path: "/nothing" })
    expect(unmatched.ctx?.params).toEqual({})
    expect(unmatched.ctx?.error).toBeDefined()
  })

  it("caps ctx.logs and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const app = new Orvaxis({ logsMaxSize: 3 })
      app.group({
        prefix: "/",
        routes: [
          {
            method: "GET",
            path: "/x",
            handler: (ctx) => {
              for (let i = 0; i < 10; i++) ctx.logs.push(`entry ${i}`)
              ctx.res.json({ logs: [...ctx.logs] })
            },
          },
        ],
      })
      const result = await testRequest(app, { path: "/x" })
      expect(result.body).toEqual({ logs: ["entry 0", "entry 1", "entry 2"] })
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})

describe("plugin rules", () => {
  it("rejects duplicate names and runs plugin and app hooks in registration order", async () => {
    const order: string[] = []
    const app = new Orvaxis()
    app.on("onRequest", () => {
      order.push("app first")
    })
    app.register({
      name: "p",
      apply(runtime) {
        runtime.hooks.on("onRequest", () => {
          order.push("plugin")
        })
      },
    })
    app.on("onRequest", () => {
      order.push("app last")
    })
    expect(() => app.register({ name: "p", apply: () => {} })).toThrow(
      'Plugin "p" is already registered'
    )
    app.group({
      prefix: "/",
      routes: [{ method: "GET", path: "/x", handler: (ctx) => ctx.res.json({}) }],
    })
    await testRequest(app, { path: "/x" })
    expect(order).toEqual(["app first", "plugin", "app last"])
  })

  it("runs the custom plugin example: duration on success, error count on failure", async () => {
    const seen: Array<[string, number]> = []
    const app = createPluggedApp((name, value) => seen.push([name, value]))
    await testRequest(app, { path: "/api/ok" })
    await testRequest(app, { path: "/api/fail" })
    expect(seen.map(([name]) => name)).toEqual(["request.duration_ms", "request.error.get"])
  })

  it("answers CORS preflights as described", async () => {
    const app = new Orvaxis()
    app.register(corsPlugin({ origin: "https://app.example.com", credentials: true, maxAge: 600 }))
    app.group({
      prefix: "/api",
      routes: [{ method: "GET", path: "/x", handler: (ctx) => ctx.res.json({}) }],
    })
    const preflight = await testRequest(app, {
      path: "/api/x",
      method: "OPTIONS",
      headers: { origin: "https://app.example.com", "access-control-request-method": "GET" },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com")
    expect(preflight.headers.Vary).toBe("Origin")
    const unknown = await testRequest(app, {
      path: "/nothing",
      method: "OPTIONS",
      headers: { origin: "https://app.example.com" },
    })
    expect(unknown.status).toBe(404)
  })
})
