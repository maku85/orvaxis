#!/usr/bin/env bash
set -euo pipefail

# Release in three recoverable phases. Git and npm are not one transaction, so the order puts the
# only irreversible step (publishing an immutable npm version) after everything that can be undone
# locally, and pushes to git only after the package exists:
#
#   1. prepare   validate, run all checks, bump, stamp the changelog, commit and tag LOCALLY,
#                pack the tarball and verify it. Nothing is public yet.
#   2. publish   `npm publish` of the exact verified tarball.
#   3. finalize  push the branch and ONLY this release's tag.
#
# Usage:
#   pnpm release                      patch release            (0.2.0 → 0.2.1)
#   pnpm release:minor                minor release            (0.2.0 → 0.3.0)
#   pnpm release:major                major release            (0.2.0 → 1.0.0)
#   pnpm release:alpha                alpha prerelease         (0.2.0 → 0.2.1-alpha.0)
#   scripts/release.sh <bump> [dist-tag] [--check-only | --prepare-only]
#   scripts/release.sh --resume [dist-tag]     continue a prepared or interrupted release
#
#   --check-only     validate prerequisites and the next version, change nothing
#   --prepare-only   stop after the local commit/tag and verified tarball (no npm, no push)
#   --resume         inspect git and npm and perform only the steps still missing
#
# Environment: RELEASE_BRANCH (default main), RELEASE_REMOTE (default origin).
# Credentials are never read or stored here; npm authenticates as it normally does.
# Recovery guide: CONTRIBUTING.md, "Releasing".

BRANCH=${RELEASE_BRANCH:-main}
REMOTE=${RELEASE_REMOTE:-origin}
RELEASE_DIR=.release

CHECK_ONLY=0
PREPARE_ONLY=0
RESUME=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    --prepare-only) PREPARE_ONLY=1 ;;
    --resume) RESUME=1 ;;
    --*) echo "error: unknown option $arg" >&2; exit 1 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

fail() { echo "error: $*" >&2; exit 1; }
info() { echo "→ $*"; }

if [ "$RESUME" = 1 ]; then
  DIST_TAG=${POSITIONAL[0]:-latest}
  BUMP=""
else
  BUMP=${POSITIONAL[0]:-patch}
  DIST_TAG=${POSITIONAL[1]:-latest}
fi

PACKAGE_NAME=$(node -p "require('./package.json').name")

# ── validation helpers ────────────────────────────────────────────────────────

validate_inputs() {
  if ! printf '%s' "$DIST_TAG" | grep -Eq '^[a-z][a-z0-9._-]*$'; then
    fail "dist-tag '$DIST_TAG' must start with a lowercase letter and contain only lowercase letters, digits, '.', '_' and '-'"
  fi
  if [ "$RESUME" = 1 ]; then return 0; fi
  IS_PRE=0
  case "$BUMP" in
    patch|minor|major) ;;
    prepatch|preminor|premajor|prerelease) IS_PRE=1 ;;
    *) fail "unknown bump '$BUMP' (patch, minor, major, prepatch, preminor, premajor, prerelease)" ;;
  esac
  if [ "$DIST_TAG" = "latest" ] && [ "$IS_PRE" = 1 ]; then
    fail "'$BUMP' would publish a prerelease as 'latest'; pass a dist-tag such as 'alpha'"
  fi
  if [ "$DIST_TAG" != "latest" ] && [ "$IS_PRE" = 0 ]; then
    fail "dist-tag '$DIST_TAG' needs a prerelease bump (prepatch, preminor, premajor or prerelease), not '$BUMP'"
  fi
}

ensure_clean_tree() {
  [ -z "$(git status --porcelain)" ] || fail "working tree is not clean — commit or stash changes first"
}

ensure_branch() {
  local current
  current=$(git rev-parse --abbrev-ref HEAD)
  [ "$current" = "$BRANCH" ] || fail "releases are made from '$BRANCH' (currently on '$current')"
}

ensure_in_sync() {
  git remote get-url "$REMOTE" >/dev/null 2>&1 || fail "git remote '$REMOTE' is not configured"
  git fetch --quiet "$REMOTE" || fail "could not fetch from '$REMOTE'"
  if git rev-parse --verify --quiet "$REMOTE/$BRANCH" >/dev/null; then
    [ "$(git rev-list --count "HEAD..$REMOTE/$BRANCH")" = 0 ] \
      || fail "'$BRANCH' is behind '$REMOTE/$BRANCH' — pull before releasing"
  fi
}

ensure_npm_access() {
  npm whoami >/dev/null 2>&1 \
    || fail "npm is not authenticated or the registry is unreachable — run 'npm login' (this script never stores credentials)"
}

