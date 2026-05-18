import { type Span, SpanKind, SpanStatusCode, type Tracer } from "@opentelemetry/api"
import { describe, expect, it, vi } from "vitest"
import { HttpError } from "../core/HttpError"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import { traceMiddleware } from "../middleware/traceMiddleware"
import { otelPlugin } from "../plugins/otelPlugin"

function makeMockSpan() {
  return {
    setAttribute: vi.fn().mockReturnThis(),
    setAttributes: vi.fn().mockReturnThis(),
    addEvent: vi.fn().mockReturnThis(),
    setStatus: vi.fn().mockReturnThis(),
    recordException: vi.fn().mockReturnThis(),
    updateName: vi.fn().mockReturnThis(),
    addLink: vi.fn().mockReturnThis(),
    addLinks: vi.fn().mockReturnThis(),
    end: vi.fn(),
    isRecording: vi.fn().mockReturnValue(true),
    spanContext: vi
      .fn()
      .mockReturnValue({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 1 }),
  } as unknown as Span & Record<string, ReturnType<typeof vi.fn>>
}

function makeMockTracer() {
  const created: (Span & Record<string, ReturnType<typeof vi.fn>>)[] = []
  const startSpan = vi.fn().mockImplementation(() => {
    const span = makeMockSpan()
    created.push(span)
    return span
  })
  const tracer = { startSpan, startActiveSpan: vi.fn() } as unknown as Tracer
  return { tracer, created, startSpan }
}

function makeApp() {
  const app = new Orvaxis()
  app.group({
    prefix: "/api",
    routes: [
      { method: "GET", path: "/hello", handler: async (ctx) => ctx.res.json({ ok: true }) },
      {
        method: "GET",
        path: "/users/:id",
        handler: async (ctx) => ctx.res.json({ id: ctx.params.id }),
      },
      {
        method: "GET",
        path: "/fail",
        handler: async () => {
          throw new HttpError(500, "Boom")
        },
      },
    ],
  })
  return app
}

describe("otelPlugin — happy path", () => {
  it("starts a SERVER span on onRequest with HTTP attributes", async () => {
    const { tracer, startSpan } = makeMockTracer()
    const app = makeApp()
    app.register(otelPlugin({ tracer }))

    await testRequest(app, { path: "/api/hello", id: "req-1" })

    expect(startSpan).toHaveBeenCalledOnce()
    const [name, opts] = startSpan.mock.calls[0]
    expect(name).toBe("GET /api/hello")
    expect(opts.kind).toBe(SpanKind.SERVER)
    expect(opts.attributes["http.request.method"]).toBe("GET")
    expect(opts.attributes["url.path"]).toBe("/api/hello")
    expect(opts.attributes["orvaxis.request_id"]).toBe("req-1")
  })

  it("uses the route template as span name, not the filled-in path", async () => {
    const { tracer, startSpan, created } = makeMockTracer()
    const app = makeApp()
    app.register(otelPlugin({ tracer }))

    await testRequest(app, { path: "/api/users/42" })

    // span is created before routing with the raw path, then renamed in beforeHandler
    expect(startSpan.mock.calls[0][0]).toBe("GET /api/users/42")
    expect(created[0].updateName).toHaveBeenCalledWith("GET /api/users/:id")
  })

  it("sets status code attribute and OK status on afterPipeline", async () => {
    const { tracer, created } = makeMockTracer()
    const app = makeApp()
    app.register(otelPlugin({ tracer }))

    await testRequest(app, { path: "/api/hello" })

    expect(created[0].setAttribute).toHaveBeenCalledWith("http.response.status_code", 200)
    expect(created[0].setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK })
    expect(created[0].end).toHaveBeenCalledOnce()
  })

  it("adds trace events from ctx.meta.trace as OTel span events", async () => {
    const { tracer, created } = makeMockTracer()
    const app = new Orvaxis()
    app.register(otelPlugin({ tracer }))
    app.group({
      prefix: "/",
      routes: [
        {
          method: "GET",
          path: "/traced",
          middleware: [traceMiddleware()],
          handler: async (ctx) => ctx.res.json({ ok: true }),
        },
      ],
    })

    await testRequest(app, { path: "/traced" })

    // traceMiddleware emits at least a "middleware:start" and "middleware:end" event
    expect(created[0].addEvent).toHaveBeenCalled()
  })
})

describe("otelPlugin — error path", () => {
  it("records exception and sets ERROR status on onError", async () => {
    const { tracer, created } = makeMockTracer()
    const app = makeApp()
    app.register(otelPlugin({ tracer }))

    const result = await testRequest(app, { path: "/api/fail" })

    expect(result.error).toBeTruthy()
    expect(created[0].recordException).toHaveBeenCalledWith(expect.any(HttpError))
    expect(created[0].setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "Boom",
    })
    expect(created[0].end).toHaveBeenCalledOnce()
  })

  it("creates a span for 404 requests and records the error", async () => {
    const { tracer, startSpan, created } = makeMockTracer()
    const app = makeApp()
    app.register(otelPlugin({ tracer }))

    await testRequest(app, { path: "/api/not-found" })

    expect(startSpan).toHaveBeenCalledOnce()
    expect(created[0].recordException).toHaveBeenCalledWith(expect.any(HttpError))
    expect(created[0].setAttribute).toHaveBeenCalledWith("http.response.status_code", 404)
    expect(created[0].setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ code: SpanStatusCode.ERROR })
    )
    expect(created[0].end).toHaveBeenCalledOnce()
  })
})
