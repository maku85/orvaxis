# Orvaxis

**Orvaxis** is a lightweight, policy-driven execution runtime for Node.js applications.

It is not a framework in the traditional sense.
It is an **execution orchestration layer** designed to control, observe, and structure backend request flows in a predictable and composable way.

---

## Why Orvaxis

Modern backend frameworks tend to fall into one of two extremes:

- **Minimal frameworks (Express/Fastify)** → flexible but unstructured at scale
- **Opinionated frameworks (NestJS)** → structured but heavy and tightly coupled

Orvaxis explores a different approach:

> A **runtime execution engine** that separates concerns into explicit layers:
- control (policies)
- flow (middleware)
- lifecycle (hooks)
- composition (plugins)
- observability (tracing & debugging)
- structure (routing & grouping)

The goal is not to replace existing frameworks, but to provide a **lower-level orchestration layer** that makes backend execution predictable and inspectable.

---

## Core Principles

### 1. Execution is explicit
Every request passes through a clearly defined lifecycle:
- policies (decision layer)
- hooks (event layer)
- middleware (flow layer)
- route handler (business logic)

---

### 2. Control is declarative
Policies define *what is allowed*, independently from implementation logic.

---

### 3. Structure is hierarchical
Routes are organized in groups with inheritance:
- shared middleware
- shared policies
- scoped execution context

---

### 4. Observability is built-in
Every request produces a trace:
- execution timeline
- performance metrics
- lifecycle events
- debug summary

---

### 5. Extensibility via plugins
System capabilities are extended through plugins that attach to lifecycle hooks.

---

## Architecture Overview
```
Request
↓
Policy Engine (global → group → route)
↓
onRequest hook
↓
beforePipeline hook
↓
Global Pipeline (app.use() middleware)
↓
Group Middleware (inherited)
↓
Route Middleware (scoped)
↓
Route Handler
↓
Trace finalization
↓
afterPipeline hook
↓
Debug output (if enabled)
```

---

## Core Concepts

### Runtime
The central execution engine responsible for orchestrating the full request lifecycle.

### Router
Handles route resolution and grouping:
- method + path matching
- group-based inheritance
- route metadata resolution

### Groups
Logical grouping of routes:
- shared middleware
- shared policies
- prefix-based organization

Example:
```ts
app.group({
  prefix: "/api",
  middleware: [traceMiddleware()],
  policies: [rateLimitPolicy],
  routes: [...]
})
```

---

### Middleware

Functions that participate in execution flow and can:

- mutate context
- control execution flow
- enrich request state

---

### Policies

Pre-execution rules that determine whether a request is allowed.

- can block execution
- can modify context metadata
- can be scoped (route/group/global)
- can be prioritized

Example:
```ts
export const requireApiKey: Policy = {
  name: "require-api-key",
  priority: 100,
  async evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"]
    if (!key) return { allow: false, reason: "Missing X-API-Key header" }
    return { allow: true, modify: { apiKey: key } }
  }
}
```

---

### Hooks

Lifecycle events that allow observation of execution:

- `onRequest` — fired after policy evaluation, before middleware
- `beforePipeline` — fired before the global pipeline runs
- `afterPipeline` — fired after the route handler, trace already finalized
- `onError` — fired on any unhandled error

Hooks do not modify flow; they observe and react.

---

### Plugins

Plugins extend runtime capabilities by registering hooks, middleware, or policies.

Example:
```ts
export const loggerPlugin = {
  name: "logger",
  apply(runtime: Runtime) {
    runtime.hooks.on("onRequest", (ctx) => {
      console.log("[REQ]", ctx.req.url)
    })
  }
}
```

Register via:
```ts
app.register(loggerPlugin)
```

---

### Tracing System

Each request generates a structured execution trace:

- timestamps per event
- lifecycle steps
- middleware execution timing
- error tracking

The trace is finalized before `afterPipeline` fires and is available as `ctx.meta.trace`.

---

### Debug Layer

When enabled, Orvaxis produces a structured debug timeline:

- grouped execution steps
- performance metrics
- route + group metadata
- error traces

