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
  if ! grep -q '^## \[Unreleased\]$' CHANGELOG.md; then
    echo "error: CHANGELOG.md has no '## [Unreleased]' heading to stamp — add release notes there before releasing" >&2
    exit 1
  fi
  TODAY=$(date +%Y-%m-%d)
  # awk (not sed -i) to avoid GNU/BSD -i flag incompatibilities, and because this needs
  # to both rename the heading and leave a fresh, empty "## [Unreleased]" above it for
  # the next release — a single sed substitution can't consume-and-replace in one pass.
  awk -v ver="$VERSION" -v today="$TODAY" '
    /^## \[Unreleased\]$/ { print; print ""; print "## [" ver "] - " today; next }
    { print }
  ' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md
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
