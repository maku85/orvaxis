---
layout: home

hero:
  name: Orvaxis
  text: Structured, observable, testable Node.js APIs
  tagline: An execution runtime that gives every request one explicit flow — routing, policies, middleware, typed contracts, tracing and tests. Express and Fastify provide the HTTP transport.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Diagnose a 403
      link: /guide/diagnose-403
    - theme: alt
      text: Add to an existing Express route
      link: /guide/integrate-existing-route

features:
  - title: Lifecycle and routing
    details: Declare route groups, parameters and wildcards, and compose global, group and route middleware with lifecycle hooks in one documented order.
    link: /reference/lifecycle
    linkText: Request lifecycle
  - title: Policies
    details: Apply named rules by scope, priority and phase — permissions, feature gates or any request condition — and keep every decision on record.
    link: /reference/core-concepts#policies
    linkText: Policies
  - title: Typed contracts and OpenAPI
    details: Parse body, params, query and headers, infer handler types from the parsed values, validate responses by status and generate OpenAPI 3.1.
    link: /reference/core-concepts#typed-context
    linkText: Typed schemas and contracts
  - title: Observability
    details: Follow each request through traces, debug timelines, structured logs and OpenTelemetry spans, and see why a request was blocked.
    link: /reference/core-concepts#tracing-system
    linkText: Tracing and debugging
  - title: Testing and CI
    details: Run the full lifecycle without a server, test permission matrices, and check required policies and protection changes before deploying.
    link: /guide/testing
    linkText: Testing guide
  - title: Streaming and request handling
    details: Stream server-sent events and files, propagate request IDs, and handle timeouts, cancellation and graceful shutdown on both adapters.
    link: /guide/streaming
    linkText: Streaming and adapters
---

<HomeBanner />

## What Orvaxis does

Orvaxis is a framework-agnostic execution runtime for Node.js APIs. It coordinates routing, policies, middleware, validation, lifecycle hooks and handlers in an explicit request flow, and records what ran. The package has no mandatory runtime dependencies and requires Node.js 22.13 or later.

Express and Fastify are the transport: they accept the connection and hand the request to Orvaxis, which owns routing and execution within the API it serves. Use it to organize how requests run, enforce input and response contracts, observe execution, and test behavior without starting a server. Authorization is one use among several; when a request is rejected, the recorded policy decisions say which policy stopped it and which stages never ran.

## Choose how to adopt it

| | Full runtime | Incremental Express guard |
|---|---|---|
| What it is | Declare routes and handlers in Orvaxis and serve them through an Express or Fastify adapter | Add a policy guard in front of a route whose handler stays in Express |
| Runs | The whole lifecycle: policies, middleware, validation, handler, hooks, tracing | Pre-validation policies only, then Express continues to its own handler |
| Choose it when | You are building a new API, or want contracts, tracing and the lifecycle for it | You want authorization on selected existing routes without moving them |
| Start here | [Get started](/guide/getting-started) | [Integrate an existing route](/guide/integrate-existing-route) |

Install the core and the adapter you use:

```bash
npm install orvaxis express
# or: npm install orvaxis fastify
```

## Find out why a request was blocked

If a request is rejected, start with [Diagnose a 403](/guide/diagnose-403), or [explore recorded traces](/demo/policy-traces) for a denial, a policy error, a validation failure, a handler error and a truncated trace. To understand the execution order, see [core concepts](/reference/core-concepts) and the [lifecycle reference](/reference/lifecycle).

## Examples and guides

- [Examples catalog](/examples/) — runnable sources, commands and expected output
- [Multi-tenant authorization demo](/guide/multi-tenant-demo)
- [Authorization requirements in CI](/articles/authorization-requirements-in-ci)
- [Tenant authorization patterns](/articles/tenant-authorization)
- [Cookbook](/cookbook)
- [Why Orvaxis?](/why-orvaxis)

This site documents the current repository. The package version at the time of this build is **{{ $frontmatter.packageVersion }}**. Documentation may update before the next npm release; compare the [changelog](https://github.com/maku85/orvaxis/blob/main/CHANGELOG.md) with [npm](https://www.npmjs.com/package/orvaxis) when checking package availability.
