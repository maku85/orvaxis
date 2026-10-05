---
layout: home

hero:
  name: Orvaxis
  text: Make authorization decisions visible
  tagline: Keep your Express or Fastify routes, and make policy outcomes inspectable, testable, and easier to debug.
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
    details: Keep your framework and existing handlers while introducing named policies on selected routes.
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
- [Authorization requirements in CI](/articles/authorization-requirements-in-ci)
- [Tenant authorization patterns](/articles/tenant-authorization)
- [Cookbook](/cookbook)
- [Why Orvaxis?](/why-orvaxis)

The documented release is **0.3.1**. The repository contains the [working examples](https://github.com/maku85/orvaxis/tree/main/examples) and [release history](https://github.com/maku85/orvaxis/blob/main/CHANGELOG.md). This site documents the current repository state, including clearly marked changes that may not be in the published package yet; package availability and versioned changes are listed on [npm](https://www.npmjs.com/package/orvaxis).
