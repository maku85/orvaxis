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

// Link-preview metadata must use absolute public URLs that exist in the build output, and the
// description must be the package description (one product description everywhere).
const site = `https://maku85.github.io${base}`
const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"))
const metaPattern = /<meta\s+(?:property|name)="((?:og|twitter):[a-z:]+)"\s+content="([^"]*)"/g
const metaChecked = new Set()
for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, "utf8")
  const label = file.slice(dist.length + 1)
  const found = new Map([...html.matchAll(metaPattern)].map((match) => [match[1], match[2]]))
  if (!found.has("og:image")) {
    if (!label.startsWith("404")) problems.push(`${label}: no og:image`)
    continue
  }
  for (const key of ["og:image", "twitter:image", "og:url"]) {
    const value = found.get(key)
    if (!value?.startsWith(site))
      problems.push(`${label}: ${key} is not an absolute URL under ${site}: ${value}`)
  }
  const image = found.get("og:image") ?? ""
  if (image.startsWith(site) && !metaChecked.has(image)) {
    metaChecked.add(image)
    if (!existsSync(join(dist, image.slice(site.length))))
      problems.push(`${label}: og:image ${image} does not exist in the build output`)
  }
  if (found.get("og:description") !== pkg.description && !label.includes("/")) {
    // Pages with their own frontmatter description may differ; top-level pages must not.
    if (label === "index.html")
      problems.push(`${label}: og:description differs from the package description`)
  }
}
if (!existsSync(join(dist, "sitemap.xml"))) problems.push("sitemap.xml was not generated")

assert.equal(problems.length, 0, `Asset reference problems:\n${problems.join("\n")}`)
console.log(`Docs assets OK: ${checked.size} unique files referenced under ${base}`)
