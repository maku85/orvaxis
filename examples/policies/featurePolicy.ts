import type { OrvaxisContext } from "../../types"

export const featurePolicy = {
  name: "feature-flags",
  priority: 10,

  scope: {
    path: "/beta",
  },

  async evaluate(_ctx: OrvaxisContext) {
    return {
      allow: true,
      modify: { beta: true },
    }
  },
}
