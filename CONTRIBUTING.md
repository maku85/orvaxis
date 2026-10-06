# Contributing to Orvaxis

Thank you for your interest in contributing. This guide covers setup, workflow, and conventions.

## Prerequisites

- Node.js >= 22.13.0 (matches `package.json` and CI)
- [pnpm](https://pnpm.io) 11.1.2 (matches the `packageManager` field and CI)

## Setup

```bash
git clone https://github.com/maku85/orvaxis.git
cd orvaxis
pnpm install
```

## Development workflow

| Command | Description |
|---|---|
| `pnpm build` | Compile CommonJS and ESM distributions (same as CI) |
| `pnpm check:package` | After build, verify CJS/ESM imports and NodeNext declarations in an isolated consumer without optional peers |
| `pnpm test` | Run the test suite |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm check` | Biome lint and format checks (same command as CI) |
| `pnpm tsc --noEmit` | Type-check source without emitting files (same as CI) |
| `pnpm typecheck:tests` | Type-check public API usage examples (same as CI) |
| `pnpm check:tenant-demo` | Verify multi-tenant policy requirements, traces, and permission matrix (same as CI) |
| `pnpm docs:dev` | Run the documentation site locally with hot reload |
| `pnpm docs:build` | Build the static documentation site |
| `pnpm docs:preview` | Preview the production documentation build |

## Project structure

```
core/        Runtime, Orvaxis class, context, hooks, pipeline
http/        Express and Fastify adapters
middleware/  Built-in middleware (tracing, etc.)
plugins/     Plugin system and built-in plugins
debug/       Execution summary and trace utilities
types/       Shared TypeScript types
tests/       Unit tests (mirrors source structure)
```

## Code conventions

- **TypeScript strict mode** — no `any`, no type assertions unless unavoidable.
- **Biome** handles formatting and linting. Run `pnpm check` before committing.
- **No comments** unless the *why* is non-obvious from the code itself.
- **No new dependencies** without discussion — keep the core footprint small.

Documentation examples are expected to match exported APIs and current runtime behavior. Run the quickstart command after changing its source or instructions.

The documentation site uses VitePress and lives in `docs/`. Run `pnpm docs:dev` while editing pages, then `pnpm docs:build` to catch broken internal links and build errors. Generated output and cache files under `docs/.vitepress/` are not committed.

## Publishing the documentation

The `Documentation` workflow builds the site on pull requests and deploys it after pushes to `main`. To enable the first deployment, open the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**, and ensure the `github-pages` environment is available. The workflow creates a Pages deployment using the repository token; no deployment secret is required. The project site is served from `https://maku85.github.io/orvaxis/`, matching `base` in `docs/.vitepress/config.mts`.

## Testing

All changes must include tests. Tests live in `tests/` and use [Vitest](https://vitest.dev).

```bash
pnpm test             # run all tests
pnpm test:coverage    # check coverage (target: >90%)
pnpm exec tsx examples/quickstart.ts  # run the documented Express quickstart
```

Coverage is tracked via v8 over `core`, `debug`, `http`, `middleware`, `openapi` and `plugins`. The global floor is 90% lines and 80% branches; `http/**` (adapters) and `openapi/**` have their own floors in `vitest.config.ts` because their failures cross a process boundary. Regressions in coverage require justification.

### Compatibility matrix

```bash
pnpm test:compat       # adapter tests per target: Express 4, Express 5, Fastify 5
pnpm typecheck:compat  # Express adapter compiled against @types/express 4
```

`test:compat` aliases the `express` import to the `express4` / `express5` dev dependencies and runs `tests/httpAdapters.test.ts` (real sockets) plus the adapter suites; Fastify runs against the installed `fastify` 5. Express runtime and types are separate: the default type-check uses `@types/express` 5 and `typecheck:compat` uses `@types/express` 4. CI runs both on Node 22.13.0 (declared minimum) and Node 24 (latest LTS when this was written).

Not covered, on purpose: the lowest declared peer versions (Express 4.20.0, Fastify 5.0.0) — the matrix uses the latest of each declared major; other Node versions; the Express guard has no Fastify counterpart.

## Submitting a pull request

1. Fork the repository and create a branch from `main`.
2. Make your changes and ensure all checks pass.
3. Open a PR against `main` using the provided template.
4. A maintainer will review as soon as possible.

For significant changes (new APIs, architectural shifts), open an issue first to discuss the approach.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat: add timeout support to PolicyEngine
fix: handle empty middleware array in Pipeline
docs: update adapter examples in README
```

## Reporting bugs / requesting features

Use the GitHub issue templates. Blank issues are disabled — please use the appropriate form.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
