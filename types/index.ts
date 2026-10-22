export type DebugEntry = {
  event: string
  time: number
  meta?: Record<string, unknown>
}

export type DebugInfo = {
  timeline: DebugEntry[]
}

export interface Logger {
  info(...args: unknown[]): void
  error(...args: unknown[]): void
  /** Used for runtime warnings (for example a full `ctx.logs`); `error` is used when absent. */
  warn?(...args: unknown[]): void
}

type PolicyTraceBase = {
  /** Maximum recorded policy decisions per request (default: 100). */
  maxEvents?: number
}

export type PolicyTraceOptions =
  | (PolicyTraceBase & { mode?: "summary" | "off" })
  | (PolicyTraceBase & {
      mode: "detailed"
      /** Redacts a policy's free-form denial reason before it enters the trace. */
      redact: (reason: string, policyName: string) => string
    })

export type OrvaxisOptions = {
  /**
   * Refuse to serve a route that no policy is guaranteed to cover. A route is covered when it is
   * `public: true` or when at least one policy applies to it unconditionally (a policy without a
   * scope, or whose scope statically matches the route). With this on, the Express and Fastify
   * adapters reject `listen()` listing the uncovered routes, and a request that reaches one anyway
   * (custom adapters, tests) fails with 500 instead of running its handler. Default: `false`.
   */
  denyByDefault?: boolean
  logger?: Logger
  logsMaxSize?: number
  /** Policy decision collection defaults to a bounded, privacy-safe summary. */
  policyTrace?: PolicyTraceOptions
}

export interface TracerLike {
  event: (type: string, meta?: Record<string, unknown>) => void
}

export interface OrvaxisRequest {
  path: string
  method: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  query?: Record<string, string | string[]>
  id?: string
  signal?: AbortSignal
  [key: string]: unknown
}

export interface OrvaxisResponse {
  statusCode: number
  sent: boolean
  /** Whether the underlying response stream has finished, when the adapter can report it. */
  completed?: boolean
  status(code: number): OrvaxisResponse
  json(body: unknown): void
  send(body: unknown): void
  setHeader(name: string, value: string | string[]): OrvaxisResponse
  /** Current value of a header already set on this response, when the adapter can report it. */
  getHeader?(name: string): string | string[] | undefined
  write(chunk: unknown): void
  end(chunk?: unknown): void
  pipe(stream: import("node:stream").Readable): void
}

export type Group<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = {
  prefix: string
  middleware?: Middleware<TState, TMeta>[]
  policies?: Policy<TState, TMeta>[]
  routes?: Route<TState, TMeta>[]
  /**
   * Nested groups. A child's `prefix` is appended to this one's, and it inherits this group's
   * middleware and policies (the parent's first), `timeout` and `bodyLimit`. The policies of a
   * group and its ancestors form one `group` layer, ordered by `priority` like any other layer.
   */
  groups?: Group<TState, TMeta>[]
  /** Default `timeout` for the routes of this group and its sub-groups; a route's own wins. */
  timeout?: number
  /** Default `bodyLimit` for the routes of this group and its sub-groups; a route's own wins. */
  bodyLimit?: number
}

export type HookName =
  | "onRequest"
  | "onNotFound"
  | "onMethodNotAllowed"
  | "beforePipeline"
  | "onValidation"
  | "beforeHandler"
  | "afterHandler"
  | "afterPipeline"
  | "onError"

export type Middleware<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = (ctx: OrvaxisContext<TState, TMeta>, next: NextFunction) => Promise<void> | void

export type NextFunction = () => Promise<void> | void

export type RouteInfo = {
  method: HttpMethod
  path: string
  prefix: string
}

