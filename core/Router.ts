import type { Group, Route, RouteInfo, RouteMatch } from "../types"
import { HttpError } from "./HttpError"
import { validateGroup } from "./validation"

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new HttpError(400, `Malformed percent-encoding in path segment: "${segment}"`)
  }
}

type WildcardChild = {
  name: string
  match: { route: Route; group: Group }
}

type TrieNode = {
  children: Map<string, TrieNode>
  paramChild?: { node: TrieNode; name: string }
  wildcardChild?: WildcardChild
  match?: { route: Route; group: Group }
}

function createNode(): TrieNode {
  return { children: new Map() }
}

class Trie {
  private roots = new Map<string, TrieNode>()

  insert(method: string, pattern: string, route: Route, group: Group): void {
    const methodUpper = method.toUpperCase()
    let root = this.roots.get(methodUpper)
    if (!root) {
      root = createNode()
      this.roots.set(methodUpper, root)
    }

    const segments = pattern.split("/").filter(Boolean)
    let node = root

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]

      if (segment.startsWith("*")) {
        if (i !== segments.length - 1) {
          throw new TypeError(
            `Wildcard segment "${segment}" must be the last segment in pattern "${pattern}"`
          )
        }
        if (node.wildcardChild) {
          throw new TypeError(`Duplicate route: ${methodUpper} ${pattern}`)
        }
        const name = segment.length > 1 ? segment.slice(1) : "*"
        node.wildcardChild = { name, match: { route, group } }
        return
      }

      if (segment.startsWith(":")) {
        const name = segment.slice(1)
        if (!node.paramChild) {
          node.paramChild = { node: createNode(), name }
        } else if (node.paramChild.name !== name) {
          throw new TypeError(
            `Route conflict: ${methodUpper} ${pattern} — param ":${name}" conflicts with ":${node.paramChild.name}" already registered at this position`
          )
        }
        node = node.paramChild.node
      } else {
        let child = node.children.get(segment)
        if (!child) {
          child = createNode()
          node.children.set(segment, child)
        }
        node = child
      }
    }

    if (node.match) {
      throw new TypeError(`Duplicate route: ${methodUpper} ${pattern}`)
    }
    node.match = { route, group }
  }

  match(method: string, path: string): RouteMatch | null {
    const root = this.roots.get(method.toUpperCase())
    if (!root) return null

    const segments = path.split("/").filter(Boolean)
    return this.traverse(root, segments, 0, {})
  }

  allowedMethods(path: string): string[] {
    const segments = path.split("/").filter(Boolean)
    const methods: string[] = []
    for (const [method, root] of this.roots) {
      if (this.traverse(root, segments, 0, {}) !== null) {
        methods.push(method)
      }
    }
    return methods
  }

  private traverse(
    node: TrieNode,
    segments: string[],
    index: number,
    params: Record<string, string>
  ): RouteMatch | null {
    if (index === segments.length) {
      return node.match ? { ...node.match, params: { ...params } } : null
    }

    const segment = segments[index]

    // 1. Static — most specific
    const staticChild = node.children.get(segment)
    if (staticChild) {
      const result = this.traverse(staticChild, segments, index + 1, params)
      if (result) return result
    }

    // 2. Param — one segment, backtrack if deeper match fails
    if (node.paramChild) {
      const decoded = decodeSafe(segment)
      params[node.paramChild.name] = decoded
      const result = this.traverse(node.paramChild.node, segments, index + 1, params)
      if (result) return result
      delete params[node.paramChild.name]
    }

    // 3. Wildcard — consumes all remaining segments (least specific)
    if (node.wildcardChild) {
      params[node.wildcardChild.name] = segments.slice(index).map(decodeSafe).join("/")
      return { ...node.wildcardChild.match, params: { ...params } }
    }

    return null
  }
}

export class Router {
  private groups: Group[] = []
  private trie = new Trie()

  group(group: Group) {
    validateGroup(group)
    this.groups.push(group)

    for (const route of group.routes) {
      this.trie.insert(route.method, group.prefix + route.path, route, group)
    }
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
    const result = this.trie.match(req.method, path)
    if (result) return result
    if (req.method.toUpperCase() === "HEAD") return this.trie.match("GET", path)
    return null
  }

  allowedMethods(path: string): string[] {
    const normalized = path.replace(/\/+/g, "/")
    const methods = this.trie.allowedMethods(normalized)
    if (methods.includes("GET") && !methods.includes("HEAD")) {
      methods.push("HEAD")
    }
    return methods
  }
}
