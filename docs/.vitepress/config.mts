import { defineConfig } from "vitepress"
import type { HeadConfig } from "vitepress"
import { description, version } from "../../package.json"

const base = "/orvaxis/"
const site = `https://maku85.github.io${base}`
const socialImage = `${site}social-card.jpg`


const docsSidebar = [
  {
    text: "Start",
    items: [
      { text: "Get started", link: "/guide/getting-started" },
      { text: "Integrate an existing route", link: "/guide/integrate-existing-route" },
      { text: "Diagnose a 403", link: "/guide/diagnose-403" },
      { text: "Why Orvaxis", link: "/why-orvaxis" },
    ],
  },
  {
    text: "Execution",
    items: [
      { text: "Request lifecycle", link: "/reference/lifecycle" },
      { text: "Routing and groups", link: "/reference/core-concepts#router" },
      { text: "Middleware and hooks", link: "/reference/core-concepts#middleware" },
      { text: "Policies", link: "/reference/core-concepts#policies" },
    ],
  },
  {
    text: "Contracts",
    items: [
      { text: "Typed schemas", link: "/reference/core-concepts#typed-context" },
      { text: "Response contracts and OpenAPI", link: "/reference/core-concepts#response-contracts-and-openapi" },
    ],
  },
  {
    text: "Observability",
    items: [
      { text: "Tracing", link: "/reference/core-concepts#tracing-system" },
      { text: "Debug layer", link: "/reference/core-concepts#debug-layer" },
      { text: "Request context", link: "/reference/core-concepts#request-scoped-context" },
      { text: "Plugins and OpenTelemetry", link: "/reference/core-concepts#plugins" },
      { text: "Trace demo", link: "/demo/policy-traces" },
    ],
  },
  {
    text: "HTTP",
    items: [
      { text: "HTTP adapters", link: "/guide/http-adapters" },
      { text: "Timeouts and shutdown", link: "/guide/timeouts-and-shutdown" },
      { text: "Streaming", link: "/guide/streaming" },
    ],
  },
  {
    text: "Test and CI",
    items: [
      { text: "Testing", link: "/guide/testing" },
      { text: "Multi-tenant demo", link: "/guide/multi-tenant-demo" },
      { text: "Authorization checks in CI", link: "/articles/authorization-requirements-in-ci" },
    ],
  },
  {
    text: "Reference and examples",
    items: [
      { text: "Core concepts", link: "/reference/core-concepts" },
      { text: "Examples catalog", link: "/examples/" },
      { text: "Cookbook", link: "/cookbook" },
      { text: "Benchmarks", link: "/benchmarks" },
    ],
  },
  {
    text: "Articles",
    items: [
      { text: "Diagnosing a 403", link: "/articles/diagnosing-a-403" },
      { text: "Tenant authorization", link: "/articles/tenant-authorization" },
    ],
  },
]

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
      { text: "Start", link: "/guide/getting-started", activeMatch: "^/guide/(getting-started|integrate|diagnose)" },
      {
        text: "Execution",
        items: [
          { text: "Request lifecycle", link: "/reference/lifecycle" },
          { text: "Routing and groups", link: "/reference/core-concepts#router" },
          { text: "Middleware and hooks", link: "/reference/core-concepts#middleware" },
          { text: "Policies", link: "/reference/core-concepts#policies" },
        ],
      },
      {
        text: "Contracts",
        items: [
          { text: "Typed schemas", link: "/reference/core-concepts#typed-context" },
          { text: "Response contracts and OpenAPI", link: "/reference/core-concepts#response-contracts-and-openapi" },
        ],
      },
      {
        text: "Observability",
        items: [
          { text: "Tracing", link: "/reference/core-concepts#tracing-system" },
          { text: "Debug layer", link: "/reference/core-concepts#debug-layer" },
          { text: "Request context", link: "/reference/core-concepts#request-scoped-context" },
          { text: "Plugins and OpenTelemetry", link: "/reference/core-concepts#plugins" },
          { text: "Trace demo", link: "/demo/policy-traces" },
        ],
      },
      {
        text: "HTTP",
        items: [
          { text: "HTTP adapters", link: "/guide/http-adapters" },
          { text: "Timeouts and shutdown", link: "/guide/timeouts-and-shutdown" },
          { text: "Streaming", link: "/guide/streaming" },
        ],
      },
      {
        text: "Test",
        items: [
          { text: "Testing", link: "/guide/testing" },
          { text: "Multi-tenant demo", link: "/guide/multi-tenant-demo" },
          { text: "Authorization checks in CI", link: "/articles/authorization-requirements-in-ci" },
        ],
      },
      { text: "Reference", link: "/reference/core-concepts", activeMatch: "^/(reference|examples)/" },
      {
        text: "More",
        items: [
          { text: "Migration 0.3.1 → 0.4.0", link: "/migration/0.3.1-to-0.4.0" },
          { text: "Unreleased changes", link: "/migration/next" },
          { text: "Cookbook", link: "/cookbook" },
          { text: "Benchmarks", link: "/benchmarks" },
          { text: "Changelog", link: "https://github.com/maku85/orvaxis/blob/main/CHANGELOG.md" },
          { text: "Report an issue", link: "https://github.com/maku85/orvaxis/issues/new/choose" },
          { text: "Repository", link: "https://github.com/maku85/orvaxis" },
        ],
      },
    ],
    // One sidebar for the whole documentation, grouped by what you want to do. Several entries
    // point into the core concepts reference until each topic has its own page.
    sidebar: {
      "/guide/": docsSidebar,
      "/reference/": docsSidebar,
      "/demo/": docsSidebar,
      "/articles/": docsSidebar,
      "/examples/": docsSidebar,
      "/cookbook": docsSidebar,
      "/why-orvaxis": docsSidebar,
      "/benchmarks": docsSidebar,
      "/migration/": [
        {
          text: "Migration",
          items: [
            { text: "0.3.1 → 0.4.0", link: "/migration/0.3.1-to-0.4.0" },
            { text: "Unreleased changes", link: "/migration/next" },
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
