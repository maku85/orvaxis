import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// End-to-end tests of scripts/release.sh against real git repositories (a working clone and a
// bare "remote" on disk). `pnpm` is a logging stub and `npm` is a stub for whoami/view/publish
// that delegates version/pack to the real npm, so nothing is ever published or pushed anywhere.
const script = resolve("scripts/release.sh")
const realNpm = spawnSync("sh", ["-c", "command -v npm"], { encoding: "utf8" }).stdout.trim()
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const changelog = (notes = "- Something changed.") =>
  `# Changelog\n\n## [Unreleased]\n\n${notes}\n\n## [0.3.0] - 2026-01-01\n\n- Earlier.\n`

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function executable(path: string, body: string) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

function setup(options: { changelog?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "orvaxis-release-test-"))
  roots.push(root)
  const remote = join(root, "remote.git")
  const work = join(root, "work")
  const bin = join(root, "bin")
  const log = join(root, "events.log")
  const registry = join(root, "registry.txt")
  mkdirSync(bin)
  mkdirSync(work)
  writeFileSync(log, "")
  writeFileSync(registry, "")

  git(root, "init", "--bare", "-b", "main", remote)
  // The remote logs every push it accepts so tests can order npm and git events.
  writeFileSync(
    join(remote, "hooks/pre-receive"),
    `#!/bin/sh\nif [ -e "${root}/reject-push" ]; then echo "remote rejected the push" >&2; exit 1; fi\necho "git-push" >> "${log}"\n`,
    { mode: 0o755 }
  )

  git(work, "init", "-b", "main")
  git(work, "config", "user.email", "test@example.com")
  git(work, "config", "user.name", "Test")
  mkdirSync(join(work, "dist"))
  writeFileSync(join(work, "dist/index.js"), "module.exports = {}\n")
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ name: "demo-pkg", version: "0.3.0", files: ["dist"] }, null, 2)
  )
  writeFileSync(join(work, "CHANGELOG.md"), options.changelog ?? changelog())
  writeFileSync(join(work, ".gitignore"), ".release/\n")
  git(work, "add", ".")
  git(work, "commit", "-m", "initial")
  git(work, "remote", "add", "origin", remote)
  git(work, "push", "-u", "origin", "main")
  writeFileSync(log, "") // forget the fixture's own setup push

  executable(
    join(bin, "pnpm"),
    `echo "pnpm $*" >> "${log}"\nif [ "$*" = "$FAILED_CHECK" ]; then exit 1; fi`
  )
  executable(
    join(bin, "npm"),
    `case "$1" in
  version|pack) exec "${realNpm}" "$@" ;;
  whoami) [ "\${NPM_WHOAMI_FAIL:-0}" = 1 ] && exit 1; echo tester; exit 0 ;;
  view)
    spec="$2"; version="\${spec##*@}"
    if [ "\${NPM_VIEW_FAIL:-0}" = 1 ]; then echo "npm error network failure" >&2; exit 1; fi
    if grep -qx "$version" "${registry}"; then echo "$version"; exit 0; fi
    echo "npm error code E404" >&2; exit 1 ;;
  publish)
    echo "npm $*" >> "${log}"
    [ "\${NPM_PUBLISH_FAIL:-0}" = 1 ] && { echo "npm error publish failed" >&2; exit 1; }
    tar -xzOf "$2" package/package.json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version" >> "${registry}"
    exit 0 ;;
esac
echo "unexpected npm $*" >&2; exit 99`
  )

  const run = (args: string[], env: Record<string, string> = {}) => {
    const result = spawnSync("bash", [script, ...args], {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
    })
    return { status: result.status, out: result.stdout, err: result.stderr }
  }
  const events = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
  const published = () => readFileSync(registry, "utf8").trim().split("\n").filter(Boolean)
  const remoteTags = () => git(remote, "tag", "--list").split("\n").filter(Boolean)
  const remoteMain = () => git(remote, "rev-parse", "main")
  return {
    root,
    work,
    remote,
    run,
    events,
    published,
    remoteTags,
    remoteMain,
    git: (...a: string[]) => git(work, ...a),
  }
}

