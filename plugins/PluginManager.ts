import type { PluginContext } from "../types"

export type Plugin = {
  name: string
  apply: (ctx: PluginContext) => void
}

export class PluginManager {
  private plugins: Plugin[] = []

  register(plugin: Plugin) {
    this.plugins.push(plugin)
  }

  list(): readonly Plugin[] {
    return this.plugins
  }
}
