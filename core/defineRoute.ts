import type {
  HttpMethod,
  Middleware,
  OrvaxisContext,
  OrvaxisRequest,
  Policy,
  Route,
  RouteSchema,
} from "../types"

type ZodLike<T> = { parse(data: unknown): T }

type RouteWithTypedBody<
  TBody,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = {
  method: HttpMethod
  path: string
  schema: RouteSchema & { body: ZodLike<TBody> }
  handler: (
    ctx: OrvaxisContext<TState, TMeta> & { req: OrvaxisRequest & { body: TBody } }
  ) => Promise<void> | void
  middleware?: Middleware<TState, TMeta>[]
  policies?: Policy<TState, TMeta>[]
}

export function defineRoute<
  TBody,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
>(route: RouteWithTypedBody<TBody, TState, TMeta>): Route<TState, TMeta> {
  return route as unknown as Route<TState, TMeta>
}
