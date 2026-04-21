import type { Group, OrvaxisRequest } from "../types"

export function validateRequest(req: OrvaxisRequest): void {
  if (typeof req.path !== "string" || req.path === "") {
    throw Object.assign(new Error("req.path must be a non-empty string"), { status: 400 })
  }
  if (!req.path.startsWith("/")) {
    throw Object.assign(new Error(`req.path must start with '/': "${req.path}"`), { status: 400 })
  }
  if (typeof req.method !== "string" || req.method === "") {
    throw Object.assign(new Error("req.method must be a non-empty string"), { status: 400 })
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
