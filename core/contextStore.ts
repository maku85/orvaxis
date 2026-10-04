import { AsyncLocalStorage } from "node:async_hooks"
import type { OrvaxisContext } from "../types"

const storage = new AsyncLocalStorage<OrvaxisContext>()
const captureStorage = new AsyncLocalStorage<(ctx: OrvaxisContext) => void>()

export function runWithContext<T>(ctx: OrvaxisContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export function getContext(): OrvaxisContext | undefined {
  return storage.getStore()
}

export function captureContext(ctx: OrvaxisContext): void {
  captureStorage.getStore()?.(ctx)
}

export function runWithContextCapture<T>(capture: (ctx: OrvaxisContext) => void, fn: () => T): T {
  return captureStorage.run(capture, fn)
}
