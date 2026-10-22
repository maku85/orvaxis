import type { Group, OrvaxisRequest } from "../types/index.js"
import { HttpError } from "./HttpError.js"

const VALID_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])

export function validateRequest(req: OrvaxisRequest): void {
  if (typeof req.path !== "string" || req.path === "") {
    throw new HttpError(400, "req.path must be a non-empty string")
  }
  if (!req.path.startsWith("/")) {
    throw new HttpError(400, `req.path must start with '/': "${req.path}"`)
  }
  if (typeof req.method !== "string" || req.method === "") {
    throw new HttpError(400, "req.method must be a non-empty string")
  }
}

function validateLimit(name: string, value: unknown, where: string): void {
  if (value === undefined) return
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number ${where}`)
  }
}

/** Validates a group and, recursively, its sub-groups. */
export function validateGroup(group: Group, parentPrefix?: string): void {
  if (typeof group.prefix !== "string" || group.prefix === "") {
    throw new TypeError("group.prefix must be a non-empty string")
  }
  if (!group.prefix.startsWith("/")) {
    throw new TypeError(`group.prefix must start with '/': "${group.prefix}"`)
  }
  if (group.prefix.length > 1 && group.prefix.endsWith("/")) {
    throw new TypeError(`group.prefix must not end with '/': "${group.prefix}"`)
  }
  const where = `in group "${parentPrefix ? joinPrefix(parentPrefix, group.prefix) : group.prefix}"`
  validateLimit("group.timeout", group.timeout, where)
  validateLimit("group.bodyLimit", group.bodyLimit, where)
  if (group.routes !== undefined && !Array.isArray(group.routes)) {
    throw new TypeError(`group.routes must be an array ${where}`)
  }
  if (group.groups !== undefined && !Array.isArray(group.groups)) {
    throw new TypeError(`group.groups must be an array ${where}`)
  }
  for (const route of group.routes ?? []) {
    if (typeof route.path !== "string") {
      throw new TypeError(`route.path must be a string in group "${group.prefix}"`)
    }
    if (route.path !== "" && !route.path.startsWith("/")) {
      throw new TypeError(
        `route.path must start with '/': "${route.path}" in group "${group.prefix}"`
      )
    }
    const rawMethod = route.method as unknown as string
    if (typeof rawMethod !== "string" || rawMethod === "") {
      throw new TypeError(
        `route.method must be a non-empty string for path "${route.path}" in group "${group.prefix}"`
      )
    }
    if (!VALID_METHODS.has(rawMethod.toUpperCase())) {
      throw new TypeError(
        `route.method "${route.method}" is not a valid HTTP method for path "${route.path}" in group "${group.prefix}"`
      )
    }
    validateLimit("route.timeout", route.timeout, `on ${route.method} ${route.path} ${where}`)
    validateLimit("route.bodyLimit", route.bodyLimit, `on ${route.method} ${route.path} ${where}`)
  }
  for (const child of group.groups ?? []) {
    validateGroup(child, parentPrefix ? joinPrefix(parentPrefix, group.prefix) : group.prefix)
  }
}

/** `/api` + `/v1` is `/api/v1`; a root prefix or a root child adds nothing. */
export function joinPrefix(parent: string, child: string): string {
  if (child === "/") return parent
  if (parent === "/") return child
  return parent + child
}
