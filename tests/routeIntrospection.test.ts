import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { Router } from "../core/Router"

const noop = async () => {}

describe("Router.routes()", () => {
  it("returns an empty array when no groups are registered", () => {
    expect(new Router().routes()).toEqual([])
  })

  it("returns a single route with its full path", () => {
    const router = new Router()
    router.group({ prefix: "/api", routes: [{ method: "GET", path: "/users", handler: noop }] })

    expect(router.routes()).toEqual([{ method: "GET", path: "/api/users", prefix: "/api" }])
  })

  it("returns all routes across multiple groups in registration order", () => {
    const router = new Router()
    router.group({ prefix: "/api", routes: [{ method: "GET", path: "/users", handler: noop }] })
    router.group({
      prefix: "/admin",
      routes: [
        { method: "GET", path: "/stats", handler: noop },
        { method: "DELETE", path: "/cache", handler: noop },
      ],
    })

    expect(router.routes()).toEqual([
      { method: "GET", path: "/api/users", prefix: "/api" },
      { method: "GET", path: "/admin/stats", prefix: "/admin" },
      { method: "DELETE", path: "/admin/cache", prefix: "/admin" },
    ])
  })

  it("handles a route with an empty path (matches prefix exactly)", () => {
    const router = new Router()
    router.group({ prefix: "/api", routes: [{ method: "GET", path: "", handler: noop }] })

    expect(router.routes()).toEqual([{ method: "GET", path: "/api", prefix: "/api" }])
  })

  it("handles prefix '/' correctly (no double slash)", () => {
    const router = new Router()
    router.group({ prefix: "/", routes: [{ method: "GET", path: "/health", handler: noop }] })

    expect(router.routes()).toEqual([{ method: "GET", path: "/health", prefix: "/" }])
  })

  it("handles prefix '/' with empty route path as '/'", () => {
    const router = new Router()
    router.group({ prefix: "/", routes: [{ method: "GET", path: "", handler: noop }] })

    expect(router.routes()).toEqual([{ method: "GET", path: "/", prefix: "/" }])
  })

  it("includes param segments verbatim", () => {
    const router = new Router()
    router.group({ prefix: "/users", routes: [{ method: "GET", path: "/:id", handler: noop }] })

    expect(router.routes()[0].path).toBe("/users/:id")
  })
})

describe("Orvaxis.routes()", () => {
  it("delegates to the router and returns registered routes", () => {
    const app = new Orvaxis()
    app.group({
      prefix: "/api",
      routes: [
        { method: "GET", path: "/items", handler: noop },
        { method: "POST", path: "/items", handler: noop },
      ],
    })

    expect(app.routes()).toEqual([
      { method: "GET", path: "/api/items", prefix: "/api" },
      { method: "POST", path: "/api/items", prefix: "/api" },
    ])
  })
})
