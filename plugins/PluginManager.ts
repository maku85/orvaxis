export type Plugin = {
  name: string
  apply: (orvaxis: any) => void
}

export class PluginManager {
  private plugins: Plugin[] = []

  register(plugin: Plugin) {
    this.plugins.push(plugin)
  }

  applyAll(orvaxis: any) {
    for (const plugin of this.plugins) {
      plugin.apply(orvaxis)
    }
  }
}
