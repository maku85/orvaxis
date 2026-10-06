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
  routes: Route<TState, TMeta>[]
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
  /** Static policy configuration only; no policy, predicate, or handler is executed. */
  policies: PolicyInspection[]
  schema?: RouteSchema
  responses?: RouteResponseSchemas
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

export type OrvaxisContext<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = {
  req: OrvaxisRequest
  res: OrvaxisResponse
  state: TState
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

export type SchemaField<TOutput = unknown> = {
  parse(data: unknown): TOutput
}

export type RouteSchema = {
  body?: SchemaField
  params?: SchemaField
  query?: SchemaField
  headers?: SchemaField
}

/** Optional response validators keyed by the HTTP status returned by the handler. */
export type RouteResponseSchemas = Record<number, SchemaField>

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

export interface PluginContext {
  hooks: {
    on(name: HookName, fn: (ctx: OrvaxisContext, error?: Error) => Promise<void> | void): void
  }
}
