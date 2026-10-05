import { type Plugin, PluginManager } from "../plugins/PluginManager.js"
import type {
  Middleware,
  OrvaxisContext,
  OrvaxisOptions,
  OrvaxisRequest,
  OrvaxisResponse,
  Policy,
  PolicyPhase,
  PolicyTraceOptions,
} from "../types/index.js"
import { createContext } from "./Context.js"
import { captureContext, runWithContext } from "./contextStore.js"
import { Debugger } from "./Debugger.js"
import { isTypedRoute } from "./defineRoute.js"
import { HookSystem } from "./Hook.js"
import { HttpError } from "./HttpError.js"
import { Pipeline } from "./Pipeline.js"
import {
  evaluatePolicies as evaluatePolicySet,
  PolicyEngine,
  type PolicyLayer,
} from "./PolicyEngine.js"
import { Router } from "./Router.js"
import { Tracer } from "./Tracer.js"
import { validateRequest } from "./validation.js"

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
  private readonly policyTrace: PolicyTraceOptions

  constructor(options: OrvaxisOptions = {}) {
    this.hooks = new HookSystem(options.logger)
    this.logsMaxSize = options.logsMaxSize
    const traceOptions = options.policyTrace
    const requestedLimit = traceOptions?.maxEvents ?? 100
    const maxEvents = Number.isFinite(requestedLimit)
      ? Math.min(1000, Math.max(1, Math.floor(requestedLimit)))
      : 100
    if (traceOptions?.mode === "detailed") {
      this.policyTrace = { ...traceOptions, maxEvents }
    } else {
      this.policyTrace = { mode: traceOptions?.mode ?? "summary", maxEvents }
    }
  }

  addPlugin(plugin: Plugin) {
    this.plugins.register(plugin)
    plugin.apply(this)
  }

  async execute(req: OrvaxisRequest, res: OrvaxisResponse): Promise<OrvaxisContext> {
    const ctx = createContext(req, res, this.logsMaxSize)
    captureContext(ctx)
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

        if (
          isTypedRoute(match.route) &&
          !this.plugins.list().some((plugin) => plugin.name === "schema-validation")
        ) {
          throw new HttpError(
            500,
            "Route defined with defineRoute() requires schemaValidationPlugin to validate its typed request fields"
          )
        }

        if (req.method.toUpperCase() === "HEAD" && match.route.method === "GET") {
          ctx.res = wrapForHead(res)
        }

        this.debugger.log(ctx, "POLICY_START")
        await this.policies.evaluate(ctx, "preValidation", {
          layer: "global",
          trace: this.policyTrace,
        })
        await this.evaluatePolicies(match.group.policies ?? [], ctx, "group")
        await this.evaluatePolicies(match.route.policies ?? [], ctx, "route")
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

        await this.hooks.trigger("onValidation", ctx)
        this.debugger.log(ctx, "HOOK:onValidation")
        if (ctx.res.sent) return await this.finishRequest(ctx, tracer)

        await this.policies.evaluate(ctx, "postValidation", {
          layer: "global",
          trace: this.policyTrace,
          beforeEvaluate: (policy) => this.assertPolicyRequirements(policy, ctx),
        })
        await this.evaluatePolicies(match.group.policies ?? [], ctx, "group", "postValidation")
        await this.evaluatePolicies(match.route.policies ?? [], ctx, "route", "postValidation")

        await this.hooks.trigger("beforeHandler", ctx)
        this.debugger.log(ctx, "HOOK:beforeHandler")
        if (ctx.res.sent) return await this.finishRequest(ctx, tracer)
        tracer.markHandlerExecuted()
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

  async authorize(req: OrvaxisRequest, res: OrvaxisResponse): Promise<OrvaxisContext> {
    const ctx = createContext(req, res, this.logsMaxSize)
    captureContext(ctx)
    const tracer = new Tracer(req.id ?? generateId())
    ctx.meta.tracer = tracer

    return runWithContext(ctx, async () => {
      try {
        validateRequest(req)
        const match = this.router.match(req)
        if (!match) {
          throw new HttpError(404, "No matching Orvaxis route for the Express policy guard")
        }
        ctx.meta.route = match

        if (isTypedRoute(match.route)) {
          throw new HttpError(
            500,
            "Routes defined with defineRoute() require full Orvaxis execution; policy-only authorization does not parse their schemas"
          )
        }

        const hasPostValidationPolicies = [
          ...this.policies.list(),
          ...(match.group.policies ?? []),
          ...(match.route.policies ?? []),
        ].some((policy) => policy.phase === "postValidation")
        if (hasPostValidationPolicies) {
          throw new HttpError(
            500,
            "The Express policy guard supports pre-validation policies only; post-validation policies require Orvaxis schema validation"
          )
        }

        await this.policies.evaluate(ctx, "preValidation", {
          layer: "global",
          trace: this.policyTrace,
        })
        await this.evaluatePolicies(match.group.policies ?? [], ctx, "group")
        await this.evaluatePolicies(match.route.policies ?? [], ctx, "route")
        ctx.meta.trace = tracer.end({
          outcome: "success",
          responseSentAtRuntimeEnd: ctx.res.sent,
          responseCompletedAtRuntimeEnd: ctx.res.completed,
        })
        return ctx
      } catch (err) {
        ctx.error = err as Error
        ctx.meta.trace = tracer.end({
          outcome: "error",
          responseSentAtRuntimeEnd: ctx.res.sent,
          responseCompletedAtRuntimeEnd: ctx.res.completed,
        })
        try {
          await this.hooks.trigger("onError", ctx, err as Error)
        } catch {
          // Preserve the original policy or configuration error.
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

  private async evaluatePolicies(
    policies: Policy[],
    ctx: OrvaxisContext,
    layer: PolicyLayer,
    phase: PolicyPhase = "preValidation"
  ): Promise<void> {
    await evaluatePolicySet(policies, ctx, phase, {
      layer,
      trace: this.policyTrace,
      ...(phase === "postValidation"
        ? { beforeEvaluate: (policy: Policy) => this.assertPolicyRequirements(policy, ctx) }
        : {}),
    })
  }

  private assertPolicyRequirements(policy: Policy, ctx: OrvaxisContext): void {
    const required = policy.requires
    if (!required?.length) {
      throw new HttpError(
        500,
        `Post-validation policy "${policy.name}" must declare required fields`
      )
    }
    if (!this.plugins.list().some((plugin) => plugin.name === "schema-validation")) {
      throw new HttpError(
        500,
        `Post-validation policy "${policy.name}" requires schemaValidationPlugin`
      )
    }
    const schema = ctx.meta.route?.route.schema
    const missing = required.filter((field) => schema?.[field] === undefined)
    if (missing.length > 0) {
      throw new HttpError(
        500,
        `Post-validation policy "${policy.name}" requires route schema for: ${missing.join(", ")}`
      )
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
