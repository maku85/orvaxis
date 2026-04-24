export type DebugEntry = {
  event: string
  time: number
  meta?: Record<string, unknown>
}

export type DebugInfo = {
  timeline: DebugEntry[]
}

export interface TracerLike {
  event: (type: string, meta?: Record<string, unknown>) => void
}

export interface OrvaxisRequest {
  path: string
  method: string
  headers: Record<string, string | string[] | undefined>
  id?: string
  [key: string]: unknown
}

export interface OrvaxisResponse {
  statusCode: number
  sent: boolean
  status(code: number): OrvaxisResponse
  json(body: unknown): void
  send(body: unknown): void
  setHeader(name: string, value: string | string[]): OrvaxisResponse
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

export type HookName = "onRequest" | "beforePipeline" | "afterPipeline" | "onError"

export type Middleware<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = (ctx: OrvaxisContext<TState, TMeta>, next: NextFunction) => Promise<void> | void

export type NextFunction = () => Promise<void> | void

export type RouteInfo = {
  method: string
  path: string
  prefix: string
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
}

export type Policy<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = {
  name: string
  priority?: number
  scope?: PolicyScope
  evaluate: (ctx: OrvaxisContext<TState, TMeta>) => PolicyResult | Promise<PolicyResult>
}

export type PolicyResult =
  | { allow: true; modify?: Record<string, unknown> }
  | { allow: false; reason?: string; status?: number }

export type PolicyScope = {
  path?: string | RegExp
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"
}

export type Route<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = {
  method: string
  path: string
  handler: (ctx: OrvaxisContext<TState, TMeta>) => Promise<void> | void
  middleware?: Middleware<TState, TMeta>[]
  policies?: Policy<TState, TMeta>[]
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
}

export type TraceEvent = {
  type: string
  timestamp: number
  meta?: Record<string, unknown>
}
