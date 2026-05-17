import type { Trace } from "../types"

export class Tracer {
  private readonly _startPerf: number
  private trace: Trace

  constructor(requestId: string) {
    this._startPerf = performance.now()
    this.trace = {
      requestId,
      events: [],
      startTime: Date.now(),
    }
  }

  event(type: string, meta?: Record<string, unknown>) {
    this.trace.events.push({
      type,
      timestamp: this.trace.startTime + (performance.now() - this._startPerf),
      meta,
    })
  }

  end() {
    this.trace.endTime = this.trace.startTime + (performance.now() - this._startPerf)
    return this.trace
  }
}
