import { basename } from "node:path"
import { testRequest } from "../core/testHarness"
import { Orvaxis, type Plugin } from "../index"

// A plugin is a name and an `apply` function. `apply` receives a PluginContext, which exposes
// exactly one thing: `hooks.on(name, fn)`.

// #region plugin
export function metricsPlugin(record: (name: string, value: number) => void): Plugin {
  return {
    name: "metrics", // must be unique: registering the same name twice throws a TypeError
    apply(runtime) {
      runtime.hooks.on("afterPipeline", (ctx) => {
        const trace = ctx.meta.trace
        if (trace?.endTime !== undefined)
          record("request.duration_ms", trace.endTime - trace.startTime)
      })
      runtime.hooks.on("onError", (ctx) => {
        record(`request.error.${ctx.req.method.toLowerCase()}`, 1)
      })
    },
  }
}
// #endregion

// #region usage
export function createPluggedApp(record: (name: string, value: number) => void) {
  const app = new Orvaxis()
  app.register(metricsPlugin(record))

  // A plugin that needs more than hooks wraps the app instead: the factory receives `app`
  // and uses its public methods (`use`, `policy`, `group`).
  app.group({
    prefix: "/api",
    routes: [
      { method: "GET", path: "/ok", handler: (ctx) => ctx.res.json({ ok: true }) },
      {
        method: "GET",
        path: "/fail",
        handler: () => {
          throw new Error("boom")
        },
      },
    ],
  })
  return app
}
// #endregion

if (basename(process.argv[1] ?? "") === "custom-plugin.ts") {
  ;(async () => {
    const seen: string[] = []
    const app = createPluggedApp((name, value) =>
      seen.push(name.endsWith("_ms") ? `${name}=<ms>` : `${name}=${value}`)
    )
    await testRequest(app, { path: "/api/ok" })
    await testRequest(app, { path: "/api/fail" })
    console.log(seen.join("\n"))
  })()
}
