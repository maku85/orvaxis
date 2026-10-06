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

### Package check

```bash
pnpm build && pnpm check:package            # full check; installs peers from the npm registry
pnpm build && node scripts/check-package.mjs --no-peers   # tarball + peer-less consumer only
```

`check:package` runs `npm pack` and inspects the tarball (only `dist/` plus `package.json`, `README.md`, `LICENSE`; no sources or tests; every file named by `main`, `types` and `exports` present; size and file-count budgets). It then installs *only that tarball* into temporary consumers outside the repository: one without peers (core, testing and OpenAPI work; the integration subpaths must fail naming the missing peer), one with Express 4, and one with Express 5, Fastify 5 and OpenTelemetry. Each consumer runs a CJS script, an ESM script and a NodeNext type-check for every subpath, and all temporary directories are removed even on failure. CI, `prepublishOnly` and `scripts/release.sh` run it. Adding a subpath to `exports` makes the check fail until it is exercised in `scripts/check-package.mjs`.

### Compatibility matrix

```bash
pnpm test:compat       # adapter tests per target: Express 4, Express 5, Fastify 5
pnpm typecheck:compat  # Express adapter compiled against @types/express 4
```

`test:compat` aliases the `express` import to the `express4` / `express5` dev dependencies and runs `tests/httpAdapters.test.ts` (real sockets) plus the adapter suites; Fastify runs against the installed `fastify` 5. Express runtime and types are separate: the default type-check uses `@types/express` 5 and `typecheck:compat` uses `@types/express` 4. CI runs both on Node 22.13.0 (declared minimum) and Node 24 (latest LTS when this was written).

Not covered, on purpose: the lowest declared peer versions (Express 4.20.0, Fastify 5.0.0) — the matrix uses the latest of each declared major; other Node versions; the Express guard has no Fastify counterpart.

## Project metadata

One product description is used everywhere: `package.json` `description` is the source, the documentation site reads it for its `<meta>` and link-preview tags, and the README tagline says the same thing in short. When it changes, change it in `package.json`; `pnpm check:docs-assets` fails if the site's home page description drifts, if a page's `og:image` or `twitter:image` is not an absolute `https://maku85.github.io/orvaxis/` URL, or if the image is missing from the build.

Assets: `assets/orvaxis-banner.webp` (1536×1024, about 80 kB) is the single banner source. The README loads it from `raw.githubusercontent.com` so GitHub and npm show the same file, and the site imports it from `assets/`. `docs/public/social-card.jpg` (1200×630) is the link-preview image. Regenerate them from the original artwork rather than editing them.

Repository settings are not part of the code and are changed by a maintainer in GitHub, not by a commit. Suggested values, consistent with the package:

- **Description:** Structured, observable and testable execution runtime for Node.js APIs: routing, policies, middleware, typed contracts, tracing and testing, with Express and Fastify adapters.
- **Website:** https://maku85.github.io/orvaxis/
- **Topics:** `nodejs`, `typescript`, `express`, `fastify`, `middleware`, `policy-engine`, `authorization`, `openapi`, `opentelemetry`, `observability`, `testing`, `api`
- **Social preview:** upload `docs/public/social-card.jpg` (1200×630) under Settings → General → Social preview.

Orvaxis is a library, not an IAM service or a hosted backend; do not describe it as either.

## Releasing

Maintainers release from `main` with a clean tree, an authenticated npm session (`npm login`; the script never reads or stores credentials), and release notes written under `## [Unreleased]` in `CHANGELOG.md`.

```bash
bash scripts/release.sh minor --check-only   # validate everything, change nothing
bash scripts/release.sh minor --prepare-only # local commit + tag + verified tarball, nothing public
pnpm release:minor                           # the whole flow (also: release, release:major, release:alpha)
bash scripts/release.sh --resume             # continue an interrupted or prepared release
```

Git and npm are not one transaction, so the flow is ordered so that the only irreversible step happens last-but-one and every earlier step can be abandoned:

1. **Prepare** (local only). Validates the bump (`patch`, `minor`, `major`, or a `pre*` bump), the dist-tag (a `pre*` bump needs a non-`latest` tag and vice versa), the branch, that the branch is not behind `origin`, that npm is authenticated, and that the next version is neither tagged (locally or on `origin`) nor already on the registry. Then it runs every check, bumps the version, stamps the changelog (the new section must not be empty, since it becomes the GitHub release notes), commits `chore: release vX.Y.Z`, creates the annotated tag, builds, packs, and verifies the tarball (its `package.json` version and `dist/`).
2. **Publish.** `npm publish` of that exact tarball. If the version is already on the registry the step is skipped, never repeated.
3. **Finalize.** Pushes the branch and only the `vX.Y.Z` tag, refusing if `origin` already has that tag at another commit. The tag push triggers the GitHub Release workflow, so it only runs for versions that exist on npm.

### If something fails

| Where it failed | State | What to do |
|---|---|---|
| Validation or any check | Nothing changed (a failed bump or changelog stamp restores `package.json` and `CHANGELOG.md`) | Fix the reported cause and run again |
| `--prepare-only` finished | Local commit and tag only | `--resume` to continue, or abandon with `git tag -d vX.Y.Z && git reset --hard HEAD~1` |
| `npm publish` failed | Nothing public, nothing pushed | Check `npm view orvaxis@X.Y.Z version`. If absent, fix the cause (login, OTP, network) and `--resume`. If present, `--resume` skips publishing and pushes |
| Push failed after publishing | Package public, git not | Fix the cause (permissions, protected branch, diverged remote) and `--resume`. Do not publish again |
| Version already published, or tag exists remotely elsewhere | Refused before any change or publish | Choose a new version; resolve a conflicting remote tag manually |

`--resume` only works on the release commit (`HEAD` is the commit tagged for `package.json`'s version) and does just what is missing. The procedure never regenerates or overwrites a published version, never deletes remote tags, and never pushes other local tags. A published npm version cannot be changed: fix problems with a new version. `tests/releaseScript.test.ts` exercises all of these paths against local git repositories with stubbed `npm publish`, so no test publishes or pushes anywhere real.

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
