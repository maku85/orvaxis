import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const script = resolve("scripts/release.sh")

function runRelease(changelog: string, failedCheck = "") {
  const directory = mkdtempSync(join(tmpdir(), "orvaxis-release-test-"))
  try {
    writeFileSync(join(directory, "CHANGELOG.md"), changelog)
    writeFileSync(join(directory, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    writeFileSync(
      join(directory, "pnpm"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> checks.log\nif [ "$*" = "$FAILED_CHECK" ]; then exit 1; fi\n',
      { mode: 0o755 }
    )
    writeFileSync(join(directory, "npm"), '#!/bin/sh\nprintf "%s\\n" "$*" >> npm.log\nexit 1\n', {
      mode: 0o755,
    })
    const result = spawnSync("bash", [script, "minor"], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FAILED_CHECK: failedCheck },
    })
    const readLog = (name: string) => {
      try {
        return readFileSync(join(directory, name), "utf8")
      } catch {
        return ""
      }
    }
    return {
      status: result.status,
      stderr: result.stderr,
      checks: readLog("checks.log"),
      npm: readLog("npm.log"),
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe("release preflight", () => {
  it("rejects a missing Unreleased section before versioning", () => {
    const result = runRelease("# Changelog\n## [0.3.1]\n")
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Unreleased")
    expect(result.checks).toBe("")
    expect(result.npm).toBe("")
  })

  it("does not version or publish when an example type-check fails", () => {
    const result = runRelease("# Changelog\n## [Unreleased]\n", "run typecheck:tests")
    expect(result.status).toBe(1)
    expect(result.checks).toContain("run typecheck:tests")
    expect(result.npm).toBe("")
  })

  it("completes all release checks before attempting a version bump", () => {
    const result = runRelease("# Changelog\n## [Unreleased]\n")
    expect(result.checks.trim().split("\n")).toEqual([
      "run check",
      "exec tsc --noEmit",
      "run typecheck:tests",
      "run check:tenant-demo",
      "test",
      "run build",
      "run check:package",
      "run docs:build",
    ])
    expect(result.npm.trim()).toBe("version minor --no-git-tag-version")
  })
})
