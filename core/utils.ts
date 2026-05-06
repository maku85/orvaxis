export const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"])

export function mergeSafe(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    if (!UNSAFE_KEYS.has(key)) target[key] = source[key]
  }
}