Enable via:
```ts
app.debugger.enable()
```

---

### Execution Model

A request lifecycle is deterministic:

```
1  Policy evaluation     global → group → route, sorted by priority
2  onRequest hook
3  beforePipeline hook
4  Global pipeline       middleware registered via app.use()
5  Group middleware
6  Route middleware
7  Route handler
8  Trace finalization    ctx.meta.trace is set
9  afterPipeline hook
10 Debug output          if app.debugger.enable() was called
```

---

## HTTP Adapters

Orvaxis is not tied to any specific HTTP framework. The core runtime is framework-agnostic — adapters are thin wrappers that normalize the incoming request and delegate to the runtime.

Two adapters are included out of the box:

| Adapter | Import | Peer dependency |
|---|---|---|
| Express | `createExpressServer` | `express ^4` |
| Fastify | `createFastifyServer` | `fastify ^5` |

Install only the framework you intend to use — both peer dependencies are optional.

### Writing a custom adapter

Any adapter needs to:
1. Ensure `req.path` is a plain path string (no query string)
2. Call `app.handle(req, res)` and catch thrown errors
3. Return `{ listen(port) }` to satisfy the `ServerAdapter` interface

---

## Example Usage

### Express
```ts
import { Orvaxis, createExpressServer } from "orvaxis"
import type { Policy } from "orvaxis"

const app = new Orvaxis()

const requireApiKey: Policy = {
  name: "require-api-key",
  priority: 100,
  evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"]
    if (!key) return { allow: false, reason: "Missing X-API-Key header" }
    return { allow: true }
  }
}

app.policy(requireApiKey)

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/users",
      handler: async (ctx) => {
        ctx.res.json({ users: [] })
      }
    }
  ]
})

const server = createExpressServer(app)
server.listen(3000)
```

### Fastify
```ts
import { Orvaxis, createFastifyServer } from "orvaxis"

const app = new Orvaxis()

app.group({
  prefix: "/api",
  routes: [
    {
      method: "GET",
      path: "/users/:id",
      handler: async (ctx) => {
        ctx.res.send({ id: ctx.meta.route.params.id })
      }
    }
  ]
})

const server = createFastifyServer(app)
server.listen(3000)
```

---

## Project Structure
```
orvaxis/
  index.ts                   entry point, public API

  core/
    Orvaxis.ts               public-facing class
    Runtime.ts               execution engine
    Router.ts                route matching and groups
    Pipeline.ts              global middleware chain
    PolicyEngine.ts          policy evaluation
    Hook.ts                  hook system
    Tracer.ts                per-request trace
    Debugger.ts              debug timeline
    Context.ts               context factory

  debug/
    buildExecutionSummary.ts structured summary from debug data

  http/
    expressAdapter.ts        Express adapter
    fastifyAdapter.ts        Fastify adapter

  middleware/
    traceMiddleware.ts       trace events around middleware execution

  plugins/
    PluginManager.ts         plugin registry
    loggerPlugin.ts          built-in logger plugin

  types/
    index.ts                 all shared types

  examples/
    express-server.ts        minimal Express setup
    policy-server.ts         global and route-level policies
    hooks-and-plugins.ts     lifecycle hooks and plugin registration
    debug-trace.ts           debugger and trace output
    fastify-server.ts        Fastify adapter with policies and param routing
```

---

## Design Philosophy

Orvaxis is built around a few key ideas:

- __Separation of concerns at runtime level__
- __Declarative control of execution__
- __Transparent request lifecycle__
- __Composable system primitives instead of monolithic abstractions__

It favors:

- explicitness over magic
- composition over inheritance
- observability over hidden behavior

---

## Current Status

The core execution model is stable and functional.

Current focus:

- refining plugin/policy separation
- improving trace and debug ergonomics

Not production-ready.

---

## Future Directions

Potential evolutions include:

- generic typed context (`ctx.state` and `ctx.meta` via generics)
- `AsyncLocalStorage` support for request-scoped context propagation
- async job execution layer
- distributed tracing integration
- visual execution inspector
- advanced plugin lifecycle hooks
- route-level execution graphs

## License

MIT
