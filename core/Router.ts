import type {
  Group,
  HttpMethod,
  Policy,
  PolicyInspection,
  PolicyPhase,
  Route,
  RouteInfo,
  RouteInspection,
  RouteMatch,
} from "../types/index.js"
import { HttpError } from "./HttpError.js"
import { policyDeclarationId } from "./PolicyEngine.js"
import { normalizePath } from "./utils.js"
import { joinPrefix, validateGroup } from "./validation.js"

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

/**
 * A group as the router stores it: nested groups are flattened into one of these per level, with
 * the full prefix and the middleware, policies and limits inherited from their ancestors.
 */
type FlatGroup = Group & { routes: Route[] }

function flattenGroup(group: Group, parent?: FlatGroup): FlatGroup[] {
  const timeout = group.timeout ?? parent?.timeout
  const bodyLimit = group.bodyLimit ?? parent?.bodyLimit
  // A top-level group with routes is stored as declared, so `RouteMatch.group` stays the caller's
  // object; every other level is a new object carrying what it inherits.
  const self: FlatGroup = parent
    ? {
        prefix: joinPrefix(parent.prefix, group.prefix),
        middleware: [...(parent.middleware ?? []), ...(group.middleware ?? [])],
        policies: [...(parent.policies ?? []), ...(group.policies ?? [])],
        routes: group.routes ?? [],
        ...(timeout !== undefined ? { timeout } : {}),
        ...(bodyLimit !== undefined ? { bodyLimit } : {}),
      }
    : group.routes
      ? (group as FlatGroup)
      : { ...group, routes: [] }
  return [self, ...(group.groups ?? []).flatMap((child) => flattenGroup(child, self))]
}

type PolicyLayer = PolicyInspection["layer"]
type PolicySource = { policy: Policy; index: number; layer: PolicyLayer }

export function fullRoutePath(prefix: string, routePath: string): string {
  if (prefix === "/") return routePath || "/"
  return routePath ? prefix + routePath : prefix
}

function describeScope(policy: Policy): PolicyInspection["scope"] {
  const scope = policy.scope
  if (!scope) return undefined
  const path = scope.path
  return {
    ...(scope.method ? { method: scope.method } : {}),
    ...(path !== undefined
      ? {
          path:
            typeof path === "function"
              ? "predicate"
              : path instanceof RegExp
                ? path.toString()
                : path,
          pathType:
            typeof path === "function"
              ? "predicate"
              : path instanceof RegExp
                ? "regexp"
                : "literal",
        }
      : {}),
  }
}

function scopeApplicability(
  policy: Policy,
  routeMethod: HttpMethod,
  routePath: string,
  headFallbackAvailable: boolean
): PolicyInspection["applicability"] {
  const scope = policy.scope
  if (!scope) return { status: "always", reason: "no-scope" }
  if (scope.method) {
    const scopedMethod = scope.method.toUpperCase()
    const methodMatches = scopedMethod === routeMethod.toUpperCase()
    const matchesHeadFallback =
      routeMethod === "GET" && scopedMethod === "HEAD" && headFallbackAvailable
    if (!methodMatches && !matchesHeadFallback) {
      return { status: "never", reason: "method-mismatch" }
    }
    if (routeMethod === "GET" && headFallbackAvailable) {
      return { status: "conditional", reason: "method-alias" }
    }
  }
  const scopePath = scope.path
  if (scopePath === undefined) {
    return { status: "always", reason: scope.method ? "method-match" : "no-scope" }
  }
  if (typeof scopePath !== "string") return { status: "conditional", reason: "dynamic-path" }
  if (scopePath.includes("//") || routePath.includes("//")) {
    return { status: "conditional", reason: "dynamic-path" }
  }

  const routeSegments = routePath.split("/").filter(Boolean)
  const scopeSegments = scopePath.split("/").filter(Boolean)
  let dynamicBeforeMismatch = false
  for (let i = 0; i < scopeSegments.length; i++) {
    const routeSegment = routeSegments[i]
    if (routeSegment === undefined) return { status: "never", reason: "path-no-match" }
    if (routeSegment.startsWith("*")) {
      return { status: "conditional", reason: "dynamic-path" }
    }
    if (routeSegment.startsWith(":")) {
      dynamicBeforeMismatch = true
      continue
    }
    if (routeSegment !== scopeSegments[i]) {
      return dynamicBeforeMismatch
        ? { status: "conditional", reason: "dynamic-path" }
        : { status: "never", reason: "path-no-match" }
    }
  }

  if (scopePath.endsWith("/") && scopeSegments.length === routeSegments.length) {
    return { status: "conditional", reason: "dynamic-path" }
  }
  return dynamicBeforeMismatch
    ? { status: "conditional", reason: "dynamic-path" }
    : { status: "always", reason: "path-prefix" }
}

