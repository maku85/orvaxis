import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { createServer } from "node:net"
import { describe, expect, it } from "vitest"

// Runs the examples the catalog lists and checks the output the catalog promises. A command is not
// considered verified because its source file exists: the process has to start and answer.
const catalog = readFileSync("docs/examples/index.md", "utf8")
const tsx = ["node_modules/tsx/dist/cli.mjs"]

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
}

async function waitForPort(port: number, child: ChildProcess, output: () => string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error(`example exited early\n${output()}`)
    const open = await new Promise<boolean>((resolve) => {
      const socket = new (require("node:net").Socket)()
      socket.once("connect", () => {
        socket.destroy()
        resolve(true)
      })
      socket.once("error", () => resolve(false))
      socket.connect(port, "127.0.0.1")
    })
    if (open) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`nothing listened on ${port}\n${output()}`)
}

type Check = {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: unknown
  status: number
  includes?: string
}

const servers: { file: string; checks: Check[]; env?: Record<string, string> }[] = [
  {
    file: "express-server",
    checks: [{ path: "/api/hello", status: 200, includes: "Hello from Orvaxis" }],
  },
  {
    file: "fastify-server",
    checks: [
      { path: "/api/users", status: 200, headers: { "x-api-key": "demo" }, includes: "alice" },
      { path: "/api/users", status: 403 },
    ],
  },
  {
    file: "policy-server",
    checks: [
      { path: "/api/hello", status: 403 },
      {
        path: "/api/hello",
        status: 200,
        headers: { "x-api-key": "demo" },
        includes: "Hello, authenticated user",
      },
    ],
  },
  {
    file: "hooks-and-plugins",
    checks: [
      { path: "/api/fast", status: 200, includes: "immediate" },
      { path: "/api/nothing", status: 404, includes: "Not Found" },
    ],
  },
  {
    file: "wildcard-routing",
    checks: [
      { path: "/files/docs/readme.md", status: 200, includes: "docs/readme.md" },
      { path: "/api/status", status: 200, includes: "ok" },
    ],
  },
  {
    file: "schema-validation",
    checks: [
      { method: "POST", path: "/api/users", status: 201, body: { name: "Alice", age: 30 } },
      { method: "POST", path: "/api/users", status: 422, body: { name: "", age: -1 } },
    ],
  },
  { file: "debug-trace", checks: [{ path: "/api/users", status: 200, includes: "alice" }] },
  { file: "otel-plugin", checks: [{ path: "/api/users/42", status: 200, includes: "Alice" }] },
  {
    file: "typed-context",
    checks: [
      { path: "/api/me", status: 401 },
      { path: "/api/me", status: 200, headers: { "x-api-key": "k-1" }, includes: "u-1" },
    ],
  },
  {
    file: "streaming",
    checks: [
      { path: "/api/records", status: 200, includes: '{"id":2,"name":"Bob"}' },
      { path: "/api/events", status: 200, includes: "data: connected" },
    ],
  },
  {
    file: "express-existing-route",
    checks: [
      {
        path: "/api/documents/alice",
        status: 200,
        headers: { "x-user-id": "alice" },
        includes: "alice",
      },
      { path: "/api/documents/alice", status: 403, headers: { "x-user-id": "bob" } },
    ],
  },
  {
    file: "tenant-tasks-server",
    checks: [
      {
        path: "/api/tenants/acme/tasks/task-1",
        status: 200,
        headers: { "x-api-key": "key-alice" },
      },
      { path: "/api/tenants/acme/tasks/task-1", status: 403, headers: { "x-api-key": "key-bob" } },
      { path: "/api/tenants/acme/tasks/task-1", status: 401 },
    ],
  },
  {
    file: "realistic-express",
    checks: [
      { path: "/api/v1/tasks", status: 200, headers: { "x-api-key": "key-alice" } },
      { path: "/api/v1/tasks", status: 401 },
    ],
  },
  {
    file: "realistic-fastify",
    checks: [
      { path: "/api/v1/tasks", status: 200, headers: { "x-api-key": "key-alice" } },
      { path: "/api/v1/tasks", status: 401 },
    ],
  },
]

