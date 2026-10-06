import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { extractRegions, findSnippets, rewriteImports } from "../scripts/lib/snippets.mjs"

describe("documentation snippets", () => {
  it("finds a marked fenced block and ignores unmarked ones", () => {
    const markdown = [
      "```ts",
      "unmarked",
      "```",
      "<!-- snippet: a.ts#x -->",
      "```ts",
      "one",
      "two",
      "```",
    ].join("\n")
    expect(findSnippets(markdown)).toEqual([{ reference: "a.ts#x", line: 4, code: "one\ntwo" }])
  })

  it("reports a marker that is not followed by a code block", () => {
    const [found] = findSnippets("<!-- snippet: a.ts -->\n\ntext")
    expect(found.error).toMatch(/fenced code block/)
  })

  it("extracts regions in order, joined by a blank line, and rewrites imports", () => {
    const directory = mkdtempSync(join(tmpdir(), "orvaxis-snippet-test-"))
    try {
      writeFileSync(
        join(directory, "e.ts"),
        [
          "// #region a",
          'import { x } from "../index"',
          "// #endregion",
          "ignored",
          "// #region b",
          "const y = 1",
          "// #endregion",
        ].join("\n")
      )
      expect(extractRegions(directory, "e.ts#a,b")).toBe(
        'import { x } from "orvaxis"\n\nconst y = 1'
      )
      expect(() => extractRegions(directory, "e.ts#missing")).toThrow(/no region 'missing'/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("rewrites only import specifiers of the published entry points", () => {
    expect(rewriteImports('import a from "../express"\nconst s = "../index"')).toBe(
      'import a from "orvaxis/express"\nconst s = "../index"'
    )
  })

  it("every marked block in the repository matches its example", () => {
    const result = spawnSync(process.execPath, [resolve("scripts/check-snippets.mjs")], {
      encoding: "utf8",
    })
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/block\(s\) match/)
  })

  it("fails and names the line when a documented block drifts from its example", () => {
    const directory = mkdtempSync(join(tmpdir(), "orvaxis-snippet-drift-"))
    try {
      writeFileSync(join(directory, "example.ts"), "// #region r\nconst a = 1\n// #endregion\n")
      const expected = extractRegions(directory, "example.ts#r")
      const doc = findSnippets("<!-- snippet: example.ts#r -->\n```ts\nconst a = 2\n```")[0]
      expect(doc.code).not.toBe(expected)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
