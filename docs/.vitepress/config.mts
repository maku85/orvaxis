import { defineConfig } from "vitepress"
import type { HeadConfig } from "vitepress"
import { description, version } from "../../package.json"

const base = "/orvaxis/"
const site = `https://maku85.github.io${base}`
const socialImage = `${site}social-card.jpg`

export default defineConfig({
  title: "Orvaxis",
  // One description for npm, the site and link previews.
  description,
  lang: "en-US",
  base,
  srcExclude: ["roadmap.md"],
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}favicon.svg` }],
    ["meta", { name: "theme-color", content: "#080d1d" }],
  ],
  sitemap: { hostname: site },
  transformHead({ pageData }) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, ".html")
    const url = `${site}${path}`
    const title = pageData.title && pageData.title !== "Orvaxis" ? `${pageData.title} | Orvaxis` : "Orvaxis"
    const summary = (pageData.frontmatter.description as string | undefined) ?? description
    const tags: HeadConfig[] = [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:type", content: "website" }],
      ["meta", { property: "og:site_name", content: "Orvaxis" }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: summary }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:image", content: socialImage }],
      ["meta", { property: "og:image:width", content: "1200" }],
      ["meta", { property: "og:image:height", content: "630" }],
      [
        "meta",
        {
          property: "og:image:alt",
          content: "Orvaxis: structured execution for Node.js APIs — control, contracts, observe and test",
        },
      ],
      ["meta", { name: "twitter:card", content: "summary_large_image" }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: summary }],
      ["meta", { name: "twitter:image", content: socialImage }],
    ]
    return tags
  },
  transformPageData(pageData) {
    pageData.frontmatter.packageVersion = version
  },
  themeConfig: {
    siteTitle: "Orvaxis",
    logo: "/orvaxis-mark.svg",
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Trace demo", link: "/demo/policy-traces" },
      { text: "Examples", link: "/examples/" },
      { text: "Reference", link: "/reference/core-concepts" },
      {
        text: "Migration",
        items: [
          { text: "0.3.1 → 0.4.0", link: "/migration/0.3.1-to-0.4.0" },
          { text: "Unreleased changes", link: "/migration/next" },
        ],
      },
      {
        text: "Resources",
        items: [
          { text: "Cookbook", link: "/cookbook" },
          { text: "Benchmarks", link: "/benchmarks" },
          { text: "Changelog", link: "https://github.com/maku85/orvaxis/blob/main/CHANGELOG.md" },
          { text: "Report an issue", link: "https://github.com/maku85/orvaxis/issues/new/choose" },
          { text: "Repository", link: "https://github.com/maku85/orvaxis" },
        ],
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Getting started",
          items: [
            { text: "Get started", link: "/guide/getting-started" },
            { text: "Integrate an existing route", link: "/guide/integrate-existing-route" },
            { text: "Diagnose a 403", link: "/guide/diagnose-403" },
            { text: "Multi-tenant demo", link: "/guide/multi-tenant-demo" },
          ],
        },
        {
          text: "HTTP and testing",
          items: [
            { text: "HTTP adapters", link: "/guide/http-adapters" },
            { text: "Timeouts and shutdown", link: "/guide/timeouts-and-shutdown" },
            { text: "Streaming", link: "/guide/streaming" },
            { text: "Testing", link: "/guide/testing" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Core concepts", link: "/reference/core-concepts" },
            { text: "Request lifecycle", link: "/reference/lifecycle" },
          ],
        },
      ],
      "/migration/": [
        {
          text: "Migration",
          items: [
            { text: "0.3.1 → 0.4.0", link: "/migration/0.3.1-to-0.4.0" },
            { text: "Unreleased changes", link: "/migration/next" },
          ],
        },
      ],
      "/demo/": [
        {
          text: "Interactive demo",
          items: [{ text: "Policy traces", link: "/demo/policy-traces" }],
        },
      ],
      "/articles/": [
        {
          text: "Articles",
          items: [
            { text: "Diagnosing a 403", link: "/articles/diagnosing-a-403" },
            { text: "Tenant authorization", link: "/articles/tenant-authorization" },
            { text: "Authorization checks in CI", link: "/articles/authorization-requirements-in-ci" },
          ],
        },
      ],
    },
    search: { provider: "local" },
    editLink: {
      pattern: "https://github.com/maku85/orvaxis/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/maku85/orvaxis" }],
    footer: {
      message: 'Released under the <a href="https://github.com/maku85/orvaxis/blob/main/LICENSE">MIT License</a>.',
      copyright: "Copyright © 2026 Orvaxis contributors",
    },
  },
})
