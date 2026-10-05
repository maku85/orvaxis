import { defineConfig } from "vitepress"

export default defineConfig({
  title: "Orvaxis",
  description: "Policy-driven execution and authorization diagnostics for Node.js APIs.",
  lang: "en-US",
  base: "/orvaxis/",
  lastUpdated: true,
  themeConfig: {
    siteTitle: "Orvaxis",
    logo: "/orvaxis-mark.svg",
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Examples", link: "/examples/" },
      { text: "Reference", link: "/reference/core-concepts" },
      {
        text: "Resources",
        items: [
          { text: "Cookbook", link: "/cookbook" },
          { text: "Benchmarks", link: "/benchmarks" },
          { text: "Changelog", link: "https://github.com/maku85/orvaxis/blob/main/CHANGELOG.md" },
          { text: "Roadmap", link: "https://github.com/maku85/orvaxis/blob/main/docs/roadmap.md" },
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
