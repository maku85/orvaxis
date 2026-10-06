import type { Plugin } from "../plugins/PluginManager.js"
import type {
  Group,
  HookName,
  Middleware,
  OrvaxisContext,
  OrvaxisOptions,
  OrvaxisRequest,
  OrvaxisResponse,
  Policy,
  RouteInspection,
} from "../types/index.js"
import { Runtime } from "./Runtime.js"

export class Orvaxis {
  private runtime: Runtime

  constructor(options: OrvaxisOptions = {}) {
    this.runtime = new Runtime(options)
  }

  get debugger() {
    return this.runtime.debugger
  }

  use(fn: Middleware) {
    this.runtime.pipeline.use(fn)
    return this
  }

  on(name: HookName, fn: (ctx: OrvaxisContext, error?: Error) => Promise<void> | void) {
    this.runtime.hooks.on(name, fn)
    return this
  }

  /**
   * Register a route group. Handlers, middleware and policies may be typed with an
   * `OrvaxisContext<TState, TMeta>`; the types are inferred from them or given explicitly.
   */
  group<
    TState extends Record<string, unknown> = Record<string, unknown>,
    TMeta extends Record<string, unknown> = Record<never, never>,
  >(group: Group<TState, TMeta>) {
    this.runtime.router.group(group as unknown as Group)
    return this
  }

  policy(policy: Policy) {
    this.runtime.policies.register(policy)
    return this
  }

  register(plugin: Plugin) {
    this.runtime.addPlugin(plugin)
    return this
  }

  routes() {
    return this.runtime.router.routes()
  }

  inspectRoutes(): RouteInspection[] {
    return this.runtime.router.inspectRoutes(this.runtime.policies.list())
  }

  async handle(req: OrvaxisRequest, res: OrvaxisResponse) {
    return this.runtime.execute(req, res)
  }

  /** Run global, group, and route pre-validation policies without invoking the route handler. */
  async authorize(req: OrvaxisRequest, res: OrvaxisResponse) {
    return this.runtime.authorize(req, res)
  }
}
