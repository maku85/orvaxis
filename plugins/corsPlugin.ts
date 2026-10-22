import type { OrvaxisContext, PluginContext } from "../types/index.js"
import type { Plugin } from "./PluginManager.js"

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

function appendVary(ctx: OrvaxisContext, token: string): void {
  const existing = ctx.res.getHeader?.("Vary")
  const tokens = (Array.isArray(existing) ? existing.join(",") : (existing ?? ""))
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.includes("*") || tokens.some((t) => t.toLowerCase() === token.toLowerCase())) return
  ctx.res.setHeader("Vary", [...tokens, token].join(", "))
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

  // Browsers reject `Access-Control-Allow-Origin: *` on credentialed requests, so this
  // combination can never work; fail at registration instead of at the first browser request.
  if (credentials && (!origin || origin === "*")) {
    throw new TypeError(
      'corsPlugin: credentials: true requires an explicit origin (string, array or RegExp); "*" is rejected by browsers'
    )
  }
  const dynamicOrigin = !!origin && origin !== "*"

  return {
    name: "cors",

    apply(runtime: PluginContext) {
      runtime.hooks.on("onRequest", (ctx: OrvaxisContext) => {
        const requestOrigin = ctx.req.headers.origin as string | undefined
        const allowedOrigin = resolveOrigin(origin, requestOrigin)
        // The response depends on Origin whenever the allowed origin is not fixed, including
        // when this origin is refused: a cache must not serve that answer to an allowed one.
        if (dynamicOrigin) appendVary(ctx, "Origin")
        if (!allowedOrigin) return

        ctx.res.setHeader("Access-Control-Allow-Origin", allowedOrigin)
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
          if (!allowedHeaders?.length && requestedHeaders) {
            appendVary(ctx, "Access-Control-Request-Headers")
          }
          if (maxAge !== undefined) ctx.res.setHeader("Access-Control-Max-Age", String(maxAge))
        }
      })
    },
  }
}
