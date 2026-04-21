import { describe, expect, it } from "vitest"
import { Router } from "../core/Router"
import type { Group } from "../types"

const noop = async () => {}

const makeGroup = (prefix: string, routes: { method: string; path: string }[]): Group => ({
  prefix,
  routes: routes.map((r) => ({ ...r, handler: noop })),
})

describe("Router", () => {
  it("returns null when no groups are registered", () => {
    const router = new Router()
    expect(router.match({ path: "/api/users", method: "GET" })).toBeNull()
  })

  it("matches exact prefix + path", () => {
    const router = new Router()
    router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))

    const match = router.match({ path: "/api/users", method: "GET" })
    expect(match).not.toBeNull()
    expect(match?.route.path).toBe("/users")
    expect(match?.group.prefix).toBe("/api")
  })

  it("matches the correct HTTP method", () => {
    const router = new Router()
    router.group(
      makeGroup("/api", [
        { method: "GET", path: "/items" },
        { method: "POST", path: "/items" },
      ])
    )

    const get = router.match({ path: "/api/items", method: "GET" })
    expect(get?.route.method).toBe("GET")

    const post = router.match({ path: "/api/items", method: "POST" })
    expect(post?.route.method).toBe("POST")
  })

  it("returns null for wrong method", () => {
    const router = new Router()
    router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))

    expect(router.match({ path: "/api/users", method: "POST" })).toBeNull()
  })

  it("returns null for path that does not start with prefix", () => {
    const router = new Router()
    router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))

    expect(router.match({ path: "/other/users", method: "GET" })).toBeNull()
  })

  it("does not match prefix-only path without trailing route", () => {
    const router = new Router()
    router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))

    expect(router.match({ path: "/api", method: "GET" })).toBeNull()
  })

  it("matches the prefix itself when a route with empty path '/' is registered", () => {
    const router = new Router()
    router.group(makeGroup("/api", [{ method: "GET", path: "" }]))

    const match = router.match({ path: "/api", method: "GET" })
    expect(match).not.toBeNull()
  })

  it("matches across multiple groups, picking the correct one", () => {
    const router = new Router()
    router.group(makeGroup("/users", [{ method: "GET", path: "/profile" }]))
    router.group(makeGroup("/orders", [{ method: "GET", path: "/list" }]))

    expect(router.match({ path: "/users/profile", method: "GET" })?.group.prefix).toBe("/users")
    expect(router.match({ path: "/orders/list", method: "GET" })?.group.prefix).toBe("/orders")
  })

  it("returns the full route object including handler", () => {
    const handler = async () => {}
    const router = new Router()
    router.group({
      prefix: "/v1",
      routes: [{ method: "DELETE", path: "/item", handler }],
    })

    const match = router.match({ path: "/v1/item", method: "DELETE" })
    expect(match?.route.handler).toBe(handler)
  })

  it("does not match a path that only partially starts with prefix", () => {
    const router = new Router()
    router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))

    expect(router.match({ path: "/apiX/users", method: "GET" })).toBeNull()
  })

  describe("param routing", () => {
    it("matches a single param segment", () => {
      const router = new Router()
      router.group(makeGroup("/users", [{ method: "GET", path: "/:id" }]))

      const match = router.match({ path: "/users/42", method: "GET" })
      expect(match).not.toBeNull()
      expect(match?.params).toEqual({ id: "42" })
    })

    it("matches multiple param segments", () => {
      const router = new Router()
      router.group(makeGroup("/users", [{ method: "GET", path: "/:userId/posts/:postId" }]))

      const match = router.match({ path: "/users/10/posts/99", method: "GET" })
      expect(match).not.toBeNull()
      expect(match?.params).toEqual({ userId: "10", postId: "99" })
    })

    it("returns empty params for static routes", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))

      const match = router.match({ path: "/api/users", method: "GET" })
      expect(match?.params).toEqual({})
    })

    it("does not match when param segment count differs", () => {
      const router = new Router()
      router.group(makeGroup("/users", [{ method: "GET", path: "/:id" }]))

      expect(router.match({ path: "/users/42/extra", method: "GET" })).toBeNull()
    })

    it("URL-decodes param values", () => {
      const router = new Router()
      router.group(makeGroup("/items", [{ method: "GET", path: "/:name" }]))

      const match = router.match({ path: "/items/hello%20world", method: "GET" })
      expect(match?.params.name).toBe("hello world")
    })

    it("throws 400 for malformed percent-encoding in param segment", () => {
      const router = new Router()
      router.group(makeGroup("/items", [{ method: "GET", path: "/:name" }]))

      const err = (() => {
        try {
          router.match({ path: "/items/%ZZ", method: "GET" })
        } catch (e) {
          return e as { status: number; message: string }
        }
      })()

      expect(err?.status).toBe(400)
      expect(err?.message).toMatch(/percent-encoding/)
    })
  })
})
