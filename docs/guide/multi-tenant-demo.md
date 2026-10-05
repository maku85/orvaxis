# Multi-tenant task demo

This runnable Express API demonstrates fixture API-key authentication, tenant isolation, task ownership, and role-based access. The route, permission matrix, trace output, and static CI requirements all use the same policy and fixture data.

## Run it

From a repository checkout with the documented [Node.js and pnpm prerequisites](https://github.com/maku85/orvaxis/blob/main/CONTRIBUTING.md#prerequisites), install dependencies and start the server:

```bash
pnpm install
pnpm exec tsx examples/tenant-tasks-server.ts
```

The demo listens on port `3002`; set `PORT` to choose another port. In another terminal, try the same task as its owner, another member in the tenant, a member from a different tenant, and an administrator:

```bash
curl -i -H 'x-api-key: key-alice' http://localhost:3002/api/tenants/acme/tasks/task-1
curl -i -H 'x-api-key: key-bob' http://localhost:3002/api/tenants/acme/tasks/task-1
curl -i -H 'x-api-key: key-maya' http://localhost:3002/api/tenants/acme/tasks/task-1
curl -i -H 'x-api-key: key-admin' http://localhost:3002/api/tenants/globex/tasks/task-3
curl -i -H 'x-api-key: key-alice' http://localhost:3002/api/tenants/acme/admin/overview
```

Expected outcomes are `200`, `403`, `403`, `200`, and `403`. An unknown or missing key returns `401`. The admin can cross tenant boundaries and read the admin overview; a member can only read their own task within their tenant.

## Demo identities and data

| API key | Identity | Tenant | Role |
|---|---|---|---|
| `key-alice` | alice | acme | member |
| `key-bob` | bob | acme | member |
| `key-maya` | maya | globex | member |
| `key-admin` | root | acme | admin |

Tasks are fixed fixtures in `examples/tenant-tasks.ts`: `task-1` belongs to alice in acme, `task-2` to bob in acme, and `task-3` to maya in globex. The data lives in an in-memory array, has no persistence, and resets whenever the process restarts. The API keys and identities are demonstrations only; this fixture lookup is not a production authentication system and must not receive real credentials or user data.

## Inspect decisions and verify permissions

Run the same static policy requirements and dynamic permission scenarios that CI checks:

```bash
pnpm check:tenant-demo
```

The command prints required policies for each protected route, a seven-case permission matrix, and traces for same-tenant ownership denial and cross-tenant denial. A trace names the terminal policy and lists the stages that did not run. The matrix asserts status, terminal policy, and whether the handler executed.

To add a permission case, append a scenario to `tenantTaskScenarios` in `examples/tenant-tasks.ts`. For a new protected route, add a `checkPolicyRequirements` selector and its required policies to `examples/tenant-tasks-check.ts`; an empty selector fails the CI check. The server and check script share the same route declarations and fixtures, so the demonstrated behavior stays aligned.
