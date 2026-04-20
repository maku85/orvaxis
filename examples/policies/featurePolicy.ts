export const featurePolicy = {
  name: "feature-flags",
  priority: 10,

  scope: {
    path: "/beta",
  },

  async evaluate(_ctx: any) {
    return {
      allow: true,
      modify: { beta: true },
    }
  },
}
