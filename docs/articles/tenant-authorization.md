# Model tenant and resource authorization as separate checks

A tenant-aware API needs to answer two different questions: may this identity enter the tenant, and may it access this particular resource? Keeping those decisions separate makes the authorization boundary visible and produces a useful explanation when access is denied.

The [tenant task example](../guide/multi-tenant-demo.md) implements both checks:

1. A global `authenticate` policy resolves a demo API key to an identity, tenant, and role.
2. The `/api/tenants/:tenantId` group applies `tenant-access`. Members must belong to the requested tenant; the admin fixture can cross tenant boundaries.
3. The task route applies `task-owner-or-admin`. Members must own the task; an admin may read it.
4. The admin overview applies `require-admin`, showing role-based access as a separate rule.

Try the same task as its owner, a different user in the same tenant, a user in another tenant, and an admin:

```bash
pnpm exec tsx examples/tenant-tasks-server.ts

curl -i -H 'x-api-key: key-alice' http://localhost:3002/api/tenants/acme/tasks/task-1  # 200
curl -i -H 'x-api-key: key-bob' http://localhost:3002/api/tenants/acme/tasks/task-1    # 403 owner
curl -i -H 'x-api-key: key-maya' http://localhost:3002/api/tenants/acme/tasks/task-1   # 403 tenant
curl -i -H 'x-api-key: key-admin' http://localhost:3002/api/tenants/globex/tasks/task-3 # 200 admin
```

The cross-tenant request stops at `tenant-access`; the same-tenant non-owner reaches the task route and stops at `task-owner-or-admin`. This ordering avoids evaluating a resource-level rule for an identity that has not passed the tenant boundary.

The keys and records are in-memory fixtures, not production authentication or persistence. Replace the identity lookup with trusted authentication state and load tenant/resource ownership from the application's data layer before using this pattern in a real service.
