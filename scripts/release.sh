#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   pnpm release           → patch release  (e.g. 0.2.0 → 0.2.1)
#   pnpm release:minor     → minor release  (e.g. 0.2.0 → 0.3.0)
#   pnpm release:major     → major release  (e.g. 0.2.0 → 1.0.0)
#   pnpm release:alpha     → alpha prerelease (e.g. 0.2.0 → 0.2.1-alpha.0)

BUMP=${1:-patch}
DIST_TAG=${2:-latest}

# ── guard: clean working tree ──────────────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is not clean — commit or stash changes first" >&2
  exit 1
fi

# ── checks + tests ────────────────────────────────────────────────────────────
pnpm run check
pnpm test

# ── bump version (no git operations yet) ──────────────────────────────────────
if [ "$DIST_TAG" != "latest" ]; then
  NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version --preid="$DIST_TAG")
else
  NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
fi
VERSION=${NEW_VERSION#v}

echo "releasing v$VERSION (tag: $DIST_TAG)"

# ── stamp changelog (stable releases only) ────────────────────────────────────
if [ "$DIST_TAG" = "latest" ]; then
  TODAY=$(date +%Y-%m-%d)
  # -i.bak (with an explicit, empty-able suffix) is the one -i syntax accepted by both
  # GNU sed (Linux) and BSD sed (macOS) — bare `-i "s/.../"` makes BSD sed treat the
  # script as the backup suffix and the filename as the script, failing with
  # "invalid command code C".
  sed -i.bak "s/^## \[Unreleased\]$/## [$VERSION] - $TODAY/" CHANGELOG.md
  rm -f CHANGELOG.md.bak
  git add package.json CHANGELOG.md
else
  git add package.json
fi

# ── commit + tag + push ───────────────────────────────────────────────────────
git commit -m "chore: release v$VERSION"
git tag -a "v$VERSION" -m "v$VERSION"
git push
git push --tags

# ── publish (prepublishOnly: check + tsc + test + build) ──────────────────────
npm publish --tag "$DIST_TAG"
