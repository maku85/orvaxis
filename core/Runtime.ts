import { type Plugin, PluginManager } from "../plugins/PluginManager.js"
import type {
  AroundFunction,
  AroundStage,
  Authenticator,
  Logger,
  Middleware,
  OrvaxisContext,
  OrvaxisOptions,
  OrvaxisRequest,
  OrvaxisResponse,
  PluginContext,
  Policy,
  PolicyPhase,
  PolicyTraceOptions,
  Route,
  RouteInfo,
  RouteMatch,
} from "../types/index.js"
import { createContext } from "./Context.js"
import { captureContext, runWithContext } from "./contextStore.js"
import { Debugger } from "./Debugger.js"
import { isTypedRoute } from "./defineRoute.js"
import { HookSystem } from "./Hook.js"
import { HttpError } from "./HttpError.js"
import { composeMiddleware, Pipeline } from "./Pipeline.js"
import {
  evaluatePolicies as evaluatePolicySet,
  initPolicyTrace,
  PolicyEngine,
  type PolicyLayer,
} from "./PolicyEngine.js"
import { Router } from "./Router.js"
import { isRequestAbandoned } from "./requestAbandoned.js"
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
    getHeader(name) {
      return res.getHeader?.(name)
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

  private authenticator: Authenticator | undefined
  private readonly wrappers: Record<AroundStage, AroundFunction[]> = { request: [], handler: [] }
  private closeHandlers: Array<() => Promise<void> | void> = []
  private readonly logger: Logger
  private readonly denyByDefault: boolean
  private coverage = new WeakMap<Route, boolean>()
  private coverageKey = ""
  private readonly logsMaxSize: number | undefined
  private readonly policyTrace: PolicyTraceOptions

  constructor(options: OrvaxisOptions = {}) {
    this.logger = options.logger ?? console
    this.denyByDefault = options.denyByDefault === true
    this.hooks = new HookSystem(this.logger)
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

  setAuthenticator(fn: Authenticator) {
    if (typeof fn !== "function") throw new TypeError("authenticate() requires a function")
    if (this.authenticator) throw new TypeError("An authenticator is already registered")
    this.authenticator = fn
  }

  private async runAuthenticator(ctx: OrvaxisContext, tracer: Tracer): Promise<void> {
    if (!this.authenticator) return
    this.debugger.log(ctx, "AUTHENTICATE_START")
    try {
      const identity = await this.authenticator(ctx)
      if (identity != null) ctx.identity = identity
      tracer.event("AUTHENTICATE", { outcome: identity != null ? "identified" : "anonymous" })
    } catch (err) {
      tracer.event("AUTHENTICATE", {
        outcome: "error",
        errorName: err instanceof Error ? err.name : "NonErrorThrown",
      })
      throw err
    }
    this.debugger.log(ctx, "AUTHENTICATE_END")
  }

  /** The restricted view of the runtime that a plugin receives. */
  createPluginContext(): PluginContext {
    return {
      hooks: { on: (name, fn) => this.hooks.on(name, fn) },
      addPolicy: (policy) => this.policies.register(policy),
      use: (fn) => this.pipeline.use(fn),
      around: (stage, fn) => {
        if (!(stage in this.wrappers)) throw new TypeError(`Unknown around stage "${stage}"`)
        this.wrappers[stage].push(fn)
      },
      onClose: (fn) => {
        this.closeHandlers.push(fn)
      },
    }
  }

  private async around(stage: AroundStage, ctx: OrvaxisContext, fn: () => Promise<void>) {
    const wrappers = this.wrappers[stage]
    const run = async (index: number): Promise<void> => {
      const wrapper = wrappers[index]
      if (!wrapper) return fn()
      let called = false
      await wrapper(ctx, () => {
        if (called) throw new Error(`An around("${stage}") wrapper called next() twice`)
        called = true
        return run(index + 1)
      })
      if (!called) throw new Error(`An around("${stage}") wrapper did not call next()`)
    }
    await run(0)
  }

  addPlugin(plugin: Plugin) {
    // Validate before applying so a plugin that fails its checks leaves nothing behind, and
    // register only afterwards so a plugin whose `apply` throws is not listed as installed.
    this.plugins.assertRegistrable(plugin)
    plugin.apply(this.createPluginContext())
    this.plugins.register(plugin)
  }

  /**
   * Run the plugins' `onClose` handlers, last registered first, each at most once. Every handler
   * runs even if an earlier one throws; failures are reported together afterwards.
   */
  async close(): Promise<void> {
    const handlers = this.closeHandlers.reverse()
    this.closeHandlers = []
    const errors: unknown[] = []
    for (const handler of handlers) {
      try {
        await handler()
      } catch (err) {
        errors.push(err)
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, "Multiple plugin close errors")
  }

  async execute(req: OrvaxisRequest, res: OrvaxisResponse): Promise<OrvaxisContext> {
    const { ctx, tracer } = this.createRequestScope(req, res)

    const run = async (): Promise<OrvaxisContext> => {
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
        if (this.isSettled(ctx)) return await this.finishRequest(ctx, tracer)

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
        this.assertRouteCovered(match)

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

        await this.runAuthenticator(ctx, tracer)
        if (this.isSettled(ctx)) return await this.finishRequest(ctx, tracer)

        this.debugger.log(ctx, "POLICY_START")
        await this.evaluatePolicyPhase(ctx, match, "preValidation")
        this.debugger.log(ctx, "POLICY_END")

        await this.hooks.trigger("beforePipeline", ctx)
        if (this.isSettled(ctx)) return await this.finishRequest(ctx, tracer)
        const pipelineContinues = await this.pipeline.execute(ctx)
        this.debugger.log(ctx, "PIPELINE_DONE")
        if (!pipelineContinues) return await this.finishRequest(ctx, tracer)

        const groupContinues = await composeMiddleware(match.group.middleware ?? [], ctx)
        this.debugger.log(ctx, "GROUP_MIDDLEWARE_DONE")
        if (!groupContinues) return await this.finishRequest(ctx, tracer)

        const routeContinues = await composeMiddleware(match.route.middleware ?? [], ctx)
        this.debugger.log(ctx, "ROUTE_MIDDLEWARE_DONE")
        if (!routeContinues) return await this.finishRequest(ctx, tracer)

        await this.hooks.trigger("onValidation", ctx)
        this.debugger.log(ctx, "HOOK:onValidation")
        if (this.isSettled(ctx)) return await this.finishRequest(ctx, tracer)

        await this.evaluatePolicyPhase(ctx, match, "postValidation")

        await this.hooks.trigger("beforeHandler", ctx)
        this.debugger.log(ctx, "HOOK:beforeHandler")
        if (this.isSettled(ctx)) return await this.finishRequest(ctx, tracer)
        tracer.markHandlerExecuted()
        await this.around("handler", ctx, async () => {
          await match.route.handler(ctx)
        })
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
    }

    return runWithContext(ctx, async () => {
      if (!this.wrappers.request.length) return run()
      let result: OrvaxisContext | undefined
      await this.around("request", ctx, async () => {
        result = await run()
      })
      if (!result) throw new Error('An around("request") wrapper swallowed the request result')
      return result
    })
  }

  async authorize(req: OrvaxisRequest, res: OrvaxisResponse): Promise<OrvaxisContext> {
    const { ctx, tracer } = this.createRequestScope(req, res)

    return runWithContext(ctx, async () => {
      try {
        validateRequest(req)
        const match = this.router.match(req)
        if (!match) {
          throw new HttpError(404, "No matching Orvaxis route for the Express policy guard")
        }
        ctx.meta.route = match
        this.assertRouteCovered(match)

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

        await this.runAuthenticator(ctx, tracer)
        await this.evaluatePolicyPhase(ctx, match, "preValidation")
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

  /** Routes that are neither `public: true` nor covered by a policy that always applies. */
  unprotectedRoutes(): RouteInfo[] {
    return this.router.unprotectedRoutes(this.policies.list())
  }

  /** Throws a `TypeError` naming every unprotected route; adapters call it from `listen()` when `denyByDefault` is on. */
  assertProtected(): void {
    const routes = this.unprotectedRoutes()
    if (routes.length === 0) return
    throw new TypeError(
      `denyByDefault: ${routes.length} route(s) have no policy that always applies and are not public: ` +
        `${routes.map((r) => `${r.method} ${r.path}`).join(", ")}. ` +
        "Add a policy, or declare the route with public: true."
    )
  }

  get enforcesDenyByDefault(): boolean {
    return this.denyByDefault
  }

  /** Fail closed for a route that reached the runtime without coverage (custom adapters, tests). */
  private assertRouteCovered(match: RouteMatch): void {
    if (!this.denyByDefault) return
    const key = `${this.router.generation}:${this.policies.generation}`
    if (key !== this.coverageKey) {
      this.coverage = new WeakMap()
      this.coverageKey = key
    }
    let covered = this.coverage.get(match.route)
    if (covered === undefined) {
      covered = this.router.isCovered(match.group, match.route, this.policies.list())
      this.coverage.set(match.route, covered)
    }
    if (!covered) {
      throw new HttpError(500, "Route protection is not configured", {
        code: "ROUTE_UNPROTECTED",
      })
    }
  }

  /** The context and tracer every request, full or policy-only, starts from. */
  private createRequestScope(
    req: OrvaxisRequest,
    res: OrvaxisResponse
  ): { ctx: OrvaxisContext; tracer: Tracer } {
    const ctx = createContext(req, res, this.logsMaxSize, this.logger)
    captureContext(ctx)
    initPolicyTrace(ctx, this.policyTrace)
    const tracer = new Tracer(req.id ?? generateId())
    ctx.meta.tracer = tracer
    return { ctx, tracer }
  }

  /** Global, then group, then route policies of one phase for the matched route. */
  private async evaluatePolicyPhase(
    ctx: OrvaxisContext,
    match: RouteMatch,
    phase: PolicyPhase
  ): Promise<void> {
    await this.policies.evaluate(ctx, phase, {
      layer: "global",
      trace: this.policyTrace,
      ...(phase === "postValidation"
        ? { beforeEvaluate: (policy: Policy) => this.assertPolicyRequirements(policy, ctx) }
        : {}),
    })
    await this.evaluatePolicies(match.group.policies ?? [], ctx, "group", phase)
    await this.evaluatePolicies(match.route.policies ?? [], ctx, "route", phase)
  }

  /** A response is already out, or the adapter gave up on the request (timeout, disconnect). */
  private isSettled(ctx: OrvaxisContext): boolean {
    return ctx.res.sent || isRequestAbandoned(ctx.req.signal)
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
}
