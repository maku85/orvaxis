import { describe, expect, it } from "vitest"
import { Orvaxis } from "../core/Orvaxis"
import { testRequest } from "../core/testHarness"
import { corsPlugin } from "../plugins/corsPlugin"

const noop = async () => {}

function makeApp(prefix = "/api", method = "GET") {
  const app = new Orvaxis()
  app.group({ prefix, routes: [{ method, path: "/resource", handler: noop }] })
  return app
}

describe("corsPlugin", () => {
  describe("regular requests", () => {
    it("sets Access-Control-Allow-Origin: * by default", async () => {
      const app = makeApp()
      app.register(corsPlugin())
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://example.com" },
      })
      expect(res.headers["Access-Control-Allow-Origin"]).toBe("*")
    })

    it("reflects the request origin when a specific string origin is configured", async () => {
      const app = makeApp()
      app.register(corsPlugin({ origin: "https://example.com" }))
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://example.com" },
      })
      expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://example.com")
      expect(res.headers.Vary).toBe("Origin")
    })

    it("reflects a matching origin from an array allow-list", async () => {
      const app = makeApp()
      app.register(corsPlugin({ origin: ["https://a.com", "https://b.com"] }))
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://b.com" },
      })
      expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://b.com")
    })

    it("reflects a matching origin when origin is a RegExp", async () => {
      const app = makeApp()
      app.register(corsPlugin({ origin: /^https:\/\/.*\.example\.com$/ }))
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://app.example.com" },
      })
      expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com")
    })

    it("does not set ACAO when origin does not match the allow-list", async () => {
      const app = makeApp()
      app.register(corsPlugin({ origin: "https://trusted.com" }))
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://evil.com" },
      })
      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined()
    })

    it("does not set Vary when origin is wildcard", async () => {
      const app = makeApp()
      app.register(corsPlugin({ origin: "*" }))
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://example.com" },
      })
      expect(res.headers.Vary).toBeUndefined()
    })

    it("sets Access-Control-Allow-Credentials when credentials is true", async () => {
      const app = makeApp()
      app.register(corsPlugin({ origin: "https://example.com", credentials: true }))
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://example.com" },
      })
      expect(res.headers["Access-Control-Allow-Credentials"]).toBe("true")
    })

    it("sets Access-Control-Expose-Headers when exposedHeaders is provided", async () => {
      const app = makeApp()
      app.register(corsPlugin({ exposedHeaders: ["X-Request-ID", "X-Rate-Limit"] }))
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://example.com" },
      })
      expect(res.headers["Access-Control-Expose-Headers"]).toBe("X-Request-ID, X-Rate-Limit")
    })
  })

  describe("OPTIONS preflight", () => {
    it("responds 204 to a preflight on a known path", async () => {
      const app = makeApp()
      app.register(corsPlugin())
      const res = await testRequest(app, {
        method: "OPTIONS",
        path: "/api/resource",
        headers: { origin: "https://example.com", "access-control-request-method": "POST" },
      })
      expect(res.status).toBe(204)
      expect(res.error).toBeUndefined()
    })

    it("sets Access-Control-Allow-Methods from registered methods", async () => {
      const app = makeApp()
      app.register(corsPlugin())
      const res = await testRequest(app, {
        method: "OPTIONS",
        path: "/api/resource",
        headers: { origin: "https://example.com" },
      })
      expect(res.headers["Access-Control-Allow-Methods"]).toContain("GET")
      expect(res.headers["Access-Control-Allow-Methods"]).toContain("HEAD")
    })

    it("uses the configured methods option over the registered methods", async () => {
      const app = makeApp()
      app.register(corsPlugin({ methods: ["GET", "POST"] }))
      const res = await testRequest(app, {
        method: "OPTIONS",
        path: "/api/resource",
        headers: { origin: "https://example.com" },
      })
      expect(res.headers["Access-Control-Allow-Methods"]).toBe("GET, POST")
    })

    it("mirrors Access-Control-Request-Headers when allowedHeaders is not configured", async () => {
      const app = makeApp()
      app.register(corsPlugin())
      const res = await testRequest(app, {
        method: "OPTIONS",
        path: "/api/resource",
        headers: {
          origin: "https://example.com",
          "access-control-request-headers": "Content-Type, Authorization",
        },
      })
      expect(res.headers["Access-Control-Allow-Headers"]).toBe("Content-Type, Authorization")
    })

    it("uses configured allowedHeaders over the request header", async () => {
      const app = makeApp()
      app.register(corsPlugin({ allowedHeaders: ["X-API-Key"] }))
      const res = await testRequest(app, {
        method: "OPTIONS",
        path: "/api/resource",
        headers: {
          origin: "https://example.com",
          "access-control-request-headers": "Content-Type",
        },
      })
      expect(res.headers["Access-Control-Allow-Headers"]).toBe("X-API-Key")
    })

    it("sets Access-Control-Max-Age when maxAge is configured", async () => {
      const app = makeApp()
      app.register(corsPlugin({ maxAge: 3600 }))
      const res = await testRequest(app, {
        method: "OPTIONS",
        path: "/api/resource",
        headers: { origin: "https://example.com" },
      })
      expect(res.headers["Access-Control-Max-Age"]).toBe("3600")
    })

    it("does not set ACAO when the request has no origin header and a specific origin is configured", async () => {
      const app = makeApp()
      app.register(corsPlugin({ origin: "https://trusted.com" }))
      // no origin header in the request
      const res = await testRequest(app, { path: "/api/resource" })
      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined()
    })

    it("does not set ACAO when origin is an unknown runtime type (resolveOrigin final fallthrough)", async () => {
      const app = makeApp()
      // Pass a plain object — not string, array, or RegExp — to reach the final `return null`
      app.register(corsPlugin({ origin: {} as unknown as string }))
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://example.com" },
      })
      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined()
    })

    it("does not set ACAO when array origin does not include the request origin", async () => {
      const app = makeApp()
      app.register(corsPlugin({ origin: ["https://a.com", "https://b.com"] }))
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://evil.com" },
      })
      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined()
    })

    it("does not set ACAO when RegExp origin does not match the request origin", async () => {
      const app = makeApp()
      app.register(corsPlugin({ origin: /^https:\/\/trusted\.com$/ }))
      const res = await testRequest(app, {
        path: "/api/resource",
        headers: { origin: "https://evil.com" },
      })
      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined()
    })

    it("does not set CORS headers when preflight origin is rejected", async () => {
      const app = makeApp()
      app.register(corsPlugin({ origin: "https://trusted.com" }))
      const res = await testRequest(app, {
        method: "OPTIONS",
        path: "/api/resource",
        headers: { origin: "https://evil.com" },
      })
      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined()
    })

    it("returns 404 for OPTIONS on a completely unknown path", async () => {
      const app = makeApp()
      app.register(corsPlugin())
      const res = await testRequest(app, {
        method: "OPTIONS",
        path: "/api/unknown",
        headers: { origin: "https://example.com" },
      })
      expect(res.status).toBe(404)
    })
  })
})
