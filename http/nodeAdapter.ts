import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { HttpError } from "../core/HttpError.js"
import type { Orvaxis } from "../core/Orvaxis.js"
import { abandonRequest } from "../core/requestAbandoned.js"
import { UNSAFE_KEYS } from "../core/utils.js"
import type { OrvaxisRequest, OrvaxisResponse, ServerAdapter } from "../types/index.js"
import { renderError, sendRenderedError } from "./errors.js"
import { type AdapterOptions, closeApp, resolveRequestId, withTimeout } from "./timeout.js"

export type NodeAdapterOptions = AdapterOptions & {
  /**
   * The `node:http` (or `node:https`) server to attach to. Default: a new `http.Server`. The
   * adapter adds a `request` listener to it and owns its `listen()` and `close()`.
   */
  server?: Server
  /** Largest JSON request body accepted, in bytes. Default: `1_048_576` (the Fastify default). */
  bodyLimit?: number
}

const DEFAULT_BODY_LIMIT = 1_048_576

function parseQuery(search: string): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  for (const [key, value] of new URLSearchParams(search)) {
    if (UNSAFE_KEYS.has(key)) continue
    const current = query[key]
    if (current === undefined) query[key] = value
    else if (Array.isArray(current)) current.push(value)
    else query[key] = [current, value]
  }
  return query
}

function isJson(req: IncomingMessage): boolean {
  const type = req.headers["content-type"]
  return typeof type === "string" && /^application\/(?:[\w.+-]+\+)?json\b/i.test(type)
}

/**
 * Reads and parses a JSON body. Other content types leave `body` undefined: the stream stays
 * available on `req.raw` for handlers that want to read it themselves.
 */
async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!isJson(req)) return undefined
  const declared = Number(req.headers["content-length"])
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, "Request body too large", { code: "BODY_TOO_LARGE" })
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > limit) {
      throw new HttpError(413, "Request body too large", { code: "BODY_TOO_LARGE" })
    }
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new HttpError(400, "Malformed JSON body", { code: "INVALID_JSON" })
  }
}

function wrapNodeResponse(res: ServerResponse, onStreamStart: () => void): OrvaxisResponse {
  const wrapped: OrvaxisResponse = {
    statusCode: 200,
    sent: false,
    get completed() {
      return res.writableFinished
    },
    status(code) {
      wrapped.statusCode = code
      res.statusCode = code
      return wrapped
    },
    getHeader(name) {
      const value = res.getHeader(name)
      return typeof value === "number" ? String(value) : value
    },
    setHeader(name, value) {
      res.setHeader(name, value)
      return wrapped
    },
    json(body) {
      const serialized = JSON.stringify(body) ?? "null"
      wrapped.sent = true
      if (!res.hasHeader("Content-Type")) {
        res.setHeader("Content-Type", "application/json; charset=utf-8")
      }
      res.setHeader("Content-Length", Buffer.byteLength(serialized))
      res.end(serialized)
    },
    send(body) {
      if (body !== null && typeof body === "object" && !Buffer.isBuffer(body)) {
        return wrapped.json(body)
      }
      const payload = body == null ? "" : Buffer.isBuffer(body) ? body : String(body)
      if (!res.hasHeader("Content-Type")) {
        res.setHeader(
          "Content-Type",
          Buffer.isBuffer(payload) ? "application/octet-stream" : "text/plain; charset=utf-8"
        )
      }
      res.setHeader("Content-Length", Buffer.byteLength(payload))
      wrapped.sent = true
      res.end(payload)
    },
    write(chunk) {
      onStreamStart()
      wrapped.sent = true
      res.write(chunk as string | Uint8Array)
    },
    end(chunk?) {
      wrapped.sent = true
      if (chunk !== undefined) res.end(chunk as string | Uint8Array)
      else res.end()
    },
    pipe(stream) {
      onStreamStart()
      wrapped.sent = true
      stream.once("error", () => res.destroy())
      stream.pipe(res)
    },
  }
  return wrapped
}

/**
 * Serve an `Orvaxis` app with `node:http`, without Express or Fastify. The request is adapted
 * the same way as in the other adapters (request ID, timeout, disconnect and shutdown signal,
 * error envelope), except that there is no router or middleware stack around it: Orvaxis answers
 * every request, JSON bodies are parsed by the adapter, and `ctx.req.raw` is the `IncomingMessage`.
 */
