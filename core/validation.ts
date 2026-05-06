import type { Group, OrvaxisRequest } from "../types"
import { HttpError } from "./HttpError"

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

export function validateGroup(group: Group): void {
  if (typeof group.prefix !== "string" || group.prefix === "") {
    throw new TypeError("group.prefix must be a non-empty string")
  }
  if (!group.prefix.startsWith("/")) {
    throw new TypeError(`group.prefix must start with '/': "${group.prefix}"`)
  }
  if (group.prefix.length > 1 && group.prefix.endsWith("/")) {
    throw new TypeError(`group.prefix must not end with '/': "${group.prefix}"`)
  }
  for (const route of group.routes) {
    if (typeof route.path !== "string") {
      throw new TypeError(`route.path must be a string in group "${group.prefix}"`)
    }
    if (route.path !== "" && !route.path.startsWith("/")) {
      throw new TypeError(
        `route.path must start with '/': "${route.path}" in group "${group.prefix}"`
      )
    }
    if (typeof route.method !== "string" || route.method === "") {
      throw new TypeError(
        `route.method must be a non-empty string for path "${route.path}" in group "${group.prefix}"`
      )
    }
  }
}