const publishedEvents = (events: string[]) =>
  events.filter((event) => event.startsWith("npm publish"))

describe("release script — successful release", () => {
  it("checks, publishes the verified tarball, then pushes only the release tag", () => {
    const repo = setup()
    repo.git("tag", "unrelated-local-tag")
    const result = repo.run(["minor"])
    expect(result.status, result.err).toBe(0)

    const events = repo.events()
    expect(events.filter((event) => event.startsWith("pnpm")).slice(0, 10)).toEqual([
      "pnpm run check",
      "pnpm exec tsc --noEmit",
      "pnpm run typecheck:tests",
      "pnpm run check:tenant-demo",
      "pnpm test",
      "pnpm run build",
      "pnpm run check:package",
      "pnpm run check:snippets",
      "pnpm run check:quickstart",
      "pnpm run docs:build",
    ])
    const publish = events.findIndex((event) => event.startsWith("npm publish"))
    const firstPush = events.indexOf("git-push")
    expect(publish).toBeGreaterThan(-1)
    expect(firstPush).toBeGreaterThan(publish)
    expect(events[publish]).toMatch(/npm publish \.release\/demo-pkg-0\.4\.0\.tgz --tag latest$/)

    expect(repo.published()).toEqual(["0.4.0"])
    expect(repo.remoteTags()).toEqual(["v0.4.0"])
    expect(repo.remoteMain()).toBe(repo.git("rev-parse", "HEAD"))
    expect(repo.git("log", "-1", "--format=%s")).toBe("chore: release v0.4.0")
    expect(readFileSync(join(repo.work, "CHANGELOG.md"), "utf8")).toMatch(
      /## \[0\.4\.0\] - \d{4}-\d{2}-\d{2}\n\n- Something changed\./
    )
    expect(repo.git("status", "--porcelain")).toBe("")
  })

  it("publishes a prerelease under its own dist-tag", () => {
    const repo = setup()
    const result = repo.run(["prerelease", "alpha"])
    expect(result.status, result.err).toBe(0)
    expect(publishedEvents(repo.events())[0]).toMatch(/demo-pkg-0\.3\.1-alpha\.0\.tgz --tag alpha$/)
    expect(repo.remoteTags()).toEqual(["v0.3.1-alpha.0"])
  })
})

