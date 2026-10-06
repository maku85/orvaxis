import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const base = "/orvaxis/"
const dist = resolve("docs/.vitepress/dist")
assert.ok(existsSync(dist), "docs/.vitepress/dist is missing; run `pnpm docs:build` first")

function htmlFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return htmlFiles(path)
    return name.endsWith(".html") ? [path] : []
  })
}

const assetPattern = /<(?:link|script|img|source)\b[^>]*?\b(?:href|src)="([^"]+)"/g
const problems = []
const checked = new Set()

for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, "utf8")
  for (const [, url] of html.matchAll(assetPattern)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(url)) continue
    const label = `${file.slice(dist.length + 1)}: ${url}`
    if (url.startsWith("/") && !url.startsWith(base)) {
      problems.push(`${label} is outside ${base}`)
      continue
    }
    if (!url.startsWith("/")) continue
    const target = join(dist, url.slice(base.length).split(/[?#]/)[0])
    if (checked.has(target)) continue
    checked.add(target)
    if (!existsSync(target)) problems.push(`${label} does not exist in the build output`)
  }
}

assert.equal(problems.length, 0, `Asset reference problems:\n${problems.join("\n")}`)
console.log(`Docs assets OK: ${checked.size} unique files referenced under ${base}`)
