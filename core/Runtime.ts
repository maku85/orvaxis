import { type Plugin, PluginManager } from "../plugins/PluginManager"
import type {
  Middleware,
  OrvaxisContext,
  OrvaxisOptions,
  OrvaxisRequest,
  OrvaxisResponse,
  Policy,
} from "../types"
import { createContext } from "./Context"
import { runWithContext } from "./contextStore"
import { Debugger } from "./Debugger"
import { HookSystem } from "./Hook"
import { HttpError } from "./HttpError"
import { Pipeline } from "./Pipeline"
import { matchesPolicyScope, PolicyEngine, sortPolicies } from "./PolicyEngine"
import { Router } from "./Router"
import { Tracer } from "./Tracer"
import { mergeSafe } from "./utils"
import { validateRequest } from "./validation"

function generateId(): string {
  return crypto.randomUUID()
}

function wrapForHead(res: OrvaxisResponse): OrvaxisResponse {
  const wrapper: OrvaxisResponse = {
    statusCode: res.statusCode,
    sent: false,
    get completed() {
      return res.completed
    },
    status(code) {
      wrapper.statusCode = code
      res.status(code)
      return wrapper
    },
    setHeader(name, value) {
      res.setHeader(name, value)
      return wrapper
    },
    json(body) {
      const serialized = JSON.stringify(body)
      res.setHeader("Content-Type", "application/json")
      res.setHeader("Content-Length", String(Buffer.byteLength(serialized, "utf-8")))
      wrapper.sent = true
      res.end()
    },
    send(body) {
      const len =
        body == null
          ? 0
          : Buffer.isBuffer(body)
            ? body.length
            : Buffer.byteLength(String(body), "utf-8")
      res.setHeader("Content-Length", String(len))
      wrapper.sent = true
      res.end()
    },
    write(_chunk) {
      wrapper.sent = true
    },
    end(_chunk?) {
      wrapper.sent = true
      res.end()
    },
    pipe(_stream) {
      wrapper.sent = true
      res.end()
    },
  }
  return wrapper
}

export class Runtime {
  readonly debugger = new Debugger()
  readonly hooks: HookSystem
  readonly pipeline = new Pipeline()
  readonly plugins = new PluginManager()
  readonly policies = new PolicyEngine()
  readonly router = new Router()

  private readonly logsMaxSize: number | undefined

  constructor(options: OrvaxisOptions = {}) {
    this.hooks = new HookSystem(options.logger)
    this.logsMaxSize = options.logsMaxSize
  }

  addPlugin(plugin: Plugin) {
    this.plugins.register(plugin)
    plugin.apply(this)
  }

