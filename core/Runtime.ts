import type { Middleware, OrvaxisContext, OrvaxisRequest, OrvaxisResponse, Policy } from "../types"

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"])

function mergeSafe(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    if (!UNSAFE_KEYS.has(key)) target[key] = source[key]
  }
}
import { createContext } from "./Context"
import { runWithContext } from "./contextStore"
import { validateRequest } from "./validation"
import { Debugger } from "./Debugger"
import { HookSystem } from "./Hook"
import { Pipeline } from "./Pipeline"
import { PolicyEngine } from "./PolicyEngine"
import { Router } from "./Router"
import { Tracer } from "./Tracer"
import { type Plugin, PluginManager } from "../plugins/PluginManager"

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export class Runtime {
  readonly debugger = new Debugger()
  readonly hooks = new HookSystem()
  readonly pipeline = new Pipeline()
  readonly plugins = new PluginManager()
  readonly policies = new PolicyEngine()
  readonly router = new Router()

  addPlugin(plugin: Plugin) {
    this.plugins.register(plugin)
    plugin.apply(this)
  }

  async execute(req: OrvaxisRequest, res: OrvaxisResponse): Promise<OrvaxisContext> {
    validateRequest(req)
    const ctx = createContext(req, res)
    const tracer = new Tracer(req.id ?? generateId())
    ctx.meta.tracer = tracer

    return runWithContext(ctx, async () => {
      this.debugger.log(ctx, "REQUEST_START")

      try {
        const match = this.router.match(req)
        if (!match) {
          throw Object.assign(new Error("Not Found"), { status: 404 })
        }

        ctx.meta.route = match

        this.debugger.log(ctx, "POLICY_START")
        await this.policies.evaluate(ctx)
        await this.evaluatePolicies(match.group.policies ?? [], ctx)
        await this.evaluatePolicies(match.route.policies ?? [], ctx)
        this.debugger.log(ctx, "POLICY_END")

        await this.hooks.trigger("onRequest", ctx)
        this.debugger.log(ctx, "HOOK:onRequest")

        await this.hooks.trigger("beforePipeline", ctx)
        await this.pipeline.execute(ctx)
        this.debugger.log(ctx, "PIPELINE_DONE")

        await this.runMiddlewareChain(match.group.middleware ?? [], ctx)
        this.debugger.log(ctx, "GROUP_MIDDLEWARE_DONE")

        await this.runMiddlewareChain(match.route.middleware ?? [], ctx)
        this.debugger.log(ctx, "ROUTE_MIDDLEWARE_DONE")

        await match.route.handler(ctx)
        this.debugger.log(ctx, "HANDLER_EXECUTED")

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
        throw Object.assign(new Error(result.reason ?? `Blocked by ${policy.name}`), {
          status: result.status ?? 403,
        })
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
