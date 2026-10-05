---
layout: home

hero:
  name: Orvaxis
  text: Make authorization decisions visible
  tagline: Make policy outcomes inspectable, testable, and easier to debug in Express and Fastify APIs.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Diagnose a 403
      link: /guide/diagnose-403

features:
  - title: Explain denied requests
    details: See which policy made the terminal decision and whether the handler ran.
  - title: Add authorization incrementally
    details: Keep existing Express handlers while introducing named policies on selected routes.
  - title: Test declared permissions
    details: Inspect route configuration and check that required policies are attached before deployment.
---

## Start with your existing app

Orvaxis is an optional execution layer for Node.js APIs. It works with Express and Fastify and does not replace either framework. The package requires Node.js 22.13 or later.

Install the core and the adapter you use:

```bash
npm install orvaxis express
# or: npm install orvaxis fastify
```

For an existing Express handler, add a named policy guard around that route and keep the route implementation in Express. Follow the [incremental integration guide](/guide/integrate-existing-route) for the adapter APIs and a complete example.

If a request is rejected, start with [Diagnose a 403](/guide/diagnose-403). To understand the execution order, see [core concepts](/reference/core-concepts) and the [lifecycle reference](/reference/lifecycle).

## Examples and guides

- [Multi-tenant authorization demo](/guide/multi-tenant-demo)
- [Explore recorded policy traces](/demo/policy-traces)
- [Authorization requirements in CI](/articles/authorization-requirements-in-ci)
- [Tenant authorization patterns](/articles/tenant-authorization)
- [Cookbook](/cookbook)
- [Why Orvaxis?](/why-orvaxis)

This site documents the **current repository, including unreleased changes**. The repository package version is **{{ $frontmatter.packageVersion }}**. The policy guard, decision diagnostics, policy matrices, schema inference, and OpenAPI updates were added after 0.3.1. Until those changes appear in a published release, use the [working examples](https://github.com/maku85/orvaxis/tree/main/examples) from a checkout. Compare the [release history](https://github.com/maku85/orvaxis/blob/main/CHANGELOG.md) with [npm](https://www.npmjs.com/package/orvaxis) for package availability.