export function createNodeServer(app: Orvaxis, options: NodeAdapterOptions = {}): ServerAdapter {
  const server = options.server ?? createServer()
  const timeoutMs = options.timeout ?? 30_000
  const logger = options.logger ?? console
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT
  const requestIdHeader = options.requestIdHeader ?? "X-Request-ID"
  const requestIdHeaderLower = requestIdHeader.toLowerCase()
  const activeControllers = new Set<AbortController>()
  let closing = false
  let listening = false

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = resolveRequestId(req.headers[requestIdHeaderLower], options.trustRequestId)
    const controller = new AbortController()
    activeControllers.add(controller)

    // `close` fires once per response; a response that closed before finishing means the
    // client went away.
    res.once("close", () => {
      if (!res.writableFinished) abandonRequest(controller, "disconnect")
    })
    // During shutdown a response that finishes must not leave an idle keep-alive connection
    // behind: it would hold close() until the forced deadline although the work is done.
    const socket = res.socket
    res.once("finish", () => {
      if (closing) socket?.end()
    })

    let cancelTimer: (() => void) | undefined
    const wrapped = wrapNodeResponse(res, () => cancelTimer?.())
    wrapped.setHeader(requestIdHeader, requestId)

    try {
      const url = req.url ?? "/"
      const queryStart = url.indexOf("?")
      const path = queryStart === -1 ? url : url.slice(0, queryStart)
      const method = req.method ?? "GET"
      // The route is known before the body is read, so its own limits apply exactly.
      const settings = app.routeSettings({ method, path })
      const adapted: OrvaxisRequest = {
        path,
        method,
        headers: req.headers,
        query: parseQuery(queryStart === -1 ? "" : url.slice(queryStart + 1)),
        body: await readJsonBody(req, settings?.bodyLimit ?? bodyLimit),
        id: requestId,
        signal: controller.signal,
        raw: req,
      }
      const routeTimeout = settings?.timeout ?? timeoutMs
      const handlePromise = app.handle(adapted, wrapped)
      if (routeTimeout > 0) {
        await withTimeout(
          handlePromise,
          routeTimeout,
          controller,
          (cancel) => {
            cancelTimer = cancel
          },
          options.timeoutStatus
        )
      } else {
        await handlePromise
      }
    } catch (err) {
      if (!wrapped.sent && !res.headersSent) {
        sendRenderedError(
          wrapped,
          renderError(
            err,
            requestId,
            { ...options, logger },
            { method: req.method, path: req.url?.split("?")[0] }
          )
        )
      } else {
        logger.error("[orvaxis] unhandled error after response sent:", err)
        if (!res.writableEnded) res.destroy()
      }
    } finally {
      activeControllers.delete(controller)
    }
  }

  server.on("request", (req, res) => {
    void handle(req, res)
  })

  return {
    listen: (port, onListen) =>
      new Promise<void>((resolve, reject) => {
        if (listening) {
          return reject(new Error("Server is already listening. Call close() first."))
        }
        try {
          if (app.denyByDefault) app.assertProtected()
        } catch (err) {
          return reject(err)
        }
        listening = true
        server
          .listen(port)
          .once("listening", () => {
            const address = server.address()
            onListen?.(typeof address === "object" && address ? address.port : port)
            resolve()
          })
          .once("error", (err) => {
            listening = false
            reject(err)
          })
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!listening) return resolve()
        const shutdownTimeout = options.shutdownTimeout ?? 10_000
        // Notify in-flight handlers (e.g. SSE loops) that shutdown has started, through the same
        // ctx.req.signal used for per-request timeouts.
        closing = true
        for (const controller of activeControllers) controller.abort()
        server.closeIdleConnections()
        const deadline =
          shutdownTimeout > 0
            ? setTimeout(() => server.closeAllConnections(), shutdownTimeout)
            : undefined
        server.close((err) => {
          clearTimeout(deadline)
          listening = false
          closing = false
          if (err) return reject(err)
          closeApp(app, logger).then(resolve)
        })
      }),
  }
}
