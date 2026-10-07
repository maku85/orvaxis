/**
 * Marks a request's `AbortSignal` as aborted by an adapter because nobody is waiting for the
 * result anymore: the deadline expired (a 408 is sent) or the client went away. Shutdown aborts are
 * deliberately different (a plain abort): requests already running are allowed to finish.
 *
 * The abort reason stays a standard `AbortError` DOMException, so code that checks
 * `error.name === "AbortError"` (for example around `fetch(url, { signal })`) keeps working; the
 * runtime tells abandonment apart through this module, not through the reason.
 */
export type AbandonReason = "timeout" | "disconnect"

const abandoned = new WeakMap<AbortSignal, AbandonReason>()

export function abandonRequest(controller: AbortController, reason: AbandonReason): void {
  if (controller.signal.aborted) return
  abandoned.set(controller.signal, reason)
  controller.abort(
    new DOMException(
      reason === "timeout" ? "Request timed out" : "Client disconnected",
      "AbortError"
    )
  )
}

/** True once an adapter has given up on the request; the runtime stops before the next stage. */
export function isRequestAbandoned(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && abandoned.has(signal)
}
