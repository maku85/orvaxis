// Runs the README quickstart exactly as a new user would, in a clean directory, against the
// packed package: the documented install commands, the documented snippet, the documented
// requests. Only two things are substituted, both stated below: the `orvaxis` install argument
// (the unpublished tarball of this checkout) and the listening port (a free one).
//
//   node scripts/check-quickstart.mjs      needs the registry for express, tsx and typescript
//
// The consumer is a temporary directory outside the repository, removed even on failure.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { findSnippets } from "./lib/snippets.mjs"

const repo = resolve(".")
const readme = readFileSync(join(repo, "README.md"), "utf8")
const root = mkdtempSync(join(tmpdir(), "orvaxis-quickstart-check-"))
let server

const env = {
  ...process.env,
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
  npm_config_loglevel: "error",
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env })
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`
  )
  return result.stdout
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, () => {
      const { port } = probe.address()
      probe.close(() => resolvePort(port))
    })
  })
}

try {
  // The commands come from the README itself, so a changed instruction changes this check.
  const section = readme.slice(readme.indexOf("## Quickstart"))
  const commands = /```bash\n([\s\S]*?)\n```/.exec(section)?.[1].split("\n") ?? []
  assert.deepEqual(
    commands.filter((line) => line.startsWith("npm ")),
    [
      "npm init -y",
      "npm install orvaxis express",
      "npm install -D tsx typescript @types/node @types/express",
    ],
    "the README quickstart install commands changed; update scripts/check-quickstart.mjs deliberately"
  )
  assert.ok(
    section.includes("`npx tsx server.ts`"),
    "the README must tell the reader to run `npx tsx server.ts`"
  )
  const snippet = findSnippets(section).find((entry) =>
    entry.reference.startsWith("examples/quickstart.ts")
  )
  assert.ok(snippet?.code, "the README quickstart snippet marker is missing")

  const packDirectory = join(root, "pack")
  mkdirSync(packDirectory)
  const [{ filename }] = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", packDirectory], repo)
  )
  const tarball = join(packDirectory, filename)

  const project = join(root, "orvaxis-quickstart")
  mkdirSync(project)
  for (const command of commands.filter((line) => line.startsWith("npm "))) {
    const args = command
      .split(" ")
      .slice(1)
      .map((arg) => (arg === "orvaxis" ? tarball : arg))
    run("npm", args, project)
  }

  const port = await freePort()
  assert.equal(
    snippet.code.split(".listen(3000)").length,
    2,
    "the snippet must listen on port 3000 exactly once"
  )
  writeFileSync(
    join(project, "server.ts"),
    `${snippet.code.replace(".listen(3000)", `.listen(${port})`)}\n`
  )

  run(
    "npx",
    [
      "tsc",
      "--noEmit",
      "--strict",
      "--target",
      "es2022",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--types",
      "node",
      "server.ts",
    ],
    project
  )

  server = spawn("npx", ["tsx", "server.ts"], {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  server.stdout.on("data", (chunk) => {
    output += chunk
  })
  server.stderr.on("data", (chunk) => {
    output += chunk
  })
  const base = `http://127.0.0.1:${port}/api/reports/alice`
  let response
  for (let attempt = 0; attempt < 100 && !response; attempt++) {
    response = await fetch(base, { headers: { "x-user-id": "alice" } }).catch(() => undefined)
    if (!response) await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(response, `the server did not start\n${output}`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ownerId: "alice", report: "quarterly" })

  const denied = await fetch(base, { headers: { "x-user-id": "bob" } })
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error, "Only the report owner can view it")
  const anonymous = await fetch(base)
  assert.equal(anonymous.status, 401)

  console.log(
    "Quickstart check passed: documented install, snippet and requests work in a clean project (200, 403, 401)."
  )
} finally {
  server?.kill("SIGTERM")
  rmSync(root, { recursive: true, force: true })
}
