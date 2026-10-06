// Shared by scripts/check-snippets.mjs and scripts/check-quickstart.mjs.
//
// A documentation code block is tied to a runnable example by a marker on the line before it:
//
//   <!-- snippet: examples/quickstart.ts#app,serve -->
//   ```ts
//   ...the exact code of those regions...
//   ```
//
// Regions are delimited in the example by `// #region name` and `// #endregion` comments. Several
// regions are joined with one blank line. Examples import the repository sources, documentation
// imports the published entry points, so relative imports are rewritten before comparing.
import { readFileSync } from "node:fs"
import { join } from "node:path"

export function rewriteImports(source) {
  // Examples import the repository sources by relative path; documentation imports the entry points.
  return source.replace(
    /from "(?:\.\.\/)+(index|testing|express|fastify|openapi|otel)"/g,
    (_match, entry) => (entry === "index" ? 'from "orvaxis"' : `from "orvaxis/${entry}"`)
  )
}

export function extractRegions(root, reference) {
  const [file, regionList] = reference.split("#")
  const text = readFileSync(join(root, file), "utf8")
  if (!regionList) return rewriteImports(text).trimEnd()
  const lines = text.split("\n")
  const chunks = []
  for (const name of regionList.split(",")) {
    const start = lines.findIndex((line) => line.trim() === `// #region ${name}`)
    if (start < 0) throw new Error(`${file} has no region '${name}'`)
    const end = lines.findIndex(
      (line, index) => index > start && line.trim().startsWith("// #endregion")
    )
    if (end < 0) throw new Error(`${file} region '${name}' is not closed with // #endregion`)
    chunks.push(
      dedent(lines.slice(start + 1, end))
        .join("\n")
        .trimEnd()
    )
  }
  return rewriteImports(chunks.join("\n\n"))
}

/** Remove the indentation shared by all non-blank lines, so regions inside functions read naturally. */
function dedent(lines) {
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => /^ */.exec(line)[0].length)
  const shared = indents.length > 0 ? Math.min(...indents) : 0
  return lines.map((line) => line.slice(shared))
}

const MARKER = /^<!--\s*snippet:\s*(\S+)\s*-->\s*$/

/** Return every marker in a Markdown file with the code block that follows it. */
export function findSnippets(markdown) {
  const lines = markdown.split("\n")
  const found = []
  for (let i = 0; i < lines.length; i++) {
    const match = MARKER.exec(lines[i])
    if (!match) continue
    const open = lines[i + 1] ?? ""
    if (!/^```\w*\s*$/.test(open)) {
      found.push({
        reference: match[1],
        line: i + 1,
        error: "the marker must be followed directly by a fenced code block",
      })
      continue
    }
    const close = lines.findIndex((line, index) => index > i + 1 && line.startsWith("```"))
    if (close < 0) {
      found.push({ reference: match[1], line: i + 1, error: "the code block is not closed" })
      continue
    }
    found.push({
      reference: match[1],
      line: i + 1,
      code: lines
        .slice(i + 2, close)
        .join("\n")
        .trimEnd(),
    })
  }
  return found
}
