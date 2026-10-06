// Pre-publication check of the package exactly as npm would ship it.
//
//   node scripts/check-package.mjs             full check (needs registry access for peers)
//   node scripts/check-package.mjs --no-peers  tarball inspection and the peer-less consumer only
//
// 1. `npm pack` builds the tarball; its file list is checked (whitelist, export targets, budgets).
// 2. Each consumer is a temporary directory outside the repository that installs ONLY that
//    tarball (plus the peers it needs) with npm, then runs CJS, ESM and NodeNext type checks.
// 3. Every temporary directory is removed, also on failure.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"

const noPeers = process.argv.includes("--no-peers")
const repo = resolve(".")
const repoRequire = createRequire(join(repo, "package.json")) // only used to find the TypeScript compiler
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"))

// Budgets: current tarball is ~71 kB packed, ~444 kB unpacked, 250 entries. The limits leave room
// for growth but trip on accidents such as shipping assets/ (1.5 MB), coverage/ or sources.
const BUDGET = { packed: 120_000, unpacked: 700_000, entries: 400 }
const ALLOWED_ROOT = new Set(["package.json", "README.md", "LICENSE", "CHANGELOG.md"])
const ALLOWED_FILE = /\.(?:js|d\.ts|d\.ts\.map|json)$/

const root = mkdtempSync(join(tmpdir(), "orvaxis-package-check-"))
const npmEnv = {
  ...process.env,
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
  npm_config_loglevel: "error",
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: npmEnv, ...options })
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`
  )
  return result.stdout
}

function installedVersion(name) {
  return JSON.parse(readFileSync(join(repo, "node_modules", name, "package.json"), "utf8")).version
}

function exportTargets(value) {
  if (typeof value === "string") return [value]
  return Object.values(value).flatMap(exportTargets)
}

try {
  // ── 1. Tarball ──────────────────────────────────────────────────────────────
  const packDirectory = join(root, "pack")
  mkdirSync(packDirectory)
  const [packed] = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", packDirectory], { cwd: repo })
  )
  const tarball = join(packDirectory, packed.filename)
  const files = new Set(packed.files.map((file) => file.path))

  for (const path of files) {
    const inDist = path.startsWith("dist/")
    assert.ok(
      inDist
        ? ALLOWED_FILE.test(path) && !/(^|\/)(tests?|examples?)\//.test(path)
        : ALLOWED_ROOT.has(path),
      `Unexpected file in the tarball: ${path}`
    )
  }
  for (const required of ["package.json", "README.md", "LICENSE", "dist/esm/package.json"]) {
    assert.ok(files.has(required), `Missing from the tarball: ${required}`)
  }
  assert.equal(
    JSON.parse(readFileSync(join(repo, "dist/esm/package.json"), "utf8")).type,
    "module",
    "dist/esm/package.json must mark the ESM build as a module"
  )
  assert.ok(packed.size <= BUDGET.packed, `Packed size ${packed.size} exceeds ${BUDGET.packed}`)
  assert.ok(
    packed.unpackedSize <= BUDGET.unpacked,
    `Unpacked size ${packed.unpackedSize} exceeds ${BUDGET.unpacked}`
  )
  assert.ok(
    packed.entryCount <= BUDGET.entries,
    `${packed.entryCount} entries exceed ${BUDGET.entries}`
  )

  const targets = [pkg.main, pkg.types, ...exportTargets(pkg.exports)]
  for (const target of targets) {
    assert.ok(
      files.has(target.replace(/^\.\//, "")),
      `package.json points to a missing file: ${target}`
    )
  }
  for (const [subpath, conditions] of Object.entries(pkg.exports)) {
    for (const condition of ["import", "require"]) {
      assert.ok(
        conditions[condition]?.types && conditions[condition]?.default,
        `${subpath} needs ${condition}.types and ${condition}.default`
      )
    }
  }

  // ── 2. Consumers ────────────────────────────────────────────────────────────
  const subpaths = Object.keys(pkg.exports).map((key) =>
    key === "." ? "orvaxis" : `orvaxis/${key.slice(2)}`
  )
  const coreSubpaths = ["orvaxis", "orvaxis/testing", "orvaxis/openapi"]
  const peerSubpaths = {
    "orvaxis/express": "express",
    "orvaxis/fastify": "fastify",
    "orvaxis/otel": "@opentelemetry/api",
  }
  assert.deepEqual(
    [...subpaths].sort(),
    [...coreSubpaths, ...Object.keys(peerSubpaths)].sort(),
    "package.json exports changed: update scripts/check-package.mjs so every subpath is exercised"
  )

  // Types for the declared minimum Node line (engines.node >=22.13.0).
  const typesNode = "22"
  const tsc = repoRequire.resolve("typescript/bin/tsc")

  function createConsumer(name, peers) {
    const directory = join(root, name)
    mkdirSync(directory)
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ name: `consumer-${name}`, private: true })
    )
    const specs = [tarball, `@types/node@${typesNode}`, ...peers]
    run("npm", ["install", "--no-save", "--ignore-scripts", ...specs], { cwd: directory })
    return directory
  }

  function runScript(directory, file, body) {
    writeFileSync(join(directory, file), body)
    const result = spawnSync(process.execPath, [file], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "" },
    })
    assert.equal(
      result.status,
      0,
      `${file} failed in ${directory}\n${result.stdout}${result.stderr}`
    )
  }

  function typeCheck(directory, source) {
    writeFileSync(join(directory, "consumer.mts"), source)
    writeFileSync(join(directory, "consumer.cts"), source)
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          types: ["node"],
        },
        include: ["consumer.mts", "consumer.cts"],
      })
    )
    const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
      cwd: directory,
      encoding: "utf8",
    })
    assert.equal(
      result.status,
      0,
      `NodeNext type-check failed in ${directory}\n${result.stdout}${result.stderr}`
    )
  }

  // The body is shared; only the module loader differs between CJS and ESM.
  const cjs = (body) => `const assert = require("node:assert/strict")
