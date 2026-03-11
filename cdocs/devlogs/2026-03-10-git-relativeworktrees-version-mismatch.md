---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-10T17:30:00-08:00
task_list: lace/workspace-validation
type: devlog
state: archived
status: done
related_to:
  - cdocs/proposals/2026-03-10-git-relativeworktrees-version-mismatch.md
---

# Devlog: Fix `extensions.relativeWorktrees` Git Version Mismatch

## Objective

Implement the accepted proposal at
`cdocs/proposals/2026-03-10-git-relativeworktrees-version-mismatch.md` to fix git
operations failing inside the lace devcontainer due to the host's git 2.53.0
setting `extensions.relativeWorktrees` which the container's git 2.39.5 does not
recognize.

## Task List

- [x] Phase 1: Upgrade container git via devcontainer feature version
- [x] Phase 2: Git config parser in workspace-detector.ts
- [x] Phase 3: Extension compatibility warning + error promotion
- [x] Verification: all tests green (858/858)

## Session Log

### Phase 1: Upgrade Container Git

Updated `.devcontainer/devcontainer.json` to set `"version": "latest"` on the
`ghcr.io/devcontainers/features/git:1` prebuild feature. This causes the feature
to build git from source (2.48+) rather than using Debian Bookworm's packaged
2.39.5.

> NOTE: Using `"latest"` rather than a pinned version per review feedback tradeoff.
> The prebuild caches the result so version drift only occurs on intentional rebuilds.
> A pinned version would be more reproducible but requires manual updates.

### Phase 2: Git Config Parser

Added `parseGitConfigExtensions()` to `workspace-detector.ts`. The parser:
- Reads a git config file line by line
- Tracks the current section (lowercased)
- Extracts `core.repositoryformatversion` and all `extensions.*` keys
- Returns `{ formatVersion, extensions }` for downstream checking

Does not handle: multiline values, quoted strings, include directives. These are
not used by the keys we need to check.

Also added `checkGitExtensions()` which reads the bare git dir's config file and
emits `unsupported-extension` warnings for each extension found when
formatversion >= 1.

Added `findBareGitDir()` private helper to locate the bare git directory (with
HEAD and config) from a resolved worktree path. This is distinct from
`findBareRepoRoot()` which returns the project root (parent of .bare).

Added `GIT_EXTENSION_MIN_VERSIONS` static map for known extensions (objectformat,
worktreeconfig, relativeworktrees). Extensions not in the map are still flagged
but without a minimum version hint.

### Phase 3: Extension Compatibility Warning + Error Promotion

Wired `checkGitExtensions()` into `classifyWorkspaceUncached()` for both
`worktree` and `bare-root` classification paths. Added `unsupported-extension`
to the `ClassificationWarning.code` union type.

In `workspace-layout.ts`, added error promotion for `unsupported-extension`
warnings, matching the existing `absolute-gitdir` pattern. The error message
includes the extension name, minimum git version, remediation guidance (upgrade
the git feature), and a note about `--skip-validation`.

### Test Fix: Workspace Smoke Tests

The workspace smoke tests (`workspace_smoke.test.ts`) use real git commands
(`git worktree add`) which inherit the host's `worktree.useRelativePaths = true`
global config on this system. This caused the test repos to have
`extensions.relativeWorktrees = true`, which the new check flagged.

Fixed by stripping the `[extensions]` section and resetting
`core.repositoryformatversion` to 0 in `createRealBareWorktreeRepo()` after
worktree creation. This isolates the tests from the host's git configuration.

### Verification

- All 858 tests pass across 32 test files
- New tests: 18 in workspace-detector.test.ts, 2 in workspace-layout.test.ts
- Workspace smoke tests pass with the host isolation fix