describe("release script — validation before any change", () => {
  const untouched = (repo: ReturnType<typeof setup>) => {
    expect(repo.git("status", "--porcelain")).toBe("")
    expect(repo.git("log", "-1", "--format=%s")).toBe("initial")
    expect(repo.git("tag", "--list")).toBe("")
    expect(publishedEvents(repo.events())).toEqual([])
    expect(repo.remoteTags()).toEqual([])
    expect(JSON.parse(readFileSync(join(repo.work, "package.json"), "utf8")).version).toBe("0.3.0")
  }

  it.each([
    [["huge"], /unknown bump/],
    [["minor", "Latest"], /dist-tag/],
    [["minor", "1.0.0"], /dist-tag/],
    [["prerelease"], /prerelease as 'latest'/],
    [["minor", "beta"], /needs a prerelease bump/],
    [["--bogus"], /unknown option/],
  ])("rejects %j", (args, message) => {
    const repo = setup()
    const result = repo.run(args as string[])
    expect(result.status).toBe(1)
    expect(result.err).toMatch(message)
    expect(repo.events()).toEqual([])
    untouched(repo)
  })

  it("rejects a dirty tree, the wrong branch and a branch behind the remote", () => {
    const dirty = setup()
    writeFileSync(join(dirty.work, "stray.txt"), "x")
    expect(dirty.run(["minor"]).err).toMatch(/not clean/)

    const wrongBranch = setup()
    wrongBranch.git("checkout", "-b", "feature")
    expect(wrongBranch.run(["minor"]).err).toMatch(
      /releases are made from 'main' \(currently on 'feature'\)/
    )
    expect(publishedEvents(wrongBranch.events())).toEqual([])

    const behind = setup()
    const other = join(behind.root, "other")
    git(behind.root, "clone", behind.remote, other)
    git(other, "config", "user.email", "o@example.com")
    git(other, "config", "user.name", "O")
    writeFileSync(join(other, "x.txt"), "x")
    git(other, "add", ".")
    git(other, "commit", "-m", "remote work")
    git(other, "push", "origin", "main")
    expect(behind.run(["minor"]).err).toMatch(/behind 'origin\/main'/)
    // The only recorded push is the fixture's own commit made through another clone.
    expect(behind.events()).toEqual(["git-push"])
  })

  it("rejects a missing or empty changelog section before running checks", () => {
    const missing = setup({ changelog: "# Changelog\n## [0.3.0]\n" })
    const noHeading = missing.run(["minor"])
    expect(noHeading.err).toMatch(/Unreleased/)
    expect(missing.events()).toEqual([])
    untouched(missing)

    const empty = setup({ changelog: changelog("") })
    const result = empty.run(["minor"])
    expect(result.status).toBe(1)
    expect(result.err).toMatch(/section for 0\.4\.0 is empty/)
    expect(result.err).toMatch(/restored/)
    expect(empty.git("status", "--porcelain")).toBe("")
    expect(empty.git("log", "-1", "--format=%s")).toBe("initial")
    expect(empty.git("tag", "--list")).toBe("")
    expect(publishedEvents(empty.events())).toEqual([])
  })

  it("stops without versioning when a check fails", () => {
    const repo = setup()
    const result = repo.run(["minor"], { FAILED_CHECK: "run typecheck:tests" })
    expect(result.status).toBe(1)
    expect(repo.events().at(-1)).toBe("pnpm run typecheck:tests")
    untouched(repo)
  })

  it("requires npm authentication without touching anything", () => {
    const repo = setup()
    const result = repo.run(["minor"], { NPM_WHOAMI_FAIL: "1" })
    expect(result.status).toBe(1)
    expect(result.err).toMatch(/npm login/)
    expect(repo.events()).toEqual([])
    untouched(repo)
  })

  it("refuses a version that is already on the registry or already tagged", () => {
    const published = setup()
    writeFileSync(join(published.root, "registry.txt"), "0.4.0\n")
    const result = published.run(["minor"])
    expect(result.status).toBe(1)
    expect(result.err).toMatch(/already published; versions are immutable/)
    expect(published.events()).toEqual([])
    untouched(published)

    const tagged = setup()
    tagged.git("tag", "v0.4.0")
    expect(tagged.run(["minor"]).err).toMatch(/tag v0\.4\.0 already exists locally/)
    expect(tagged.events()).toEqual([])
  })

  it("does not guess when the registry cannot be queried", () => {
    const repo = setup()
    const result = repo.run(["minor"], { NPM_VIEW_FAIL: "1" })
    expect(result.status).toBe(1)
    expect(result.err).toMatch(/could not determine whether/)
    untouched(repo)
  })

  it("--check-only validates and changes nothing", () => {
    const repo = setup()
    const result = repo.run(["minor", "--check-only"])
    expect(result.status, result.err).toBe(0)
    expect(result.out).toMatch(/satisfied for v0\.4\.0; nothing was changed/)
    expect(repo.events()).toEqual([])
    untouched(repo)
  })
})

