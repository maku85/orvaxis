import { describe, expect, it } from "vitest"
import { Router } from "../core/Router"
import type { Group, HttpMethod } from "../types"

const noop = async () => {}

const makeGroup = (prefix: string, routes: { method: HttpMethod; path: string }[]): Group => ({
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

  it("normalizes double slashes in request path", () => {
    const router = new Router()
    router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))

    const match = router.match({ path: "/api//users", method: "GET" })
    expect(match).not.toBeNull()
    expect(match?.route.path).toBe("/users")
  })

  it("matches routes when group prefix is '/'", () => {
    const router = new Router()
    router.group(makeGroup("/", [{ method: "GET", path: "/health" }]))

    const match = router.match({ path: "/health", method: "GET" })
    expect(match).not.toBeNull()
    expect(match?.route.path).toBe("/health")
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

    it("returns null when a static segment in a mixed pattern does not match", () => {
      const router = new Router()
      router.group(makeGroup("/users", [{ method: "GET", path: "/:id/posts" }]))

      // segment count matches (3 parts each) but the static "posts" ≠ "comments"
      expect(router.match({ path: "/users/42/comments", method: "GET" })).toBeNull()
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

  describe("trie priority and backtracking", () => {
    it("prefers a static segment over a param segment when both could match", () => {
      const router = new Router()
      router.group(
        makeGroup("/users", [
          { method: "GET", path: "/:id" },
          { method: "GET", path: "/me" },
        ])
      )

      const match = router.match({ path: "/users/me", method: "GET" })
      expect(match?.route.path).toBe("/me")
      expect(match?.params).toEqual({})
    })

    it("falls back to a param segment when the static branch fails deeper in the tree", () => {
      const router = new Router()
      router.group(
        makeGroup("/api", [
          { method: "GET", path: "/a/b" },
          { method: "GET", path: "/:x/c" },
        ])
      )

      // "a/b" matches the static route; "a/c" must fall back to the param route
      expect(router.match({ path: "/api/a/b", method: "GET" })?.route.path).toBe("/a/b")

      const match = router.match({ path: "/api/a/c", method: "GET" })
      expect(match?.route.path).toBe("/:x/c")
      expect(match?.params).toEqual({ x: "a" })
    })

    it("does not leak params from a failed branch into the successful match", () => {
      const router = new Router()
      router.group(
        makeGroup("/", [
          { method: "GET", path: "/a/:x/b" },
          { method: "GET", path: "/a/c/:y" },
        ])
      )

      // /a/c/d matches the static-preferred route /a/c/:y — no "x" in params
      const match = router.match({ path: "/a/c/d", method: "GET" })
      expect(match?.route.path).toBe("/a/c/:y")
      expect(match?.params).toEqual({ y: "d" })
      expect(match?.params).not.toHaveProperty("x")
    })

    it("matches correctly across many registered routes (no linear regression)", () => {
      const router = new Router()
      const routes = Array.from({ length: 100 }, (_, i) => ({
        method: "GET",
        path: `/item${i}`,
      }))
      router.group(makeGroup("/api", routes))

      const match = router.match({ path: "/api/item99", method: "GET" })
      expect(match?.route.path).toBe("/item99")
      expect(match?.params).toEqual({})
    })
  })

  describe("wildcard routing", () => {
    it("matches any single segment with an unnamed wildcard", () => {
      const router = new Router()
      router.group(makeGroup("/static", [{ method: "GET", path: "/*" }]))

      const match = router.match({ path: "/static/file.css", method: "GET" })
      expect(match).not.toBeNull()
      expect(match?.params).toEqual({ "*": "file.css" })
    })

    it("matches multiple remaining segments into a single wildcard value", () => {
      const router = new Router()
      router.group(makeGroup("/files", [{ method: "GET", path: "/*" }]))

      const match = router.match({ path: "/files/a/b/c.txt", method: "GET" })
      expect(match?.params).toEqual({ "*": "a/b/c.txt" })
    })

    it("captures into a named wildcard param", () => {
      const router = new Router()
      router.group(makeGroup("/files", [{ method: "GET", path: "/*filepath" }]))

      const match = router.match({ path: "/files/docs/readme.md", method: "GET" })
      expect(match?.params).toEqual({ filepath: "docs/readme.md" })
    })

    it("allows static prefix segments before the wildcard", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/v1/*" }]))

      expect(router.match({ path: "/api/v1/users/me", method: "GET" })?.params).toEqual({
        "*": "users/me",
      })
    })

    it("prefers an exact static/param route over the wildcard for shorter paths", () => {
      const router = new Router()
      router.group(
        makeGroup("/api", [
          { method: "GET", path: "/users/:id" },
          { method: "GET", path: "/*" },
        ])
      )

      // exact param route wins for a two-segment path
      const exact = router.match({ path: "/api/users/42", method: "GET" })
      expect(exact?.route.path).toBe("/users/:id")
      expect(exact?.params).toEqual({ id: "42" })

      // wildcard takes over for deeper paths that param can't handle
      const deep = router.match({ path: "/api/users/42/posts", method: "GET" })
      expect(deep?.route.path).toBe("/*")
      expect(deep?.params).toEqual({ "*": "users/42/posts" })
    })

    it("does not match when no segment follows the wildcard anchor", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/*" }]))

      expect(router.match({ path: "/api", method: "GET" })).toBeNull()
    })

    it("URL-decodes each wildcard segment individually", () => {
      const router = new Router()
      router.group(makeGroup("/files", [{ method: "GET", path: "/*" }]))

      const match = router.match({ path: "/files/hello%20world/foo%20bar", method: "GET" })
      expect(match?.params).toEqual({ "*": "hello world/foo bar" })
    })

    it("throws TypeError when wildcard is not the last segment", () => {
      const router = new Router()
      expect(() => router.group(makeGroup("/api", [{ method: "GET", path: "/*/rest" }]))).toThrow(
        TypeError
      )
    })
  })

  describe("method normalisation", () => {
    it("matches a request with uppercase method against a lowercase-registered route", () => {
      const router = new Router()
      router.group({
        prefix: "/api",
        routes: [{ method: "get" as unknown as "GET", path: "/users", handler: noop }],
      })
      expect(router.match({ path: "/api/users", method: "GET" })).not.toBeNull()
    })

    it("matches a request with lowercase method against an uppercase-registered route", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))
      expect(router.match({ path: "/api/users", method: "get" })).not.toBeNull()
    })

    it("does not confuse routes with different methods after normalisation", () => {
      const router = new Router()
      router.group(
        makeGroup("/api", [
          { method: "GET", path: "/r" },
          { method: "POST", path: "/r" },
        ])
      )
      expect(router.match({ path: "/api/r", method: "get" })?.route.method).toBe("GET")
      expect(router.match({ path: "/api/r", method: "post" })?.route.method).toBe("POST")
      expect(router.match({ path: "/api/r", method: "DELETE" })).toBeNull()
    })
  })

  describe("duplicate route detection", () => {
    it("throws TypeError when the same static route is registered twice", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))
      expect(() => router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))).toThrow(
        TypeError
      )
    })

    it("error message includes the method and full pattern", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "POST", path: "/items" }]))
      expect(() => router.group(makeGroup("/api", [{ method: "POST", path: "/items" }]))).toThrow(
        "Duplicate route: POST /api/items"
      )
    })

    it("throws TypeError when the same param route is registered twice", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/:id" }]))
      expect(() => router.group(makeGroup("/api", [{ method: "GET", path: "/:id" }]))).toThrow(
        TypeError
      )
    })

    it("throws TypeError when a wildcard route is registered twice", () => {
      const router = new Router()
      router.group(makeGroup("/files", [{ method: "GET", path: "/*" }]))
      expect(() => router.group(makeGroup("/files", [{ method: "GET", path: "/*" }]))).toThrow(
        TypeError
      )
    })

    it("throws TypeError when two param routes use different names at the same position", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/:id" }]))
      expect(() => router.group(makeGroup("/api", [{ method: "GET", path: "/:userId" }]))).toThrow(
        /Route conflict.*:userId.*:id|Route conflict.*:id.*:userId/
      )
    })

    it("allows the same path pattern with different HTTP methods", () => {
      const router = new Router()
      expect(() =>
        router.group(
          makeGroup("/api", [
            { method: "GET", path: "/users" },
            { method: "POST", path: "/users" },
            { method: "DELETE", path: "/users" },
          ])
        )
      ).not.toThrow()
    })

    it("allows the same path pattern across different group prefixes", () => {
      const router = new Router()
      expect(() => {
        router.group(makeGroup("/v1", [{ method: "GET", path: "/users" }]))
        router.group(makeGroup("/v2", [{ method: "GET", path: "/users" }]))
      }).not.toThrow()
    })

    it("detects duplicates across two group() calls for the same prefix", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/ping" }]))
      expect(() => router.group(makeGroup("/api", [{ method: "GET", path: "/ping" }]))).toThrow(
        TypeError
      )
    })
  })

  describe("allowedMethods", () => {
    it("returns empty array for an unregistered path", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))
      expect(router.allowedMethods("/api/unknown")).toEqual([])
    })

    it("returns registered methods for a known path", () => {
      const router = new Router()
      router.group(
        makeGroup("/api", [
          { method: "GET", path: "/users" },
          { method: "POST", path: "/users" },
        ])
      )
      const methods = router.allowedMethods("/api/users")
      expect(methods).toContain("GET")
      expect(methods).toContain("POST")
    })

    it("includes HEAD implicitly when GET is registered", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))
      expect(router.allowedMethods("/api/users")).toContain("HEAD")
    })

    it("does not include HEAD when only POST is registered", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "POST", path: "/users" }]))
      expect(router.allowedMethods("/api/users")).not.toContain("HEAD")
    })

    it("works with param routes", () => {
      const router = new Router()
      router.group(
        makeGroup("/users", [
          { method: "GET", path: "/:id" },
          { method: "DELETE", path: "/:id" },
        ])
      )
      const methods = router.allowedMethods("/users/42")
      expect(methods).toContain("GET")
      expect(methods).toContain("DELETE")
      expect(methods).toContain("HEAD")
    })

    it("normalizes double slashes in path", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))
      expect(router.allowedMethods("/api//users")).toContain("GET")
    })
  })

  describe("HEAD → GET fallback", () => {
    it("matches a HEAD request against a GET route when no HEAD route is registered", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "GET", path: "/users" }]))
      const match = router.match({ path: "/api/users", method: "HEAD" })
      expect(match).not.toBeNull()
      expect(match?.route.method).toBe("GET")
    })

    it("prefers a dedicated HEAD route over the GET fallback", () => {
      const router = new Router()
      router.group(
        makeGroup("/api", [
          { method: "GET", path: "/users" },
          { method: "HEAD", path: "/users" },
        ])
      )
      const match = router.match({ path: "/api/users", method: "HEAD" })
      expect(match?.route.method).toBe("HEAD")
    })

    it("returns null for HEAD when no GET route exists either", () => {
      const router = new Router()
      router.group(makeGroup("/api", [{ method: "POST", path: "/users" }]))
      expect(router.match({ path: "/api/users", method: "HEAD" })).toBeNull()
    })

    it("HEAD fallback works with param routes", () => {
      const router = new Router()
      router.group(makeGroup("/users", [{ method: "GET", path: "/:id" }]))
      const match = router.match({ path: "/users/42", method: "HEAD" })
      expect(match).not.toBeNull()
      expect(match?.params).toEqual({ id: "42" })
    })

    it("HEAD fallback works with wildcard routes", () => {
      const router = new Router()
      router.group(makeGroup("/files", [{ method: "GET", path: "/*filepath" }]))
      const match = router.match({ path: "/files/docs/readme.md", method: "HEAD" })
      expect(match).not.toBeNull()
      expect(match?.params.filepath).toBe("docs/readme.md")
    })
  })
})
