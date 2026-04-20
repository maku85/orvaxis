import type { Trace } from "../types"

export class Tracer {
  private trace: Trace

  constructor(requestId: string) {
    this.trace = {
      requestId,
      events: [],
      startTime: Date.now(),
    }
  }

  event(type: string, meta?: Record<string, any>) {
    this.trace.events.push({
      type,
      timestamp: Date.now(),
      meta,
    })
  }

  end() {
    this.trace.endTime = Date.now()
    return this.trace
  }
}
