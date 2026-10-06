import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

// Runs the HTTP adapter tests once per declared peer target. Express is aliased to an installed
// major (`express4`, `express5`); Fastify 5 is the only declared Fastify major.
const require = createRequire(import.meta.url)
const files = [
  "tests/expressAdapter.test.ts",
  "tests/expressPolicyGuard.test.ts",
  "tests/httpAdapters.test.ts",
  "tests/fastifyAdapter.test.ts",
]
const targets = [
  {
    name: "express4",
    env: { ORVAXIS_EXPRESS: "express4" },
    files: files.filter((f) => !f.includes("fastify")),
  },
  {
    name: "express5",
    env: { ORVAXIS_EXPRESS: "express5" },
    files: files.filter((f) => !f.includes("fastify")),
  },
  { name: "fastify5", env: {}, files: files.filter((f) => !f.includes("express")) },
]
const only = process.argv[2]
let failed = false
for (const target of targets) {
  if (only && target.name !== only) continue
  const pkg = target.name.startsWith("express") ? target.name : "fastify"
  const version = require(`${pkg}/package.json`).version
  console.log(`\n=== ${target.name} (${pkg}@${version}) on Node ${process.versions.node} ===`)
  const result = spawnSync("pnpm", ["exec", "vitest", "run", ...target.files], {
    stdio: "inherit",
    env: { ...process.env, ...target.env, ORVAXIS_COMPAT_TARGET: target.name },
  })
  if (result.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
