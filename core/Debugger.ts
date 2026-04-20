export class Debugger {
  enabled = false

  enable() {
    this.enabled = true
  }

  log(ctx: any, event: string, meta?: any) {
    if (!this.enabled) return

    ctx.meta.debug ??= {
      timeline: [],
    }

    ctx.meta.debug.timeline.push({
      event,
      time: Date.now(),
      meta,
    })
  }
}
