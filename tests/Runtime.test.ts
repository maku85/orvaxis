import { describe, expect, it, vi } from "vitest"
import { Runtime } from "../core/Runtime"
import { createMockResponse } from "../core/mockResponse"
import type { Group, Middleware, OrvaxisContext, OrvaxisRequest, Policy } from "../types"

function makeReq(path: string, method = "GET"): OrvaxisRequest {
  return { path, method, url: path, headers: {} }
}

function makeRes() {
  return createMockResponse()
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

    it("uses custom status from policy result when provided", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))
      runtime.policies.register({
        name: "auth",
        evaluate: async () => ({ allow: false, reason: "Unauthorized", status: 401 }),
      })

      const err = await runtime.execute(makeReq("/api/resource"), makeRes()).catch((e) => e)
      expect(err.message).toBe("Unauthorized")
      expect(err.status).toBe(401)
    })

    it("defaults to 403 when policy result has no status", async () => {
      const runtime = new Runtime()
      runtime.router.group(makeGroup("/api"))
      runtime.policies.register({
        name: "blocker",
        evaluate: async () => ({ allow: false, reason: "Forbidden" }),
      })

      const err = await runtime.execute(makeReq("/api/resource"), makeRes()).catch((e) => e)
      expect(err.status).toBe(403)
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

    it("merges modify data from group policy into ctx.meta", async () => {
      const runtime = new Runtime()
      runtime.router.group(
        makeGroup("/api", {
          groupPolicies: [
            { name: "gp", evaluate: async () => ({ allow: true, modify: { fromGroup: true } }) },
          ],
        })
      )

      const ctx = await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(ctx.meta.fromGroup).toBe(true)
    })

    it("merges modify data from route policy into ctx.meta", async () => {
      const runtime = new Runtime()
      runtime.router.group(
        makeGroup("/api", {
          policies: [
            { name: "rp", evaluate: async () => ({ allow: true, modify: { fromRoute: true } }) },
          ],
        })
      )

      const ctx = await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(ctx.meta.fromRoute).toBe(true)
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

  describe("policy edge cases", () => {
    it("uses fallback 'Blocked by <name>' when group policy denies without reason", async () => {
      const runtime = new Runtime()
      runtime.router.group(
        makeGroup("/api", {
          groupPolicies: [{ name: "silent-blocker", evaluate: async () => ({ allow: false }) }],
        })
      )

      const err = await runtime.execute(makeReq("/api/resource"), makeRes()).catch((e) => e)
      expect(err.message).toBe("Blocked by silent-blocker")
      expect(err.status).toBe(403)
    })

    it("propagates custom status from a group policy deny", async () => {
      const runtime = new Runtime()
      runtime.router.group(
        makeGroup("/api", {
          groupPolicies: [
            {
              name: "auth",
              evaluate: async () => ({ allow: false, reason: "Unauthorized", status: 401 }),
            },
          ],
        })
      )

      const err = await runtime.execute(makeReq("/api/resource"), makeRes()).catch((e) => e)
      expect(err.message).toBe("Unauthorized")
      expect(err.status).toBe(401)
    })

    it("respects priority ordering among group policies", async () => {
      const order: string[] = []
      const runtime = new Runtime()
      runtime.router.group(
        makeGroup("/api", {
          groupPolicies: [
            // Two unprioritised + one prioritised forces the sort comparator to be called with
            // (a=defined, b=undefined) AND (a=undefined, b=defined), covering both ?? branches.
            {
              name: "np-1",
              evaluate: async () => {
                order.push("np-1")
                return { allow: true }
              },
            },
            {
              name: "high",
              priority: 10,
              evaluate: async () => {
                order.push("high")
                return { allow: true }
              },
            },
            {
              name: "np-2",
              evaluate: async () => {
                order.push("np-2")
                return { allow: true }
              },
            },
          ],
        })
      )

      await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(order[0]).toBe("high")
    })

    it("does not copy unsafe prototype-pollution keys from group policy modify", async () => {
      const runtime = new Runtime()
      runtime.router.group(
        makeGroup("/api", {
          groupPolicies: [
            {
              name: "polluter",
              evaluate: async () => ({
                allow: true,
                // "constructor" is an own enumerable key — blocked by UNSAFE_KEYS in mergeSafe
                modify: { constructor: "evil", safe: "yes" },
              }),
            },
          ],
        })
      )

      const ctx = await runtime.execute(makeReq("/api/resource"), makeRes())
      expect((ctx.meta as Record<string, unknown>).safe).toBe("yes")
      expect(Object.prototype.hasOwnProperty.call(ctx.meta, "constructor")).toBe(false)
    })
  })

  describe("middleware chain guard", () => {
    it("ignores redundant next() calls (double-next guard)", async () => {
      const handlerCallCount = { n: 0 }
      const runtime = new Runtime()

      runtime.router.group({
        prefix: "/api",
        routes: [
          {
            method: "GET",
            path: "/resource",
            middleware: [
              async (_ctx, next) => {
                await next()
                await next()
              },
            ],
            handler: async () => {
              handlerCallCount.n++
            },
          },
        ],
      })

      await runtime.execute(makeReq("/api/resource"), makeRes())
      expect(handlerCallCount.n).toBe(1)
    })
  })
})