const load = (name) => Promise.resolve().then(() => require(name))
const resolved = (name) => require.resolve(name)
${body}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`
  const esm = (body) => `import assert from "node:assert/strict"
import { createRequire } from "node:module"
const load = (name) => import(name)
const resolved = (name) => createRequire(import.meta.url).resolve(name)
${body}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`
  const installedOnly = (names) => `
const dflt = (m) => m.default ?? m
function assertInstalled(name) {
  // Resolution must land inside this consumer's node_modules, never in the repository.
  assert.ok(resolved(name).includes("node_modules"), name + " resolved outside node_modules")
  assert.ok(!resolved(name).startsWith(${JSON.stringify(repo + sep)}), name + " resolved into the repository")
}
for (const name of ${JSON.stringify(names)}) assertInstalled(name)
`
  const smoke = `
async function smoke() {
  const { Orvaxis } = await load("orvaxis")
  const { testRequest } = await load("orvaxis/testing")
  const { generateOpenApiDocument } = await load("orvaxis/openapi")
  const app = new Orvaxis()
  app.group({ prefix: "/api", routes: [{ method: "GET", path: "/items/:id", handler: (ctx) => ctx.res.json({ id: ctx.params.id }) }] })
  const response = await testRequest(app, { path: "/api/items/42" })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { id: "42" })
  const document = generateOpenApiDocument(app, { title: "Check", version: "1" })
  assert.ok(document.paths["/api/items/{id}"])
  return app
}
async function serve(adapter) {
  let port = 0
  await adapter.listen(0, (assigned) => { port = assigned })
  try {
    const response = await fetch("http://127.0.0.1:" + port + "/api/items/7")
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { id: "7" })
  } finally {
    await adapter.close()
  }
}
`
  const coreTypes = `
import { Orvaxis, defineRoute, schemaValidationPlugin } from "orvaxis"
import { testRequest } from "orvaxis/testing"
import { generateOpenApiDocument } from "orvaxis/openapi"
const app = new Orvaxis()
app.register(schemaValidationPlugin)
app.group({ prefix: "/api", routes: [defineRoute({
  method: "GET", path: "/items/:id",
  schema: { params: { parse: (_value: unknown) => ({ id: 42 }) } },
  handler: (ctx) => {
    const id: number = ctx.params.id
    // @ts-expect-error The parsed parameter is a number, not a string.
    const invalid: string = ctx.params.id
    ctx.res.json({ id })
  },
})] })
testRequest(app, { path: "/api/items/42" })
generateOpenApiDocument(app, { title: "Check", version: "1" })
`

  // Consumer without peers: core, testing and OpenAPI work; integrations fail on the missing peer.
  {
    const directory = createConsumer("no-peers", [])
    const missing = () => `
