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
| `pnpm test` | Run the test suite |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm check` | Biome lint and format checks (same command as CI) |
| `pnpm tsc --noEmit` | Type-check source without emitting files (same as CI) |
| `pnpm typecheck:tests` | Type-check public API usage examples (same as CI) |
| `pnpm check:tenant-demo` | Verify multi-tenant policy requirements, traces, and permission matrix (same as CI) |

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

## Testing

All changes must include tests. Tests live in `tests/` and use [Vitest](https://vitest.dev).

```bash
pnpm test             # run all tests
pnpm test:coverage    # check coverage (target: >90%)
pnpm exec tsx examples/quickstart.ts  # run the documented Express quickstart
```

Coverage is tracked via v8. Regressions in coverage require justification.

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
