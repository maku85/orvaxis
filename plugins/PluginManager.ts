import type { Runtime } from "../core/Runtime"

export type Plugin = {
  name: string
  apply: (runtime: Runtime) => void
}

export class PluginManager {
  private plugins: Plugin[] = []

  register(plugin: Plugin) {
    this.plugins.push(plugin)
  }

  applyAll(runtime: Runtime) {
    for (const plugin of this.plugins) {
      plugin.apply(runtime)
    }
  }
}
