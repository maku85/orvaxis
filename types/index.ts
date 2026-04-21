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
  [key: string]: unknown
}

export type Group = {
  prefix: string
  middleware?: Middleware[]
  policies?: Policy[]
  routes: Route[]
}

export type HookName = "onRequest" | "beforePipeline" | "afterPipeline" | "onError"

export type Middleware = (ctx: OrvaxisContext, next: NextFunction) => Promise<void> | void

export type NextFunction = () => Promise<void> | void

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

export type OrvaxisContext = {
  req: OrvaxisRequest
  res: OrvaxisResponse
  state: Record<string, unknown>
  meta: ContextMeta
  logs: string[]
  error?: Error
}

export type Policy = {
  name: string
  priority?: number
  scope?: PolicyScope
  evaluate: (ctx: OrvaxisContext) => PolicyResult | Promise<PolicyResult>
}

export type PolicyResult =
  | { allow: true; modify?: Record<string, unknown> }
  | { allow: false; reason?: string }

export type PolicyScope = {
  path?: string | RegExp
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"
}

export type Route = {
  method: string
  path: string
  handler: (ctx: OrvaxisContext) => Promise<void> | void
  middleware?: Middleware[]
  policies?: Policy[]
}

export type ServerAdapter = {
  listen: (port: number) => Promise<void>
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
