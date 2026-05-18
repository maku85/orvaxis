import type { OrvaxisContext, Plugin, PluginContext } from "../types"

export type CorsOptions = {
  origin?: string | string[] | RegExp
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
}

function resolveOrigin(
  origin: CorsOptions["origin"],
  requestOrigin: string | undefined
): string | null {
  if (!origin || origin === "*") return "*"
  if (!requestOrigin) return null
  if (typeof origin === "string") return requestOrigin === origin ? requestOrigin : null
  if (Array.isArray(origin)) return origin.includes(requestOrigin) ? requestOrigin : null
  if (origin instanceof RegExp) return origin.test(requestOrigin) ? requestOrigin : null
  return null
}

export function corsPlugin(options: CorsOptions = {}): Plugin {
  const {
    origin = "*",
    methods,
    allowedHeaders,
    exposedHeaders,
    credentials = false,
    maxAge,
  } = options

  return {
    name: "cors",

    apply(runtime: PluginContext) {
      runtime.hooks.on("onRequest", (ctx: OrvaxisContext) => {
        const requestOrigin = ctx.req.headers.origin as string | undefined
        const allowedOrigin = resolveOrigin(origin, requestOrigin)
        if (!allowedOrigin) return

        ctx.res.setHeader("Access-Control-Allow-Origin", allowedOrigin)
        if (allowedOrigin !== "*") {
          ctx.res.setHeader("Vary", "Origin")
        }
        if (credentials) {
          ctx.res.setHeader("Access-Control-Allow-Credentials", "true")
        }
        if (exposedHeaders?.length) {
          ctx.res.setHeader("Access-Control-Expose-Headers", exposedHeaders.join(", "))
        }

        if (ctx.req.method.toUpperCase() === "OPTIONS") {
          const reqAllowed = ctx.meta.allowedMethods as string[] | undefined
          const allowMethods = methods?.join(", ") ?? reqAllowed?.join(", ") ?? "*"
          ctx.res.setHeader("Access-Control-Allow-Methods", allowMethods)

          const requestedHeaders = ctx.req.headers["access-control-request-headers"] as
            | string
            | undefined
          const allow = allowedHeaders?.join(", ") ?? requestedHeaders
          if (allow) ctx.res.setHeader("Access-Control-Allow-Headers", allow)
          if (maxAge !== undefined) ctx.res.setHeader("Access-Control-Max-Age", String(maxAge))
        }
      })
    },
  }
}
