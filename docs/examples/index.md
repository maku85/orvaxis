# Examples

The examples are executable repository sources. They are not copied into this page, so the commands and implementation can be reviewed together.

| Goal | Guide or source | Run/check |
|---|---|---|
| Protect a route and inspect a denial | [Quickstart source](https://github.com/maku85/orvaxis/blob/main/examples/quickstart.ts) | `pnpm exec tsx examples/quickstart.ts` |
| Wrap an existing Express route | [Integration guide](/guide/integrate-existing-route) | Run the example command documented in the guide |
| Diagnose a terminal 403 | [403 guide](/guide/diagnose-403) | `pnpm exec tsx examples/policy-diagnostics.ts` |
| Enforce tenant membership and task ownership | [Multi-tenant demo](/guide/multi-tenant-demo) | `pnpm check:tenant-demo`; server: `pnpm exec tsx examples/tenant-tasks-server.ts` |
| Review execution costs | [Benchmarks](/benchmarks) | `pnpm bench:run` |

The Express demo uses in-memory fixtures and demonstration credentials. Do not treat them as production authentication, authorization data, or persistent storage.
