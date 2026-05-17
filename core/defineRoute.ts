import type { OrvaxisContext, Route, RouteSchema } from "../types"

type ZodLike<T> = { parse(data: unknown): T }

type RouteWithTypedBody<
  TBody,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
> = Omit<Route<TState, TMeta>, "handler"> & {
  schema: RouteSchema & { body: ZodLike<TBody> }
  handler: (ctx: OrvaxisContext<TState, TMeta> & { req: { body: TBody } }) => Promise<void> | void
}

export function defineRoute<
  TBody,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMeta extends Record<string, unknown> = Record<never, never>,
>(route: RouteWithTypedBody<TBody, TState, TMeta>): Route<TState, TMeta> {
  const { handler, ...rest } = route
  return {
    ...rest,
    // Safe: schemaValidationPlugin narrows body to TBody at runtime before the handler runs.
    // The cast is scoped to this property only; all other Route fields are verified above.
    handler: handler as unknown as Route<TState, TMeta>["handler"],
  }
}