# 0 = published, 1 = not published; anything else (network, auth) stops the release.
registry_has_version() {
  local out
  if out=$(npm view "$PACKAGE_NAME@$1" version 2>&1); then
    [ "$out" = "$1" ] && return 0
    fail "unexpected answer from the registry for $PACKAGE_NAME@$1: $out"
  fi
  case "$out" in
    *E404*|*"404 Not Found"*|*"is not in this registry"*) return 1 ;;
    *) fail "could not determine whether $PACKAGE_NAME@$1 exists: $out" ;;
  esac
}

remote_tag_sha() {
  git ls-remote --tags "$REMOTE" "refs/tags/$1" | awk 'NR==1 { print $1 }'
}

# Compute the next version without leaving changes behind (the tree is clean here).
compute_next_version() {
  local out
  if [ "$DIST_TAG" != "latest" ]; then
    out=$(npm version "$BUMP" --no-git-tag-version --preid="$DIST_TAG")
  else
    out=$(npm version "$BUMP" --no-git-tag-version)
  fi
  git checkout --quiet -- package.json
  echo "${out#v}"
}

ensure_version_is_new() {
  local version=$1
  if git rev-parse --verify --quiet "refs/tags/v$version" >/dev/null; then
    fail "tag v$version already exists locally"
  fi
  [ -z "$(remote_tag_sha "v$version")" ] || fail "tag v$version already exists on '$REMOTE'"
  if registry_has_version "$version"; then
    fail "$PACKAGE_NAME@$version is already published; versions are immutable — choose a new version"
  fi
}

run_checks() {
  pnpm run check
  pnpm exec tsc --noEmit
  pnpm run typecheck:tests
  pnpm run check:tenant-demo
  pnpm test
  pnpm run build
  pnpm run check:package
  pnpm run check:snippets
  pnpm run check:quickstart
  pnpm run test:examples
  pnpm run docs:build
}

# ── phase 1: prepare ──────────────────────────────────────────────────────────

BUMPED=0
restore_on_failure() {
  if [ "$BUMPED" = 1 ]; then
    git checkout --quiet -- package.json CHANGELOG.md 2>/dev/null || true
    echo "note: package.json and CHANGELOG.md were restored; no commit or tag was created" >&2
  fi
}
trap restore_on_failure EXIT

changelog_section_has_content() {
  awk -v ver="$1" '
    /^## \[/ { if (found) exit; if (index($0, "[" ver "]")) { found = 1 }; next }
    found && /[^[:space:]]/ { content = 1 }
    END { exit content ? 0 : 1 }
  ' CHANGELOG.md
}

verify_tarball() {
  local tarball=$1 version=$2 packed
  [ -f "$tarball" ] || fail "tarball $tarball was not created"
  packed=$(tar -xzOf "$tarball" package/package.json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")
  [ "$packed" = "$version" ] || fail "tarball contains version $packed, expected $version"
  tar -tzf "$tarball" | grep -q '^package/dist/' || fail "tarball has no dist/ files"
}

pack_tarball() {
  local version=$1
  mkdir -p "$RELEASE_DIR"
  find "$RELEASE_DIR" -maxdepth 1 -name '*.tgz' -delete
  npm pack --pack-destination "$RELEASE_DIR" >/dev/null
  TARBALL=$(find "$RELEASE_DIR" -maxdepth 1 -name '*.tgz' | head -n 1)
  verify_tarball "$TARBALL" "$version"
  info "verified tarball $TARBALL"
}

prepare() {
  validate_inputs
  ensure_clean_tree
  ensure_branch
  ensure_in_sync
  ensure_npm_access

  if [ "$DIST_TAG" = "latest" ] && ! grep -q '^## \[Unreleased\]$' CHANGELOG.md; then
    fail "CHANGELOG.md has no '## [Unreleased]' heading to stamp — add release notes there before releasing"
  fi

  VERSION=$(compute_next_version)
  ensure_version_is_new "$VERSION"
  info "releasing v$VERSION (dist-tag: $DIST_TAG)"

  if [ "$CHECK_ONLY" = 1 ]; then
    echo "check-only: prerequisites are satisfied for v$VERSION; nothing was changed"
    exit 0
  fi

  run_checks

  BUMPED=1
  if [ "$DIST_TAG" != "latest" ]; then
    npm version "$BUMP" --no-git-tag-version --preid="$DIST_TAG" >/dev/null
  else
    npm version "$BUMP" --no-git-tag-version >/dev/null
  fi
  [ "$(node -p "require('./package.json').version")" = "$VERSION" ] || fail "version changed unexpectedly during the bump"

  if [ "$DIST_TAG" = "latest" ]; then
    TODAY=$(date +%Y-%m-%d)
    # awk (not sed -i) to avoid GNU/BSD -i flag incompatibilities, and because this needs to both
    # rename the heading and leave a fresh, empty "## [Unreleased]" above it.
    awk -v ver="$VERSION" -v today="$TODAY" '
      /^## \[Unreleased\]$/ { print; print ""; print "## [" ver "] - " today; next }
      { print }
    ' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md
    # The GitHub release workflow publishes this section as the release notes.
    changelog_section_has_content "$VERSION" \
      || fail "the changelog section for $VERSION is empty — write the release notes under '## [Unreleased]' first"
    git add package.json CHANGELOG.md
  else
    git add package.json
  fi

  git commit --quiet -m "chore: release v$VERSION"
  BUMPED=0
  git tag -a "v$VERSION" -m "v$VERSION"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse "v$VERSION^{commit}")" ] || fail "tag v$VERSION does not point at the release commit"

  pnpm run build
  pack_tarball "$VERSION"
  info "prepared v$VERSION locally (commit $(git rev-parse --short HEAD), tag v$VERSION); nothing is public yet"
}

