import type { Group, HookName, Middleware, OrvaxisContext, OrvaxisRequest, OrvaxisResponse, Policy } from "../types"
import { Runtime } from "./Runtime"

export class Orvaxis {
  private runtime = new Runtime()

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

  group(group: Group) {
    this.runtime.router.group(group)
    return this
  }

  policy(policy: Policy) {
    this.runtime.policies.register(policy)
    return this
  }

  register(plugin: { name: string; apply: (runtime: Runtime) => void }) {
    plugin.apply(this.runtime)
    return this
  }

  async handle(req: OrvaxisRequest, res: OrvaxisResponse) {
    return this.runtime.execute(req, res)
  }
}
