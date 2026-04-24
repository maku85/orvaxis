import type { Group, RouteInfo, RouteMatch } from "../types"
import { validateGroup } from "./validation"

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw Object.assign(new Error(`Malformed percent-encoding in path segment: "${segment}"`), {
      status: 400,
    })
  }
}

function matchPath(pattern: string, actual: string): Record<string, string> | null {
  const patParts = pattern.split("/").filter(Boolean)
  const actParts = actual.split("/").filter(Boolean)

  if (patParts.length !== actParts.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(":")) {
      params[patParts[i].slice(1)] = decodeSafe(actParts[i])
    } else if (patParts[i] !== actParts[i]) {
      return null
    }
  }
  return params
}

export class Router {
  private groups: Group[] = []

  group(group: Group) {
    validateGroup(group)
    this.groups.push(group)
  }

  routes(): RouteInfo[] {
    const result: RouteInfo[] = []
    for (const group of this.groups) {
      for (const route of group.routes) {
        const path =
          group.prefix === "/"
            ? route.path || "/"
            : route.path
              ? group.prefix + route.path
              : group.prefix
        result.push({ method: route.method, path, prefix: group.prefix })
      }
    }
    return result
  }

  match(req: { path: string; method: string }): RouteMatch | null {
    const path = req.path.replace(/\/+/g, "/")
    const { method } = req

    for (const group of this.groups) {
      const prefix = group.prefix

      if (prefix !== "/" && path !== prefix && !path.startsWith(`${prefix}/`)) continue

      for (const route of group.routes) {
        if (route.method !== method) continue
        const params = matchPath(prefix + route.path, path)
        if (params !== null) return { route, group, params }
      }
    }

    return null
  }
}
