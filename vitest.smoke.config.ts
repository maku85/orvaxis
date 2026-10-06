import { defineConfig } from "vitest/config"

// Starts the repository's examples as a user would: `pnpm test:examples`. Kept apart from the unit
// suite because each example is a separate process.
export default defineConfig({
  test: {
    include: ["tests/examples.smoke.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
