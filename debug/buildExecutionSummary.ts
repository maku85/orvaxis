export function buildExecutionSummary(ctx: any) {
  const debug = ctx.meta.debug

  if (!debug) return null

  return {
    route: ctx.meta.route,
    duration:
      ctx.meta.trace?.endTime != null && ctx.meta.trace?.startTime != null
        ? ctx.meta.trace.endTime - ctx.meta.trace.startTime
        : null,

    steps: debug.timeline.reduce((acc: any, ev: any) => {
      const group = ev.event.split(":")[0]

      acc[group] ??= []
      acc[group].push(ev)

      return acc
    }, {}),
  }
}
