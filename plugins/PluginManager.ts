import type { PluginContext } from "../types/index.js"

export type Plugin = {
  name: string
  /** Names of plugins that must already be registered; checked before `apply` runs. */
  dependsOn?: readonly string[]
  apply: (ctx: PluginContext) => void
}

export class PluginManager {
  private plugins: Plugin[] = []

  has(name: string): boolean {
    return this.plugins.some((p) => p.name === name)
  }

  /** Throws if the plugin duplicates a name or one of its declared dependencies is missing. */
  assertRegistrable(plugin: Plugin) {
    if (this.has(plugin.name)) {
      throw new TypeError(`Plugin "${plugin.name}" is already registered`)
    }
    for (const dependency of plugin.dependsOn ?? []) {
      if (!this.has(dependency)) {
        throw new TypeError(
          `Plugin "${plugin.name}" depends on "${dependency}", which must be registered first`
        )
      }
    }
  }

  register(plugin: Plugin) {
    this.assertRegistrable(plugin)
    this.plugins.push(plugin)
  }

  list(): readonly Plugin[] {
    return this.plugins
  }
}