  async execute(req: OrvaxisRequest, res: OrvaxisResponse): Promise<OrvaxisContext> {
    const ctx = createContext(req, res, this.logsMaxSize)
    const tracer = new Tracer(req.id ?? generateId())
    ctx.meta.tracer = tracer

    return runWithContext(ctx, async () => {
      this.debugger.log(ctx, "REQUEST_START")

      try {
        validateRequest(req)

        // Pre-populate allowedMethods for OPTIONS so plugins (e.g. corsPlugin) can read
        // ctx.meta.allowedMethods inside their onRequest handlers before routing completes.
        if (req.method.toUpperCase() === "OPTIONS") {
          const preAllowed = this.router.allowedMethods(req.path)
          if (preAllowed.length > 0) ctx.meta.allowedMethods = preAllowed
        }

        await this.hooks.trigger("onRequest", ctx)
        this.debugger.log(ctx, "HOOK:onRequest")
        if (ctx.res.sent) return await this.finishRequest(ctx, tracer)

        const match = this.router.match(req)
        if (!match) {
          const precomputed = ctx.meta.allowedMethods as string[] | undefined
          const allowed = precomputed ?? this.router.allowedMethods(req.path)
          if (allowed.length > 0) {
            ctx.res.setHeader("Allow", allowed.join(", "))
            ctx.meta.allowedMethods = allowed
            if (req.method.toUpperCase() === "OPTIONS") {
              if (!ctx.res.sent) ctx.res.status(204).end()
              return await this.finishRequest(ctx, tracer)
            }
            await this.hooks.trigger("onMethodNotAllowed", ctx)
            this.debugger.log(ctx, "HOOK:onMethodNotAllowed")
            if (ctx.res.sent) {
              return await this.finishRequest(ctx, tracer)
            }
            throw new HttpError(405, "Method Not Allowed")
          }
          await this.hooks.trigger("onNotFound", ctx)
          this.debugger.log(ctx, "HOOK:onNotFound")
          if (ctx.res.sent) {
            return await this.finishRequest(ctx, tracer)
          }
          throw new HttpError(
            404,
            process.env.NODE_ENV !== "production" ? `Not Found: ${req.path}` : "Not Found"
          )
        }

        ctx.meta.route = match

        if (req.method.toUpperCase() === "HEAD" && match.route.method === "GET") {
          ctx.res = wrapForHead(res)
        }

        this.debugger.log(ctx, "POLICY_START")
        await this.policies.evaluate(ctx)
        await this.evaluatePolicies(match.group.policies ?? [], ctx)
        await this.evaluatePolicies(match.route.policies ?? [], ctx)
        this.debugger.log(ctx, "POLICY_END")

        await this.hooks.trigger("beforePipeline", ctx)
        if (ctx.res.sent) return await this.finishRequest(ctx, tracer)
        const pipelineContinues = await this.pipeline.execute(ctx)
        this.debugger.log(ctx, "PIPELINE_DONE")
        if (!pipelineContinues) return await this.finishRequest(ctx, tracer)

        const groupContinues = await this.runMiddlewareChain(match.group.middleware ?? [], ctx)
        this.debugger.log(ctx, "GROUP_MIDDLEWARE_DONE")
        if (!groupContinues) return await this.finishRequest(ctx, tracer)

        const routeContinues = await this.runMiddlewareChain(match.route.middleware ?? [], ctx)
        this.debugger.log(ctx, "ROUTE_MIDDLEWARE_DONE")
        if (!routeContinues) return await this.finishRequest(ctx, tracer)

        await this.hooks.trigger("beforeHandler", ctx)
        this.debugger.log(ctx, "HOOK:beforeHandler")
        if (ctx.res.sent) return await this.finishRequest(ctx, tracer)
        await match.route.handler(ctx)
        this.debugger.log(ctx, "HANDLER_EXECUTED")
        await this.hooks.trigger("afterHandler", ctx)
        this.debugger.log(ctx, "HOOK:afterHandler")

        return await this.finishRequest(ctx, tracer)
      } catch (err) {
        ctx.error = err as Error
        if (!ctx.meta.trace?.endTime) {
          tracer.event("RUNTIME_ERROR", {
            name: err instanceof Error ? err.name : "NonErrorThrown",
          })
        }
        ctx.meta.trace = tracer.end({
          outcome: "error",
          responseSentAtRuntimeEnd: ctx.res.sent,
          responseCompletedAtRuntimeEnd: ctx.res.completed,
        })
        try {
          this.debugger.log(ctx, "ERROR", { error: String(err) })
        } catch {
          // Diagnostics must never replace the original request error.
        }
        try {
          await this.hooks.trigger("onError", ctx, err as Error)
        } catch {
          // Error hooks are cleanup/observation; preserve the original failure.
        }
        throw err
      }
    })
  }

  private async finishRequest(ctx: OrvaxisContext, tracer: Tracer): Promise<OrvaxisContext> {
    ctx.meta.trace = tracer.end({
      outcome: "success",
      responseSentAtRuntimeEnd: ctx.res.sent,
      responseCompletedAtRuntimeEnd: ctx.res.completed,
    })
    await this.hooks.trigger("afterPipeline", ctx)
    this.debugger.log(ctx, "REQUEST_END")
    return ctx
  }

  private async evaluatePolicies(policies: Policy[], ctx: OrvaxisContext): Promise<void> {
    const sorted = sortPolicies(policies)
    for (const policy of sorted) {
      if (!matchesPolicyScope(policy.scope, ctx)) continue
      const result = await policy.evaluate(ctx)
      if (!result.allow) {
        throw new HttpError(result.status ?? 403, result.reason ?? `Blocked by ${policy.name}`)
      }
      if (result.modify) {
        mergeSafe(ctx.meta, result.modify)
      }
    }
  }

  private async runMiddlewareChain(
    middlewares: Middleware[],
    ctx: OrvaxisContext
  ): Promise<boolean> {
    let index = -1
    let stopped = false

    const runner = async (i: number): Promise<void> => {
      if (i <= index) return
      index = i
      if (ctx.res.sent) return
      const fn = middlewares[i]
      if (!fn) return
      let calledNext = false
      await fn(ctx, async () => {
        if (calledNext) return
        calledNext = true
        await runner(i + 1)
      })
      if (!calledNext || ctx.res.sent) stopped = true
    }

    await runner(0)
    return !stopped && !ctx.res.sent
  }
}