describe("server examples answer as the catalog says", () => {
  it.each(servers.map((server) => [server.file, server] as const))("%s", async (file, server) => {
    const port = await freePort()
    const child = spawn(process.execPath, [...tsx, `examples/${file}.ts`], {
      env: { ...process.env, PORT: String(port), ...server.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    })
    let output = ""
    child.stdout?.on("data", (chunk) => {
      output += chunk
    })
    child.stderr?.on("data", (chunk) => {
      output += chunk
    })
    try {
      await waitForPort(port, child, () => output)
      for (const check of server.checks) {
        const response = await fetch(`http://127.0.0.1:${port}${check.path}`, {
          method: check.method ?? "GET",
          headers: {
            ...(check.body ? { "content-type": "application/json" } : {}),
            ...(check.headers ?? {}),
          },
          body: check.body ? JSON.stringify(check.body) : undefined,
        })
        const text =
          check.path === "/api/events"
            ? (await response.body?.getReader().read())?.value
            : await response.text()
        const body = typeof text === "string" ? text : new TextDecoder().decode(text)
        expect(response.status, `${file} ${check.path}\n${output}`).toBe(check.status)
        if (check.includes) expect(body, `${file} ${check.path}`).toContain(check.includes)
      }
    } finally {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch {
          child.kill("SIGKILL")
        }
      }
    }
  })
})

const finite: { file: string; includes: string[] }[] = [
  {
    file: "policy-diagnostics",
    includes: ["Stopped by: document-owner (route:0)", "Policy decisions:"],
  },
  { file: "policy-matrix", includes: ["Policy matrix: PASS"] },
  { file: "policy-ci-check", includes: ["Policy requirements: PASS", "Policy matrix: PASS"] },
  { file: "tenant-tasks-check", includes: ["Policy requirements: PASS", "Policy matrix: PASS"] },
  { file: "typed-schema", includes: ["200 { quantity: 3, id: 42, page: 2, userHeaderLength: 5 }"] },
  {
    file: "execution-order",
    includes: ["=== A request that completes (200) ===", "hook afterPipeline"],
  },
  { file: "contracts", includes: ["=== A valid request ===", "config: missingPlugin"] },
  {
    file: "observability",
    includes: ["=== success ===", '"responseCompletedAtRuntimeEnd": false'],
  },
  {
    file: "otel-local",
    includes: ["orvaxis.pipeline", "PolicyDeniedError: Policy denied: tenant"],
  },
  { file: "custom-plugin", includes: ["request.duration_ms=<ms>", "request.error.get=1"] },
  { file: "openapi-export", includes: ['"openapi": "3.1.0"', '"/api/items/{id}"'] },
]

describe("finite examples print what the catalog says", () => {
  it.each(finite.map((example) => [example.file, example] as const))("%s", (file, example) => {
    const result = spawnSync(process.execPath, [...tsx, `examples/${file}.ts`], {
      encoding: "utf8",
      timeout: 20_000,
    })
    expect(result.status, result.stderr).toBe(0)
    for (const text of example.includes) expect(result.stdout, file).toContain(text)
  })
})

describe("the catalog", () => {
  const files = readdirSync("examples")
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => name.replace(/\.ts$/, ""))
  // Support modules, not examples a reader runs.
  const internal = new Set(["policy-diagnostics-types", "tenant-tasks"])

  it("lists every runnable example", () => {
    const missing = files.filter(
      (file) => !internal.has(file) && !catalog.includes(`examples/${file}.ts`)
    )
    expect(missing).toEqual([])
  })

  it("states the port of every server example", () => {
    for (const { file } of servers) {
      const port = /listen\(\s*(?:Number\(process\.env\.PORT \?\? )?(\d+)/.exec(
        readFileSync(`examples/${file}.ts`, "utf8")
      )?.[1]
      const row = catalog
        .split("\n")
        .find((line) => line.includes(`examples/${file}.ts`) && line.startsWith("|"))
      expect(row, `catalog row for ${file}`).toBeDefined()
      if (port) expect(row, `${file} port`).toContain(`port ${port}`)
    }
  })
})
