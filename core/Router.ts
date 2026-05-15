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

type TrieNode = {
  children: Map<string, TrieNode>
  paramChild?: { node: TrieNode; name: string }
  match?: { route: Route; group: Group }
}

function createNode(): TrieNode {
  return { children: new Map() }
}

class Trie {
  private roots = new Map<string, TrieNode>()

  insert(method: string, pattern: string, route: Route, group: Group): void {
    let root = this.roots.get(method)
    if (!root) {
      root = createNode()
      this.roots.set(method, root)
    }

    const segments = pattern.split("/").filter(Boolean)
    let node = root

    for (const segment of segments) {
      if (segment.startsWith(":")) {
        const name = segment.slice(1)
        if (!node.paramChild) {
          node.paramChild = { node: createNode(), name }
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

    node.match = { route, group }
  }

  match(method: string, path: string): RouteMatch | null {
    const root = this.roots.get(method)
    if (!root) return null

    const segments = path.split("/").filter(Boolean)
    return this.traverse(root, segments, 0, {})
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

    // Static segments take priority over param segments
    const staticChild = node.children.get(segment)
    if (staticChild) {
      const result = this.traverse(staticChild, segments, index + 1, params)
      if (result) return result
    }

    // Param segment as fallback — backtrack if deeper match fails
    if (node.paramChild) {
      const decoded = decodeSafe(segment)
      params[node.paramChild.name] = decoded
      const result = this.traverse(node.paramChild.node, segments, index + 1, params)
      if (result) return result
      delete params[node.paramChild.name]
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
    return this.trie.match(req.method, path)
  }
}
