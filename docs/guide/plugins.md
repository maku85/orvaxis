# Plugins

A plugin packages behavior that you would otherwise register by hand. Orvaxis ships five; writing your own takes a name and an `apply` function.

## The contract

```ts
type Plugin = { name: string; apply: (ctx: PluginContext) => void }
interface PluginContext { hooks: { on(name: HookName, fn: (ctx, error?) => void | Promise<void>): void } }
```

`app.register(plugin)` applies the plugin immediately. The name must be unique: registering a second plugin with the same name throws a `TypeError`. A plugin registers hooks through `ctx.hooks.on`, which is **all** that `PluginContext` exposes; hooks run in registration order, mixed with hooks added by `app.on`. For middleware, policies or routes, write a factory that takes `app` and calls its public methods (`use`, `policy`, `group`) rather than reaching into the runtime. The hooks themselves, and which of them may answer a request, are explained in [Middleware and hooks](/guide/middleware-and-hooks).

<!-- snippet: examples/custom-plugin.ts#plugin -->
```ts
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
```

<!-- snippet: examples/custom-plugin.ts#usage -->
```ts
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
```

Run it with `pnpm exec tsx examples/custom-plugin.ts`: the successful request records a duration, the failing one records `request.error.get`. Note which hook fires for which ending (`afterPipeline` for completed requests, `onError` for failures); a plugin that wants every request needs both.

## Built-in plugins

| Plugin | Import | Peer | What it does |
|---|---|---|---|
| `loggerPlugin(options?)` | `orvaxis` | — | request, response and error records; see [Observability](/guide/observability#logging-and-request-ids) |
| `schemaValidationPlugin` | `orvaxis` | — | parses `body`, `params`, `query` and `headers` in `onValidation`; see [Typed input validation](/guide/typed-validation) |
| `responseValidationPlugin(options?)` | `orvaxis` | — | validates responses by status, `strict` or `warn`; see [Response contracts](/guide/response-contracts) |
| `corsPlugin(options?)` | `orvaxis` | — | CORS headers and automatic `OPTIONS` preflight answers |
| `otelPlugin({ tracer })` | `orvaxis/otel` | `@opentelemetry/api` | spans for each request; see [OpenTelemetry](/guide/opentelemetry) |

`corsPlugin` options: `origin` (string, string array or `RegExp`, default `"*"`), `methods` (default: the registered methods), `allowedHeaders` (default: mirrors the request), `exposedHeaders`, `credentials` and `maxAge`. A preflight `OPTIONS` on a path with registered routes receives `204` and the CORS headers without a route being declared; `OPTIONS` on an unknown path is a `404`. With an `origin` other than `"*"` it sets `Vary: Origin`. The full option table is in the [core concepts reference](/reference/core-concepts#plugins).

`loggerPlugin`, `corsPlugin` and the validation plugins work with any adapter and need no peer dependency; only `orvaxis/otel` needs `@opentelemetry/api`, and importing it without the peer fails with a module-not-found error that names the package.
