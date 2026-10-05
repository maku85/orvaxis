import type { OrvaxisContext, OrvaxisRequest, Route, RouteSchema } from "../types/index.js"

type ZodLike<T> = { parse(data: unknown): T }

type OutputOf<TSchema> = TSchema extends { parse(data: unknown): infer TOutput } ? TOutput : never

type SchemaOutput<
  TSchema extends RouteSchema,
  TField extends keyof RouteSchema,
  TFallback,
> = TField extends keyof TSchema ? OutputOf<NonNullable<TSchema[TField]>> : TFallback

type TypedRequest<TSchema extends RouteSchema> = Omit<
  OrvaxisRequest,
  "body" | "query" | "headers"
> &
  (TSchema extends { body: infer TBody }
    ? { body: OutputOf<TBody> }
    : Pick<OrvaxisRequest, "body">) &
  (TSchema extends { query: infer TQuery }
    ? { query: OutputOf<TQuery> }
    : Pick<OrvaxisRequest, "query">) &
  (TSchema extends { headers: infer THeaders }
    ? { headers: OutputOf<THeaders> }
    : Pick<OrvaxisRequest, "headers">)

type TypedRouteContext<
  TSchema extends RouteSchema,
  TState extends Record<string, unknown>,
  TMeta extends Record<string, unknown>,
> = Omit<OrvaxisContext<TState, TMeta>, "req" | "params" | "meta"> & {
  req: TypedRequest<TSchema>
  readonly params: SchemaOutput<TSchema, "params", Record<string, string>>
  meta: Omit<OrvaxisContext<TState, TMeta>["meta"], "route"> & {
    route?: NonNullable<OrvaxisContext<TState, TMeta>["meta"]["route"]> & {
      params: SchemaOutput<TSchema, "params", Record<string, string>>
    }
  }
}

type RouteWithTypedSchema<
  TSchema extends RouteSchema,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = Omit<Route<TState, TMeta>, "handler" | "schema"> & {
  schema: TSchema
  handler: (ctx: TypedRouteContext<TSchema, TState, TMeta>) => Promise<void> | void
}

type RouteWithTypedBody<
  TBody,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = Omit<Route<TState, TMeta>, "handler"> & {
  schema: RouteSchema & { body: ZodLike<TBody> }
  handler: (ctx: OrvaxisContext<TState, TMeta> & { req: { body: TBody } }) => Promise<void> | void
}

const typedRouteMarker = Symbol("orvaxis.typedRoute")

/** Internal runtime guard used to ensure the declared schemas are actually parsed. */
export function isTypedRoute(route: Route): boolean {
  return (route as Route & { [typedRouteMarker]?: true })[typedRouteMarker] === true
}

/**
 * Define a route whose handler receives the output types of its runtime schemas.
 * Register `schemaValidationPlugin` or requests to this route fail with HTTP 500.
 */
export function defineRoute<
  TSchema extends RouteSchema,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
>(route: RouteWithTypedSchema<TSchema, TState, TMeta>): Route<TState, TMeta>

/** Retained for callers that pass an explicit body type argument. */
export function defineRoute<
  TBody,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
>(route: RouteWithTypedBody<TBody, TState, TMeta>): Route<TState, TMeta>

export function defineRoute<
  TSchema extends RouteSchema,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
>(
  route: RouteWithTypedSchema<TSchema, TState, TMeta> | RouteWithTypedBody<unknown, TState, TMeta>
) {
  const { handler, ...rest } = route
  const typed = {
    ...rest,
    handler: handler as unknown as Route<TState, TMeta>["handler"],
  } as Route<TState, TMeta> & { [typedRouteMarker]?: true }
  Object.defineProperty(typed, typedRouteMarker, { value: true, enumerable: true })
  return typed
}
