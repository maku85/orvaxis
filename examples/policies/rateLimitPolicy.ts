import type { OrvaxisContext } from "../../types"

export const rateLimitPolicy = {
  name: "rate-limit",
  priority: 100,

  scope: {
    path: /^\/api/,
    method: "GET",
  },

  async evaluate(ctx: OrvaxisContext) {
    const _ip = ctx.req.headers["x-forwarded-for"] ?? ctx.req.headers["x-real-ip"]

    const allowed = true // placeholder

    if (!allowed) {
      return { allow: false, reason: "Too many requests" }
    }

    return { allow: true }
  },
}
