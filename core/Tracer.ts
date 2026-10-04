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
      handlerExecuted: false,
    }
  }

  markHandlerExecuted() {
    this.trace.handlerExecuted = true
  }

  event(type: string, meta?: Record<string, unknown>) {
    this.trace.events.push({
      type,
      timestamp: this.trace.startTime + (performance.now() - this._startPerf),
      meta,
    })
  }

  end(completion?: {
    outcome: "success" | "error"
    responseSentAtRuntimeEnd: boolean
    responseCompletedAtRuntimeEnd?: boolean
  }) {
    this.trace.endTime ??= this.trace.startTime + (performance.now() - this._startPerf)
    if (completion) {
      this.trace.outcome = completion.outcome
      this.trace.responseSentAtRuntimeEnd ??= completion.responseSentAtRuntimeEnd
      this.trace.responseCompletedAtRuntimeEnd ??= completion.responseCompletedAtRuntimeEnd
    }
    return this.trace
  }
}