export type PolicyInspection = {
  /**
   * Declaration identity: layer plus zero-based position in that layer's declaration array.
   * Unique within the inspected route, independent of names, and equal to the `policyId` recorded
   * in the runtime trace. It is not unique across routes.
   */
  id: string
  name: string
  nameAmbiguous: boolean
  layer: "global" | "group" | "route"
  phase: PolicyPhase
  priority: number
  /** Position after priority sorting within this layer and phase. */
  order: number
  requires?: readonly ValidatedRequestField[]
  scope?: {
    method?: HttpMethod
    path?: string
    pathType?: "literal" | "regexp" | "predicate"
  }
  applicability: {
    status: "always" | "never" | "conditional"
    reason:
      | "no-scope"
      | "method-match"
      | "method-alias"
      | "method-mismatch"
      | "path-prefix"
      | "path-no-match"
      | "dynamic-path"
  }
}

export type RouteInspection = RouteInfo & {
  /** The route was declared `public: true`. */
  public?: boolean
  /** Static policy configuration only; no policy, predicate, or handler is executed. */
  policies: PolicyInspection[]
  schema?: RouteSchema
  responses?: RouteResponseSchemas
  openapi?: RouteOpenApiMetadata
}

export type RouteMatch = {
  route: Route
  group: Group
  params: Record<string, string>
}

export type ContextMeta = {
  tracer?: TracerLike
  route?: RouteMatch
  trace?: Trace
  debug?: DebugInfo
  [key: string]: unknown
}

/**
 * The authenticated caller, set by the function registered with `app.authenticate()`. Declare
 * your own fields by augmenting this interface, the way Express augments `Request`:
 *
 *     declare module "orvaxis" {
 *       interface OrvaxisIdentity { userId: string; roles: string[] }
 *     }
 */
export interface OrvaxisIdentity {
  readonly [key: string]: unknown
}

/**
 * Resolves the caller before any policy runs. Return the identity, or `null`/`undefined` for an
 * anonymous request (policies then decide), or throw an `HttpError` (typically 401) to reject.
 */
export type Authenticator = (
  ctx: OrvaxisContext
) => OrvaxisIdentity | null | undefined | Promise<OrvaxisIdentity | null | undefined>

export type OrvaxisContext<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = {
  req: OrvaxisRequest
  res: OrvaxisResponse
  state: TState
  /** Set by `app.authenticate()`; `undefined` for an anonymous request or when none is registered. */
  identity?: OrvaxisIdentity
  meta: ContextMeta & TMeta
  logs: string[]
  error?: Error
  readonly params: Record<string, string>
}

type PolicyBase<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = {
  name: string
  priority?: number
  scope?: PolicyScope
  evaluate: (ctx: OrvaxisContext<TState, TMeta>) => PolicyResult | Promise<PolicyResult>
}

export type ValidatedRequestField = keyof RouteSchema
export type PolicyPhase = "preValidation" | "postValidation"

export type Policy<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = PolicyBase<TState, TMeta> &
  (
    | { phase?: "preValidation"; requires?: never }
    | {
        phase: "postValidation"
        requires: readonly [ValidatedRequestField, ...ValidatedRequestField[]]
      }
  )

export type PolicyResult =
  | { allow: true; modify?: Record<string, unknown> }
  | { allow: false; reason?: string; status?: number }

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"

export type PolicyScope = {
  path?: string | RegExp | ((path: string) => boolean)
  method?: HttpMethod
}

/**
 * The Standard Schema interface (https://standardschema.dev), implemented by Zod 3.24+, Valibot,
 * ArkType and others. Declared here so Orvaxis has no dependency on the spec package.
 */
export type StandardIssue = {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> }

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
    /**
     * Standard JSON Schema (optional, implemented by Zod 4): lets `orvaxis/openapi` describe the
     * validator without a converter.
     */
    readonly jsonSchema?: {
      readonly input: (options: { readonly target: string }) => Record<string, unknown>
      readonly output: (options: { readonly target: string }) => Record<string, unknown>
    }
  }
}

/**
 * A request or response validator: a Standard Schema, or any object with a synchronous `parse`
 * that returns the parsed value and throws on failure (the shape of Zod's `parse`). When an
 * object has both, the Standard Schema is used.
 */