function inspectPolicies(
  sourcesByLayer: Record<PolicyLayer, Policy[]>,
  routeMethod: HttpMethod,
  routePath: string,
  headFallbackAvailable: boolean
): PolicyInspection[] {
  const sources: PolicySource[] = (Object.keys(sourcesByLayer) as PolicyLayer[]).flatMap((layer) =>
    sourcesByLayer[layer].map((policy, index) => ({ policy, index, layer }))
  )
  const counts = new Map<string, number>()
  for (const { policy } of sources) counts.set(policy.name, (counts.get(policy.name) ?? 0) + 1)

  const output: PolicyInspection[] = []
  const phases: PolicyPhase[] = ["preValidation", "postValidation"]
  const layers: PolicyLayer[] = ["global", "group", "route"]
  for (const phase of phases) {
    for (const layer of layers) {
      const ordered = sources
        .filter(({ policy, layer: sourceLayer }) => {
          return sourceLayer === layer && (policy.phase ?? "preValidation") === phase
        })
        .sort((a, b) => (b.policy.priority ?? 0) - (a.policy.priority ?? 0) || a.index - b.index)
      ordered.forEach(({ policy, index }, order) => {
        output.push({
          id: policyDeclarationId(layer, index),
          name: policy.name,
          nameAmbiguous: (counts.get(policy.name) ?? 0) > 1,
          layer,
          phase,
          priority: policy.priority ?? 0,
          order: order + 1,
          ...(phase === "postValidation" && policy.phase === "postValidation"
            ? { requires: policy.requires }
            : {}),
          ...(describeScope(policy) ? { scope: describeScope(policy) } : {}),
          applicability: scopeApplicability(policy, routeMethod, routePath, headFallbackAvailable),
        })
      })
    }
  }
  return output
}

export class Router {
  private groups: FlatGroup[] = []
  private trie = new Trie()

  group(group: Group) {
    validateGroup(group)
    const flat = flattenGroup(group)
    this.groups.push(...flat)
    this.generation++

    for (const g of flat) {
      for (const route of g.routes) {
        this.trie.insert(route.method, g.prefix + route.path, route, g)
      }
    }
  }

  routes(): RouteInfo[] {
    const result: RouteInfo[] = []
    for (const group of this.groups) {
      for (const route of group.routes) {
        const path = fullRoutePath(group.prefix, route.path)
        result.push({ method: route.method, path, prefix: group.prefix })
      }
    }
    return result
  }

  /** Bumped whenever a group is added, so cached per-route results can be discarded. */
  generation = 0

  inspectRoutes(globalPolicies: readonly Policy[] = []): RouteInspection[] {
    const result: RouteInspection[] = []
    for (const group of this.groups) {
      for (const route of group.routes) {
        result.push(this.inspectRoute(group, route, globalPolicies))
      }
    }
    return result
  }

  private inspectRoute(
    group: Group,
    route: Route,
    globalPolicies: readonly Policy[]
  ): RouteInspection {
    const path = fullRoutePath(group.prefix, route.path)
    const headFallbackAvailable =
      route.method === "GET" &&
      !this.groups.some((candidateGroup) =>
        candidateGroup.routes.some(
          (candidateRoute) =>
            candidateRoute.method === "HEAD" &&
            fullRoutePath(candidateGroup.prefix, candidateRoute.path) === path
        )
      )
    return {
      method: route.method,
      path,
      prefix: group.prefix,
      ...(route.public ? { public: true } : {}),
      ...(route.schema ? { schema: route.schema } : {}),
      ...(route.responses ? { responses: route.responses } : {}),
      ...(route.openapi ? { openapi: route.openapi } : {}),
      policies: inspectPolicies(
        {
          global: [...globalPolicies],
          group: group.policies ?? [],
          route: route.policies ?? [],
        },
        route.method,
        path,
        headFallbackAvailable
      ),
    }
  }

  /**
   * A route is covered when it is declared public, or when some policy applies to it
   * unconditionally. A policy whose scope depends on the request (a predicate, a RegExp, a path
   * under a parameter) does not count: it may not run for this route.
   */
  isCovered(group: Group, route: Route, globalPolicies: readonly Policy[]): boolean {
    if (route.public) return true
    return this.inspectRoute(group, route, globalPolicies).policies.some(
      (policy) => policy.applicability.status === "always"
    )
  }

  unprotectedRoutes(globalPolicies: readonly Policy[] = []): RouteInfo[] {
    const result: RouteInfo[] = []
    for (const group of this.groups) {
      for (const route of group.routes) {
        if (this.isCovered(group, route, globalPolicies)) continue
        result.push({
          method: route.method,
          path: fullRoutePath(group.prefix, route.path),
          prefix: group.prefix,
        })
      }
    }
    return result
  }

  /** The per-route `timeout` and `bodyLimit` that apply to a request, if it matches a route. */
  routeSettings(req: {
    path: string
    method: string
  }): { timeout?: number; bodyLimit?: number } | undefined {
    const match = this.match(req)
    if (!match) return undefined
    const timeout = match.route.timeout ?? match.group.timeout
    const bodyLimit = match.route.bodyLimit ?? match.group.bodyLimit
    if (timeout === undefined && bodyLimit === undefined) return undefined
    return {
      ...(timeout !== undefined ? { timeout } : {}),
      ...(bodyLimit !== undefined ? { bodyLimit } : {}),
    }
  }

  match(req: { path: string; method: string }): RouteMatch | null {
    const path = normalizePath(req.path)
    const result = this.trie.match(req.method, path)
    if (result) return result
    if (req.method.toUpperCase() === "HEAD") return this.trie.match("GET", path)
    return null
  }

  allowedMethods(path: string): string[] {
    const normalized = normalizePath(path)
    const methods = this.trie.allowedMethods(normalized)
    if (methods.includes("GET") && !methods.includes("HEAD")) {
      methods.push("HEAD")
    }
    return methods
  }
}
