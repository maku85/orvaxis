/**
 * Why a request's `AbortSignal` was aborted by an adapter because nobody is waiting for the result
 * anymore: the deadline expired (a 408 is sent) or the client went away. Shutdown aborts are
 * deliberately different (a plain abort): requests already running are allowed to finish.
 */
export class RequestAbandonedError extends Error {
  readonly reason: "timeout" | "disconnect"

  constructor(reason: "timeout" | "disconnect") {
    super(reason === "timeout" ? "Request timed out" : "Client disconnected")
    this.name = "RequestAbandonedError"
    this.reason = reason
  }
}

export function abandonRequest(
  controller: AbortController,
  reason: RequestAbandonedError["reason"]
): void {
  controller.abort(new RequestAbandonedError(reason))
}

/** True once an adapter has given up on the request; the runtime stops before the next stage. */
export function isRequestAbandoned(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && signal.reason instanceof RequestAbandonedError
}
