import { bench, describe } from "vitest"
import { Router } from "../core/Router"
import type { Group } from "../types"

const noop = async () => {}

function makeGroup(prefix: string, n: number, withParams = false): Group {
  return {
    prefix,
    routes: Array.from({ length: n }, (_, i) => ({
      method: "GET",
      path: withParams ? `/resource/:id/item-${i}` : `/route-${i}`,
      handler: noop,
    })),
  }
}

function makeRouter(groups: Group[]): Router {
  const r = new Router()
  for (const g of groups) r.group(g)
  return r
}

// Small table: 1 group, 5 routes
const smallRouter = makeRouter([makeGroup("/api", 5)])
// Large table: 5 groups × 10 routes = 50 routes
const largeRouter = makeRouter([
  makeGroup("/api/users", 10),
  makeGroup("/api/products", 10),
  makeGroup("/api/orders", 10),
  makeGroup("/api/invoices", 10),
  makeGroup("/api/reports", 10),
])
// Param router
const paramRouter = makeRouter([makeGroup("/api", 5, true)])

// Requests
const hitFirst = { path: "/api/route-0", method: "GET" }
const hitLast = { path: "/api/route-4", method: "GET" }
const noMatch = { path: "/unknown/path", method: "GET" }
const hitLargeFirst = { path: "/api/users/route-0", method: "GET" }
const hitLargeLast = { path: "/api/reports/route-9", method: "GET" }
const hitParam = { path: "/api/resource/123/item-2", method: "GET" }
const noMatchMethod = { path: "/api/route-0", method: "POST" }

describe("Router.match — small table (5 routes)", () => {
  bench("hit first route", () => {
    smallRouter.match(hitFirst)
  })

  bench("hit last route", () => {
    smallRouter.match(hitLast)
  })

  bench("no match (wrong path)", () => {
    smallRouter.match(noMatch)
  })

  bench("no match (wrong method)", () => {
    smallRouter.match(noMatchMethod)
  })
})

describe("Router.match — large table (50 routes, 5 groups)", () => {
  bench("hit first group, first route", () => {
    largeRouter.match(hitLargeFirst)
  })

  bench("hit last group, last route", () => {
    largeRouter.match(hitLargeLast)
  })

  bench("no match", () => {
    largeRouter.match(noMatch)
  })
})

describe("Router.match — param routes", () => {
  bench("match with :id param", () => {
    paramRouter.match(hitParam)
  })
})
