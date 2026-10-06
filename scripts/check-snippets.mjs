// Fails when a documentation code block marked with `<!-- snippet: path#regions -->` differs from
// the runnable example it claims to show. Examples are type-checked and exercised by the test
// suite, so a snippet that matches them cannot silently drift.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { extractRegions, findSnippets } from "./lib/snippets.mjs"

const root = resolve(".")
const IGNORED = new Set(["node_modules", ".vitepress", "roadmap.md", "dist"])

function markdownFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (IGNORED.has(name)) return []
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return markdownFiles(path)
    return name.endsWith(".md") ? [path] : []
  })
}

const problems = []
let checked = 0
for (const file of [join(root, "README.md"), ...markdownFiles(join(root, "docs"))]) {
  for (const snippet of findSnippets(readFileSync(file, "utf8"))) {
    const where = `${relative(root, file)}:${snippet.line}`
    if (snippet.error) {
      problems.push(`${where}: ${snippet.error}`)
      continue
    }
    checked++
    let expected
    try {
      expected = extractRegions(root, snippet.reference)
    } catch (error) {
      problems.push(`${where}: ${error.message}`)
      continue
    }
    if (expected !== snippet.code) {
      const a = expected.split("\n")
      const b = snippet.code.split("\n")
      const index = a.findIndex((line, i) => line !== b[i])
      const at = index < 0 ? Math.min(a.length, b.length) : index
      problems.push(
        `${where}: differs from ${snippet.reference} at snippet line ${at + 1}\n    example: ${a[at] ?? "<end>"}\n    document: ${b[at] ?? "<end>"}`
      )
    }
  }
}

if (problems.length > 0) {
  console.error(`Documentation snippets out of sync with their examples:\n${problems.join("\n")}`)
  process.exit(1)
}
console.log(`Documentation snippets OK: ${checked} block(s) match their examples.`)
