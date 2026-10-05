import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const directory = mkdtempSync(join(tmpdir(), "orvaxis-package-check-"))
const packageDirectory = join(directory, "node_modules/orvaxis")
const require = createRequire(import.meta.url)
const nodeTypes = require.resolve("@types/node/package.json", {
  paths: [require.resolve("@types/express/package.json")],
})

try {
  mkdirSync(packageDirectory, { recursive: true })
  cpSync(resolve("package.json"), join(packageDirectory, "package.json"))
  cpSync(resolve("dist"), join(packageDirectory, "dist"), { recursive: true })
  const runtimeCheck = `
    const assert = require('node:assert/strict');
    (async () => {
      for (const name of ['orvaxis', 'orvaxis/testing', 'orvaxis/openapi']) {
        assert.ok(Object.keys(require(name)).length);
        assert.ok(Object.keys(await import(name)).length);
      }
      const { Orvaxis } = await import('orvaxis');
      const { testRequest } = await import('orvaxis/testing');
      const { generateOpenApiDocument } = await import('orvaxis/openapi');
      const app = new Orvaxis();
      app.group({ prefix: '/api', routes: [{
        method: 'GET', path: '/items/:id', handler: ctx => ctx.res.json({ id: ctx.params.id })
      }] });
      const response = await testRequest(app, { path: '/api/items/42' });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { id: '42' });
      const document = generateOpenApiDocument(app, { title: 'Check', version: '1' });
      assert.ok(document.paths['/api/items/{id}']);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `
  const runtimeResult = spawnSync(process.execPath, ["-e", runtimeCheck], {
    cwd: directory,
    encoding: "utf8",
  })
  assert.equal(runtimeResult.status, 0, runtimeResult.stderr || runtimeResult.error?.message)

  const typeCheck = `
    import { Orvaxis, defineRoute, schemaValidationPlugin } from 'orvaxis';
    import { testRequest } from 'orvaxis/testing';
    import { generateOpenApiDocument } from 'orvaxis/openapi';
    const app = new Orvaxis();
    app.register(schemaValidationPlugin);
    app.group({ prefix: '/api', routes: [defineRoute({
      method: 'GET', path: '/items/:id',
      schema: { params: { parse: (_value: unknown) => ({ id: 42 }) } },
      handler: ctx => {
        const id: number = ctx.params.id;
        // @ts-expect-error The parsed parameter is a number, not a string.
        const invalid: string = ctx.params.id;
        ctx.res.json({ id });
      }
    })] });
    testRequest(app, { path: '/api/items/42' });
    generateOpenApiDocument(app, { title: 'Check', version: '1' });
  `
  writeFileSync(join(directory, "consumer.mts"), typeCheck)
  writeFileSync(join(directory, "consumer.cts"), typeCheck)
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        types: ["node"],
        typeRoots: [dirname(dirname(nodeTypes))],
      },
      include: ["consumer.mts", "consumer.cts"],
    })
  )
  const typeResult = spawnSync(
    process.execPath,
    [resolve("node_modules/typescript/bin/tsc"), "-p", join(directory, "tsconfig.json")],
    { encoding: "utf8" }
  )
  assert.equal(
    typeResult.status,
    0,
    typeResult.stdout || typeResult.stderr || typeResult.error?.message
  )
  console.log(
    "Package check passed: CJS/ESM imports, runtime execution, and NodeNext declarations without optional peers."
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
}