async function main() {
  await smoke()
  for (const [name, peer] of Object.entries(${JSON.stringify(peerSubpaths)})) {
    await assert.rejects(load(name), (error) => {
      const message = String(error.message)
      return ["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(error.code) && message.includes(peer)
    }, name + " must fail naming the missing peer " + peer)
  }
}
`
    runScript(directory, "consumer.cjs", cjs(installedOnly(coreSubpaths) + smoke + missing()))
    runScript(directory, "consumer.mjs", esm(installedOnly(coreSubpaths) + smoke + missing()))
    typeCheck(directory, coreTypes)
  }

  if (noPeers) {
    console.log("Package check passed (--no-peers): tarball contents and the peer-less consumer.")
  } else {
    const types = {
      express: `import express from "express"
import { createExpressServer, createExpressPolicyGuard } from "orvaxis/express"
const web = express()
createExpressServer(new Orvaxis(), web)
web.use(createExpressPolicyGuard(new Orvaxis()))
`,
      fastify: `import Fastify from "fastify"
import { createFastifyServer } from "orvaxis/fastify"
createFastifyServer(new Orvaxis(), Fastify())
`,
      otel: `import { trace } from "@opentelemetry/api"
import { otelPlugin } from "orvaxis/otel"
new Orvaxis().register(otelPlugin({ tracer: trace.getTracer("check") }))
`,
    }
    const expressBody = `
  const { createExpressServer, createExpressPolicyGuard } = await load("orvaxis/express")
  assert.equal(typeof createExpressPolicyGuard, "function")
  const express = dflt(await load("express"))
  await serve(createExpressServer(app, express(), { timeout: 0 }))
`
    const consumers = [
      {
        name: "express4",
        peers: [
          `express@${installedVersion("express4")}`,
          `@types/express@${installedVersion("@types/express4")}`,
        ],
        subpaths: [...coreSubpaths, "orvaxis/express"],
        body: expressBody,
        types: `import { Orvaxis } from "orvaxis"\n${types.express}`,
      },
      {
        name: "all-peers",
        peers: [
          `express@${installedVersion("express5")}`,
          `@types/express@${installedVersion("@types/express")}`,
          `fastify@${installedVersion("fastify")}`,
          `@opentelemetry/api@${installedVersion("@opentelemetry/api")}`,
        ],
        subpaths,
        body: `${expressBody}
  const { createFastifyServer } = await load("orvaxis/fastify")
  const Fastify = dflt(await load("fastify"))
  await serve(createFastifyServer(app, Fastify(), { timeout: 0 }))
  const { otelPlugin } = await load("orvaxis/otel")
  const { trace } = await load("@opentelemetry/api")
  const { testRequest } = await load("orvaxis/testing")
  app.register(otelPlugin({ tracer: trace.getTracer("check") }))
  assert.equal((await testRequest(app, { path: "/api/items/9" })).status, 200)
`,
        types: `import { Orvaxis } from "orvaxis"\n${types.express}${types.fastify}${types.otel}`,
      },
    ]
    for (const consumer of consumers) {
      const directory = createConsumer(consumer.name, consumer.peers)
      const body = `${installedOnly([...consumer.subpaths, ...consumer.peers.map((p) => p.replace(/@[^@/]+$/, "")).filter((p) => !p.startsWith("@types/"))])}${smoke}
async function main() {
  const app = await smoke()
${consumer.body}}
`
      runScript(directory, "consumer.cjs", cjs(body))
      runScript(directory, "consumer.mjs", esm(body))
      typeCheck(directory, consumer.types)
    }
    console.log(
      `Package check passed: ${packed.entryCount} files, ${packed.size} B packed; CJS, ESM and NodeNext types for ${subpaths.length} subpaths in isolated consumers (no peers, Express 4, Express 5 + Fastify 5 + OpenTelemetry).`
    )
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