export type SchemaField<TOutput = unknown> =
  | StandardSchemaV1<unknown, TOutput>
  | { parse(data: unknown): TOutput }

export type RouteSchema = {
  body?: SchemaField
  params?: SchemaField
  query?: SchemaField
  headers?: SchemaField
}

/** Optional response validators keyed by the HTTP status returned by the handler. */
export type RouteResponseSchemas = Record<number, SchemaField>

/**
 * Optional OpenAPI metadata for one route, read only by `orvaxis/openapi`. Nothing here is
 * inferred from the validators: a `parse` method cannot say whether a body is optional or which
 * media type it uses.
 */
export type RouteOpenApiMetadata = {
  operationId?: string
  summary?: string
  description?: string
  tags?: readonly string[]
  deprecated?: boolean
  /** Request body options; the body is required with `application/json` unless stated. */
  body?: { required?: boolean; mediaType?: string }
  /** Per-status options for responses already declared in `responses`. */
  responses?: Record<number, { description?: string; mediaType?: string }>
}

export type Route<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = {
  method: HttpMethod
  path: string
  handler: (ctx: OrvaxisContext<TState, TMeta>) => Promise<void> | void
  middleware?: Middleware<TState, TMeta>[]
  policies?: Policy<TState, TMeta>[]
  schema?: RouteSchema
  responses?: RouteResponseSchemas
  openapi?: RouteOpenApiMetadata
  /**
   * Deadline for this route in milliseconds, replacing the adapter's `timeout`; `0` disables it.
   * Applied by the built-in adapters.
   */
  timeout?: number
  /**
   * Largest request body accepted for this route, in bytes. The `node:http` adapter enforces it
   * exactly. On Express and Fastify the framework parses the body first under its own limit, so a
   * route can only lower it, checked against `Content-Length` (or, without one, the serialized
   * parsed body).
   */
  bodyLimit?: number
  /**
   * Declares that the route is intentionally reachable without a policy. Only consulted by
   * `denyByDefault`, `app.unprotectedRoutes()` and `app.assertProtected()`.
   */
  public?: boolean
}

export type ServerAdapter = {
  listen: (port: number, onListen?: (port: number) => void) => Promise<void>
  close: () => Promise<void>
}

export type Trace = {
  requestId: string
  events: TraceEvent[]
  startTime: number
  endTime?: number
  handlerExecuted?: boolean
  outcome?: "success" | "error"
  responseSentAtRuntimeEnd?: boolean
  responseCompletedAtRuntimeEnd?: boolean
}

export type TraceEvent = {
  type: string
  timestamp: number
  meta?: Record<string, unknown>
}

/**
 * Everything a plugin can reach. It is a dedicated object, not the runtime: a plugin cannot read
 * or replace the router, the other plugins or the hook lists.
 */
export type AroundStage = "request" | "handler"
export type AroundFunction = (ctx: OrvaxisContext, next: () => Promise<void>) => Promise<void>

export interface PluginContext {
  hooks: {
    on(name: HookName, fn: (ctx: OrvaxisContext, error?: Error) => Promise<void> | void): void
  }
  /** Register a global policy, as `app.policy()` does. */
  addPolicy(policy: Policy): void
  /** Add a global middleware, as `app.use()` does. */
  use(fn: Middleware): void
  /**
   * Wrap a stage of every request. `"request"` covers the whole execution (hooks, policies,
   * middleware, handler, error handling); `"handler"` covers only the route handler. `fn` must
   * call `next()` exactly once and return its promise; this is what lets a plugin keep an
   * `AsyncLocalStorage`-style context (such as OpenTelemetry's active span) active while that
   * stage runs. Wrappers nest in registration order, the first one outermost.
   */
  around(stage: AroundStage, fn: AroundFunction): void
  /** Run `fn` when `app.close()` is called (and by the adapters' `close()`), in reverse order of registration. */
  onClose(fn: () => Promise<void> | void): void
}
