import { Orvaxis } from "../index"
import type { Policy } from "../types"

export type DemoIdentity = {
  userId: string
  tenantId: string
  role: "member" | "admin"
}

export type DemoTask = {
  id: string
  tenantId: string
  ownerId: string
  title: string
}

export const demoIdentities: Record<string, DemoIdentity> = {
  "key-alice": { userId: "alice", tenantId: "acme", role: "member" },
  "key-bob": { userId: "bob", tenantId: "acme", role: "member" },
  "key-maya": { userId: "maya", tenantId: "globex", role: "member" },
  "key-admin": { userId: "root", tenantId: "acme", role: "admin" },
}

export const demoTasks: DemoTask[] = [
  { id: "task-1", tenantId: "acme", ownerId: "alice", title: "Prepare quarterly report" },
  { id: "task-2", tenantId: "acme", ownerId: "bob", title: "Review release plan" },
  { id: "task-3", tenantId: "globex", ownerId: "maya", title: "Update onboarding guide" },
]

export const tenantTasksApp = new Orvaxis({ policyTrace: { mode: "summary" } })

const authenticate: Policy = {
  name: "authenticate",
  evaluate(ctx) {
    const key = ctx.req.headers["x-api-key"]
    const identity = typeof key === "string" ? demoIdentities[key] : undefined
    return identity
      ? { allow: true, modify: { identity } }
      : { allow: false, status: 401, reason: "Unknown demo API key" }
  },
}

const tenantAccess: Policy = {
  name: "tenant-access",
  evaluate(ctx) {
    const identity = ctx.meta.identity as DemoIdentity
    return identity.role === "admin" || identity.tenantId === ctx.params.tenantId
      ? { allow: true }
      : { allow: false, status: 403, reason: "Identity does not belong to this tenant" }
  },
}

const taskOwnerOrAdmin: Policy = {
  name: "task-owner-or-admin",
  evaluate(ctx) {
    const identity = ctx.meta.identity as DemoIdentity
    const task = demoTasks.find(
      (candidate) =>
        candidate.id === ctx.params.taskId && candidate.tenantId === ctx.params.tenantId
    )
    if (!task) return { allow: false, status: 404, reason: "Task not found in this tenant" }
    return identity.role === "admin" || task.ownerId === identity.userId
      ? { allow: true }
      : { allow: false, status: 403, reason: "Task belongs to another user" }
  },
}

const requireAdmin: Policy = {
  name: "require-admin",
  evaluate(ctx) {
    const identity = ctx.meta.identity as DemoIdentity
    return identity.role === "admin"
      ? { allow: true }
      : { allow: false, status: 403, reason: "Admin role required" }
  },
}

tenantTasksApp.policy(authenticate)
tenantTasksApp.group({
  prefix: "/api/tenants/:tenantId",
  policies: [tenantAccess],
  routes: [
    {
      method: "GET",
      path: "/tasks/:taskId",
      policies: [taskOwnerOrAdmin],
      handler: (ctx) => {
        const task = demoTasks.find(
          (candidate) =>
            candidate.id === ctx.params.taskId && candidate.tenantId === ctx.params.tenantId
        )
        if (!task) {
          ctx.res.status(404).json({ error: "Task not found" })
          return
        }
        ctx.res.json(task)
      },
    },
    {
      method: "GET",
      path: "/admin/overview",
      policies: [requireAdmin],
      handler: (ctx) => {
        const tenantTasks = demoTasks.filter((task) => task.tenantId === ctx.params.tenantId)
        ctx.res.json({
          tenantId: ctx.params.tenantId,
          taskCount: tenantTasks.length,
          ownerCount: new Set(tenantTasks.map((task) => task.ownerId)).size,
        })
      },
    },
  ],
})

export const tenantTaskScenarios = [
  {
    name: "anonymous request",
    request: { path: "/api/tenants/acme/tasks/task-1" },
    expected: { status: 401, policy: "authenticate", handlerExecuted: false },
  },
  {
    name: "task owner in the tenant",
    request: { path: "/api/tenants/acme/tasks/task-1", headers: { "x-api-key": "key-alice" } },
    expected: { status: 200, policy: null, handlerExecuted: true },
  },
  {
    name: "different member in the same tenant",
    request: { path: "/api/tenants/acme/tasks/task-1", headers: { "x-api-key": "key-bob" } },
    expected: { status: 403, policy: "task-owner-or-admin", handlerExecuted: false },
  },
  {
    name: "member from another tenant",
    request: { path: "/api/tenants/acme/tasks/task-1", headers: { "x-api-key": "key-maya" } },
    expected: { status: 403, policy: "tenant-access", handlerExecuted: false },
  },
  {
    name: "admin can access another tenant's task",
    request: { path: "/api/tenants/globex/tasks/task-3", headers: { "x-api-key": "key-admin" } },
    expected: { status: 200, policy: null, handlerExecuted: true },
  },
  {
    name: "member cannot open the admin overview",
    request: {
      path: "/api/tenants/acme/admin/overview",
      headers: { "x-api-key": "key-alice" },
    },
    expected: { status: 403, policy: "require-admin", handlerExecuted: false },
  },
  {
    name: "admin can open the admin overview",
    request: {
      path: "/api/tenants/acme/admin/overview",
      headers: { "x-api-key": "key-admin" },
    },
    expected: { status: 200, policy: null, handlerExecuted: true },
  },
] as const
