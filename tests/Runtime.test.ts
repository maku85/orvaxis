import { describe, expect, it, vi } from "vitest"
import { Runtime } from "../core/Runtime"
import type { Group, Middleware, OrvaxisContext, OrvaxisRequest, Policy } from "../types"

function makeReq(path: string, method = "GET"): OrvaxisRequest {
  return { path, method, url: path, headers: {} }
}

function makeRes() {
  return {}
}

function makeGroup(
  prefix: string,
  opts: {
    path?: string
    method?: string
    handler?: (ctx: OrvaxisContext) => void
    middleware?: Middleware[]
    policies?: Policy[]
    groupMiddleware?: Middleware[]
    groupPolicies?: Policy[]
  } = {}
): Group {
  return {
    prefix,
    middleware: opts.groupMiddleware,
    policies: opts.groupPolicies,
    routes: [
      {
        method: opts.method ?? "GET",
        path: opts.path ?? "/resource",
        handler:
          opts.handler ??
          (async (ctx) => {
            ctx.state.handled = true
          }),
        middleware: opts.middleware,
        policies: opts.policies,
      },
    ],
  }
}

describe("Runtime", () => {
  describe("route matching", () => {
    it("throws 404 when no route matches", async () => {
      const runtime = new Runtime()
      const err = await runtime.execute(makeReq("/unknown"), makeRes()).catch((e) => e)
      expect(err.message).toBe("Not Found")
      expect(err.status).toBe(404)
    })

    it("executes the matching route handler", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))

      const ctx = await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(ctx.state.handled).toBe(true)
    })

    it("stores the route match in ctx.meta.route", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))

      const ctx = await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(ctx.meta.route).toBeDefined()
      expect(ctx.meta.route?.route.path).toBe("/resource")
    })
  })

  describe("policies", () => {
    it("blocks when a global policy denies", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))
      runtime.policies.register({
        name: "blocker",
        evaluate: async () => ({ allow: false, reason: "denied" }),
      })

      const err = await runtime.execute(makeReq("/api/resource"), makeRes()).catch((e) => e)
      expect(err.message).toBe("denied")
    })

    it("blocks when a group policy denies", async () => {
      const runtime = new Runtime()
      runtime.router.group(
        makeGroup("/api", {
          groupPolicies: [
            { name: "gp", evaluate: async () => ({ allow: false, reason: "group-denied" }) },
          ],
        })
      )

      const err = await runtime.execute(makeReq("/api/resource"), makeRes()).catch((e) => e)
      expect(err.message).toBe("group-denied")
      expect(err.status).toBe(403)
    })

    it("blocks when a route policy denies", async () => {
      const runtime = new Runtime()
      runtime.router.group(
        makeGroup("/api", {
          policies: [
            { name: "rp", evaluate: async () => ({ allow: false, reason: "route-denied" }) },
          ],
        })
      )

      const err = await runtime.execute(makeReq("/api/resource"), makeRes()).catch((e) => e)
      expect(err.message).toBe("route-denied")
    })

    it("merges modify data from global policy into ctx.meta", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))
      runtime.policies.register({
        name: "enricher",
        evaluate: async () => ({ allow: true, modify: { userId: 99 } }),
      })

      const ctx = await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(ctx.meta.userId).toBe(99)
    })
  })

  describe("hooks", () => {
    it("triggers onRequest hook", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))
      const fn = vi.fn()
      runtime.hooks.on("onRequest", fn)

      await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(fn).toHaveBeenCalledOnce()
    })

    it("triggers beforePipeline hook", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))
      const fn = vi.fn()
      runtime.hooks.on("beforePipeline", fn)

      await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(fn).toHaveBeenCalledOnce()
    })

    it("triggers afterPipeline hook after handler", async () => {
      const runtime = new Runtime()
      const order: string[] = []

      runtime.router.group(
        makeGroup("/api", {
          handler: async () => {
            order.push("handler")
          },
        })
      )
      runtime.hooks.on("afterPipeline", async () => {
        order.push("afterPipeline")
      })

      await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(order).toEqual(["handler", "afterPipeline"])
    })

    it("triggers onError hook and re-throws on error", async () => {
      const runtime = new Runtime()
      const onError = vi.fn()
      runtime.hooks.on("onError", onError)

      const err = await runtime.execute(makeReq("/nope"), makeRes()).catch((e) => e)
      expect(onError).toHaveBeenCalledOnce()
      expect(err.message).toBe("Not Found")
    })

    it("sets ctx.error when an error occurs", async () => {
      const runtime = new Runtime()
      let capturedCtx: OrvaxisContext | undefined

      runtime.hooks.on("onError", (ctx) => {
        capturedCtx = ctx
      })

      await runtime.execute(makeReq("/nope"), makeRes()).catch(() => {})
      expect(capturedCtx?.error).toBeDefined()
      expect(capturedCtx?.error?.message).toBe("Not Found")
    })
  })

  describe("pipeline and middleware", () => {
    it("runs global pipeline middleware", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))
      const fn = vi.fn<Middleware>(async (_ctx, next) => next())
      runtime.pipeline.use(fn)

      await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(fn).toHaveBeenCalledOnce()
    })

    it("runs group middleware before route middleware", async () => {
      const order: string[] = []
      const runtime = new Runtime()

      runtime.router.group(
        makeGroup("/api", {
          groupMiddleware: [
            async (_ctx, next) => {
              order.push("group")
              await next()
            },
          ],
          middleware: [
            async (_ctx, next) => {
              order.push("route")
              await next()
            },
          ],
        })
      )

      await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(order).toEqual(["group", "route"])
    })

    it("runs global pipeline before group middleware", async () => {
      const order: string[] = []
      const runtime = new Runtime()

      runtime.pipeline.use(async (_ctx, next) => {
        order.push("global")
        await next()
      })
      runtime.router.group(
        makeGroup("/api", {
          groupMiddleware: [
            async (_ctx, next) => {
              order.push("group")
              await next()
            },
          ],
        })
      )

      await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(order).toEqual(["global", "group"])
    })
  })

  describe("param routing", () => {
    it("exposes matched params on ctx.meta.route.params", async () => {
      const runtime = new Runtime()
      runtime.router.group({
        prefix: "/users",
        routes: [
          {
            method: "GET",
            path: "/:id",
            handler: async (ctx) => {
              ctx.state.handled = true
            },
          },
        ],
      })

      const ctx = await runtime.execute(makeReq("/users/42"), makeRes())
      expect(ctx.meta.route?.params).toEqual({ id: "42" })
    })
  })

  describe("tracer", () => {
    it("attaches a completed trace to ctx.meta.trace", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))

      const ctx = await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(ctx.meta.trace).toBeDefined()
      expect(ctx.meta.trace?.endTime).toBeDefined()
    })

    it("uses req.id as requestId when available", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))

      const req = { ...makeReq("/api/resource"), id: "my-custom-id" }
      const ctx = await runtime.execute(req, makeRes())
      expect(ctx.meta.trace?.requestId).toBe("my-custom-id")
    })
  })

  describe("debugger", () => {
    it("populates debug timeline when debugger is enabled", async () => {
      const runtime = new Runtime()
      runtime.debugger.enable()
      runtime.router.group(makeGroup("/api"))

      const ctx = await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(ctx.meta.debug?.timeline.length).toBeGreaterThan(0)
    })

    it("does not populate debug timeline when debugger is disabled", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))

      const ctx = await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(ctx.meta.debug).toBeUndefined()
    })
  })
})
