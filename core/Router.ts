import type { Group, RouteMatch } from "../types"
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

  match(req: { path: string; method: string }): RouteMatch | null {
    const { path, method } = req

    for (const group of this.groups) {
      const prefix = group.prefix

      if (path !== prefix && !path.startsWith(`${prefix}/`)) continue

      for (const route of group.routes) {
        if (route.method !== method) continue
        const params = matchPath(prefix + route.path, path)
        if (params !== null) return { route, group, params }
      }
    }

    return null
  }
}