describe("release script — failures and recovery", () => {
  it("--prepare-only commits and tags locally, verifies the tarball, and publishes nothing", () => {
    const repo = setup()
    const result = repo.run(["minor", "--prepare-only"])
    expect(result.status, result.err).toBe(0)
    expect(result.out).toMatch(/verified tarball \.release\/demo-pkg-0\.4\.0\.tgz/)
    expect(result.out).toMatch(/git tag -d v0\.4\.0 && git reset --hard HEAD~1/)
    expect(repo.git("tag", "--list")).toBe("v0.4.0")
    expect(repo.git("log", "-1", "--format=%s")).toBe("chore: release v0.4.0")
    expect(publishedEvents(repo.events())).toEqual([])
    expect(repo.remoteTags()).toEqual([])
    expect(repo.published()).toEqual([])
  })

  it("leaves nothing public when npm publish fails, then resumes without redoing work", () => {
    const repo = setup()
    const failed = repo.run(["minor"], { NPM_PUBLISH_FAIL: "1" })
    expect(failed.status).toBe(1)
    expect(failed.err).toMatch(/Nothing was pushed to git/)
    expect(failed.err).toMatch(/--resume/)
    expect(repo.remoteTags()).toEqual([])
    expect(repo.events()).not.toContain("git-push")
    expect(repo.git("tag", "--list")).toBe("v0.4.0")

    const resumed = repo.run(["--resume"])
    expect(resumed.status, resumed.err).toBe(0)
    expect(repo.published()).toEqual(["0.4.0"])
    expect(repo.remoteTags()).toEqual(["v0.4.0"])
    expect(repo.remoteMain()).toBe(repo.git("rev-parse", "HEAD"))
    expect(publishedEvents(repo.events())).toHaveLength(2)
    expect(repo.git("tag", "--list")).toBe("v0.4.0")
    expect(repo.git("log", "--format=%s", "-3")).not.toMatch(/chore: release v0\.4\.1/)
  })

  it("never republishes when the push fails after publishing; --resume only pushes", () => {
    const repo = setup()
    writeFileSync(join(repo.root, "reject-push"), "")
    const failed = repo.run(["minor"])
    expect(failed.status).toBe(1)
    expect(failed.err).toMatch(/AFTER the package was published/)
    expect(failed.err).toMatch(/Do not publish again/)
    expect(repo.published()).toEqual(["0.4.0"])
    expect(repo.remoteTags()).toEqual([])

    rmSync(join(repo.root, "reject-push"))
    const resumed = repo.run(["--resume"])
    expect(resumed.status, resumed.err).toBe(0)
    expect(resumed.out).toMatch(/already on the registry; not publishing again/)
    expect(publishedEvents(repo.events())).toHaveLength(1)
    expect(repo.remoteTags()).toEqual(["v0.4.0"])
    expect(repo.remoteMain()).toBe(repo.git("rev-parse", "HEAD"))
  })

  it("--resume after --prepare-only completes the release", () => {
    const repo = setup()
    expect(repo.run(["minor", "--prepare-only"]).status).toBe(0)
    const resumed = repo.run(["--resume"])
    expect(resumed.status, resumed.err).toBe(0)
    expect(repo.published()).toEqual(["0.4.0"])
    expect(repo.remoteTags()).toEqual(["v0.4.0"])
  })

  it("--resume does nothing blindly: no prepared release, or a moved HEAD", () => {
    const none = setup()
    const noTag = none.run(["--resume"])
    expect(noTag.status).toBe(1)
    expect(noTag.err).toMatch(/no local tag v0\.3\.0/)
    expect(publishedEvents(none.events())).toEqual([])

    const moved = setup()
    expect(moved.run(["minor", "--prepare-only"]).status).toBe(0)
    writeFileSync(join(moved.work, "later.txt"), "x")
    moved.git("add", ".")
    moved.git("commit", "-m", "later work")
    const result = moved.run(["--resume"])
    expect(result.status).toBe(1)
    expect(result.err).toMatch(/HEAD is not the commit tagged v0\.4\.0/)
    expect(publishedEvents(moved.events())).toEqual([])
  })

  it("does not overwrite a remote tag that points elsewhere", () => {
    const repo = setup()
    expect(repo.run(["minor", "--prepare-only"]).status).toBe(0)
    // Someone else created v0.4.0 on the remote at a different commit.
    const other = join(repo.root, "other")
    git(repo.root, "clone", repo.remote, other)
    git(other, "config", "user.email", "o@example.com")
    git(other, "config", "user.name", "O")
    git(other, "tag", "-a", "v0.4.0", "-m", "someone else")
    git(other, "push", "origin", "v0.4.0")
    const result = repo.run(["--resume"])
    expect(result.status).toBe(1)
    expect(repo.published()).toEqual([])
    expect(publishedEvents(repo.events())).toEqual([])
    expect(result.err).toMatch(/already exists on 'origin' at a different commit/)
  })
})
