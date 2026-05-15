import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    cache: false,
    benchmark: {
      reporters: ["default"],
    },
  },
})
