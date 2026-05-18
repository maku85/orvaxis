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
import { PolicyEngine } from "./PolicyEngine"
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
    status(code) {
      wrapper.statusCode = code
      res.status(code)
      return wrapper
    },
    setHeader(name, value) {
      res.setHeader(name, value)
      return wrapper
    },
    json(_body) {
      wrapper.sent = true
      res.end()
    },
    send(_body) {
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

  constructor(options: OrvaxisOptions = {}) {
    this.hooks = new HookSystem(options.logger)
  }

  addPlugin(plugin: Plugin) {
    this.plugins.register(plugin)
    plugin.apply(this)
  }

  async execute(req: OrvaxisRequest, res: OrvaxisResponse): Promise<OrvaxisContext> {
    const ctx = createContext(req, res)
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

        const match = this.router.match(req)
        if (!match) {
          const precomputed = ctx.meta.allowedMethods as string[] | undefined
          const allowed = precomputed ?? this.router.allowedMethods(req.path)
          if (allowed.length > 0) {
            ctx.res.setHeader("Allow", allowed.join(", "))
            if (req.method.toUpperCase() === "OPTIONS") {
              ctx.meta.allowedMethods = allowed
              if (!ctx.res.sent) ctx.res.status(204).end()
              ctx.meta.trace = tracer.end()
              await this.hooks.trigger("afterPipeline", ctx)
              this.debugger.log(ctx, "REQUEST_END")
              return ctx
            }
            throw new HttpError(405, "Method Not Allowed")
          }
          throw new HttpError(404, "Not Found")
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
        await this.pipeline.execute(ctx)
        this.debugger.log(ctx, "PIPELINE_DONE")

        await this.runMiddlewareChain(match.group.middleware ?? [], ctx)
        this.debugger.log(ctx, "GROUP_MIDDLEWARE_DONE")

        await this.runMiddlewareChain(match.route.middleware ?? [], ctx)
        this.debugger.log(ctx, "ROUTE_MIDDLEWARE_DONE")

        await this.hooks.trigger("beforeHandler", ctx)
        this.debugger.log(ctx, "HOOK:beforeHandler")
        await match.route.handler(ctx)
        this.debugger.log(ctx, "HANDLER_EXECUTED")
        await this.hooks.trigger("afterHandler", ctx)
        this.debugger.log(ctx, "HOOK:afterHandler")

        ctx.meta.trace = tracer.end()
        await this.hooks.trigger("afterPipeline", ctx)
        this.debugger.log(ctx, "REQUEST_END")

        return ctx
      } catch (err) {
        ctx.error = err as Error
        this.debugger.log(ctx, "ERROR", { error: String(err) })
        await this.hooks.trigger("onError", ctx, err as Error)
        throw err
      }
    })
  }

  private async evaluatePolicies(policies: Policy[], ctx: OrvaxisContext): Promise<void> {
    const sorted = [...policies].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    for (const policy of sorted) {
      const result = await policy.evaluate(ctx)
      if (!result.allow) {
        throw new HttpError(result.status ?? 403, result.reason ?? `Blocked by ${policy.name}`)
      }
      if (result.modify) {
        mergeSafe(ctx.meta, result.modify)
      }
    }
  }

  private async runMiddlewareChain(middlewares: Middleware[], ctx: OrvaxisContext): Promise<void> {
    let index = -1

    const runner = async (i: number): Promise<void> => {
      if (i <= index) return
      index = i
      const fn = middlewares[i]
      if (!fn) return
      await fn(ctx, () => runner(i + 1))
    }

    await runner(0)
  }
}
