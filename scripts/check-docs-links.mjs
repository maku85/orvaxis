// Verifies that every internal link with a #fragment in the built site points at an element that
// exists. VitePress validates page links during the build but not fragments, so a renamed heading
// would otherwise break navigation entries such as /reference/core-concepts#router silently.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const base = "/orvaxis/"
const dist = resolve("docs/.vitepress/dist")
if (!existsSync(dist)) {
  console.error("docs/.vitepress/dist is missing; run `pnpm docs:build` first")
  process.exit(1)
}

function htmlFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return htmlFiles(path)
    return name.endsWith(".html") ? [path] : []
  })
}

const idsCache = new Map()
function idsOf(file) {
  if (!idsCache.has(file)) {
    const html = readFileSync(file, "utf8")
    idsCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])))
  }
  return idsCache.get(file)
}

const problems = []
let checked = 0
for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, "utf8")
  const label = file.slice(dist.length + 1)
  for (const [, href] of html.matchAll(/<a\b[^>]*?\shref="([^"]+)"/g)) {
    if (!href.includes("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue
    const [path, fragment] = href.split("#")
    if (!fragment) continue
    const target =
      path === ""
        ? file
        : path.startsWith("/")
          ? join(dist, path.slice(base.length))
          : join(file, "..", path)
    const page =
      existsSync(target) && statSync(target).isDirectory() ? join(target, "index.html") : target
    checked++
    if (!existsSync(page)) problems.push(`${label}: ${href} — the page does not exist`)
    else if (!idsOf(page).has(decodeURIComponent(fragment)))
      problems.push(`${label}: ${href} — no element with id '${fragment}'`)
  }
}

if (problems.length > 0) {
  console.error(`Broken fragment links:\n${[...new Set(problems)].join("\n")}`)
  process.exit(1)
}
console.log(`Docs links OK: ${checked} fragment link(s) resolve to an existing element.`)