# ── phase 2: publish, phase 3: finalize ───────────────────────────────────────

publish() {
  local version=$1
  if registry_has_version "$version"; then
    info "$PACKAGE_NAME@$version is already on the registry; not publishing again"
    return 0
  fi
  ensure_npm_access
  info "publishing $PACKAGE_NAME@$version (dist-tag: $DIST_TAG)"
  if ! npm publish "$TARBALL" --tag "$DIST_TAG"; then
    cat >&2 <<MSG
error: npm publish failed. Nothing was pushed to git.
  First check whether the version reached the registry:  npm view $PACKAGE_NAME@$version version
  If it did not, fix the cause (login, OTP, network) and continue:  scripts/release.sh --resume $DIST_TAG
  If it did, run --resume: it will skip publishing and push. Never publish the same version twice.
MSG
    exit 1
  fi
}

# A tag that already exists remotely is fine only if it is this release's own tag.
ensure_remote_tag_compatible() {
  local tag=$1 remote_sha
  remote_sha=$(remote_tag_sha "$tag")
  if [ -n "$remote_sha" ] && [ "$remote_sha" != "$(git rev-parse "$tag")" ] && [ "$remote_sha" != "$(git rev-parse "$tag^{commit}")" ]; then
    fail "tag $tag already exists on '$REMOTE' at a different commit; resolve it manually, nothing was overwritten or published"
  fi
}

finalize() {
  local version=$1 tag="v$1"
  ensure_remote_tag_compatible "$tag"
  info "pushing $BRANCH and $tag to '$REMOTE' (no other tags)"
  if ! git push "$REMOTE" "$BRANCH" || ! git push "$REMOTE" "refs/tags/$tag"; then
    cat >&2 <<MSG
error: pushing to git failed AFTER the package was published.
  $PACKAGE_NAME@$version is public and cannot be changed. Do not publish again.
  Fix the cause (permissions, a protected branch, a diverged remote) and run:  scripts/release.sh --resume $DIST_TAG
MSG
    exit 1
  fi
}

# ── resume: do only what is still missing ─────────────────────────────────────

resume() {
  validate_inputs
  ensure_clean_tree
  ensure_branch
  VERSION=$(node -p "require('./package.json').version")
  local tag="v$VERSION"
  git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null \
    || fail "no local tag $tag: nothing to resume. Prepare a release first"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse "$tag^{commit}")" ] \
    || fail "HEAD is not the commit tagged $tag; resume only works on the release commit"
  [ "$(git log -1 --format=%s)" = "chore: release $tag" ] \
    || fail "HEAD is not a 'chore: release $tag' commit"
  git fetch --quiet "$REMOTE" || fail "could not fetch from '$REMOTE'"
  ensure_npm_access

  ensure_remote_tag_compatible "$tag"
  info "resuming $tag"
  pnpm run build
  pack_tarball "$VERSION"
  publish "$VERSION"
  finalize "$VERSION"
  info "released $PACKAGE_NAME@$VERSION"
}

if [ "$RESUME" = 1 ]; then
  resume
  exit 0
fi

prepare
if [ "$PREPARE_ONLY" = 1 ]; then
  echo "prepare-only: stopped before publishing. Continue with:  scripts/release.sh --resume $DIST_TAG"
  echo "To abandon instead:  git tag -d v$VERSION && git reset --hard HEAD~1"
  exit 0
fi
publish "$VERSION"
finalize "$VERSION"
info "released $PACKAGE_NAME@$VERSION"
