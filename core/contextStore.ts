import { AsyncLocalStorage } from "node:async_hooks"
import type { OrvaxisContext } from "../types"

const storage = new AsyncLocalStorage<OrvaxisContext>()

export function runWithContext<T>(ctx: OrvaxisContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export function getContext(): OrvaxisContext | undefined {
  return storage.getStore()
}
