import type { PluginContext } from "../types"

export type Plugin = {
  name: string
  apply: (ctx: PluginContext) => void
}

export class PluginManager {
  private plugins: Plugin[] = []

  register(plugin: Plugin) {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new TypeError(`Plugin "${plugin.name}" is already registered`)
    }
    this.plugins.push(plugin)
  }

  list(): readonly Plugin[] {
    return this.plugins
  }
}
