import { getContext } from "../core/contextStore"

export function traceEvent(type: string, meta?: Record<string, unknown>): void {
  getContext()?.meta.tracer?.event(type, meta)
}
