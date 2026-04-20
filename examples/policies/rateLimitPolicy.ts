export const rateLimitPolicy = {
  name: "rate-limit",
  priority: 100,

  scope: {
    path: /^\/api/,
    method: "GET",
  },

  async evaluate(ctx: any) {
    const _ip = ctx.req.ip

    const allowed = true // placeholder

    if (!allowed) {
      return { allow: false, reason: "Too many requests" }
    }

    return { allow: true }
  },
}
