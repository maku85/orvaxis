import { defineConfig } from "vitest/config"

// `pnpm test:compat` runs the HTTP tests against another installed Express major by aliasing the
// `express` import to the `express4` / `express5` dev dependencies (see scripts/run-compat.mjs).
const express = process.env.ORVAXIS_EXPRESS

export default defineConfig({
  resolve: express ? { alias: [{ find: /^express$/, replacement: express }] } : {},
  test: {
    globals: true,
    environment: "node",
    cache: false,
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["core/**", "debug/**", "http/**", "middleware/**", "openapi/**", "plugins/**"],
      exclude: ["examples/**", "tests/**", "dist/**", "node_modules/**"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90,
        // Adapters and the OpenAPI export fail in ways that cross a process boundary (sockets,
        // published documents), so each area must keep its own floor instead of hiding behind
        // the global average.
        "http/**": { lines: 90, functions: 90, branches: 80, statements: 90 },
        "openapi/**": { lines: 85, functions: 90, branches: 70, statements: 85 },
      },
    },
  },
})
