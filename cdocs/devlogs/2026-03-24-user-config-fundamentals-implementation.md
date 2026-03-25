---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T23:46:00-07:00
task_list: lace/user-config-and-fundamentals
type: devlog
state: live
status: review_ready
last_reviewed:
  status: revision_requested
  by: "@claude-sonnet-4-6"
  at: 2026-03-25T00:00:00-07:00
  round: 1
tags: [lace, user_config, devcontainer_features, implementation]
---

# User-Level Config and Fundamentals Feature: Implementation

> BLUF(opus/user-config-fundamentals): Implementing two accepted proposals: `user.json` user-level config and `lace-fundamentals` devcontainer feature.
> User config provides declarative mounts, features, git identity, shell preference, and env vars across all lace projects.
> Fundamentals consolidates SSH hardening, git identity, chezmoi, shell config, and staples into a single published feature.
> Implementation follows proposal phases: user-config first (5 phases), then fundamentals (5 phases).

## Objective

Implement the two accepted proposals:
- `cdocs/proposals/2026-03-24-lace-user-level-config.md` (accepted round 4)
- `cdocs/proposals/2026-03-24-lace-fundamentals-feature.md` (accepted round 4)

User config must be implemented first: fundamentals depends on it for git identity, shell preference, and mount configuration.

## Plan

### User-level config phases
1. Types and loading (`user-config.ts`): interfaces, discovery, JSONC parsing
2. Security validation: mount policy (denylist + user overrides), feature registry validation, symlink traversal
3. Merge logic (`user-config-merge.ts`): mounts, features, containerEnv, git identity
4. Pipeline integration (`up.ts`): Phase 0c insertion, `validateMountNamespaces` update
5. Documentation and chezmoi example

### Fundamentals feature phases
1. Feature scaffold (`devcontainers/features/src/lace-fundamentals/`)
2. Test suite updates: scenario tests for the new feature
3. Pipeline integration: detect fundamentals, inject defaultShell, set LACE_DOTFILES_PATH, auto-inject init script
4. Migrate lace's own devcontainer
5. Cleanup: delete lace-sshd, update related proposals

## Testing Approach

Test-first for all phases.
Using existing scenario test infrastructure (`createScenarioWorkspace`, `runUp` with `skipDevcontainerUp`).
Unit tests for security validation (mount policy, symlink traversal, path canonicalization).
Integration tests for pipeline behavior with and without user config.
Manual verification against real `lace up` after major phases.

## Critical Gotchas (from handoff)

1. Git identity uses `LACE_GIT_NAME`/`LACE_GIT_EMAIL`, NOT `GIT_AUTHOR_NAME`.
   The init script reads these to write `~/.gitconfig`.
2. Mount policy prefix matching is path-aware: `~/.ssh` matches `~/.ssh/config` but NOT `~/.sshrc`.
3. `validateMountNamespaces()` must add `"user"` to valid namespace set.
4. User mount missing source = warning + skip, not error.
5. Screenshots mount target is `/mnt/lace/screenshots`, not `/mnt/user/screenshots`.
6. The `dotfilesPath` feature option was removed; init script reads `LACE_DOTFILES_PATH` env var.

> NOTE(opus/user-config-fundamentals): The fundamentals proposal's init script code reads `GIT_AUTHOR_NAME`, but the user-config proposal and handoff devlog explicitly correct this to `LACE_GIT_NAME`/`LACE_GIT_EMAIL`.
> The handoff is authoritative on this point: the correction was made during review rounds 3-4.

## Implementation Notes

### Home directory root policy rule
The `~/` rule in the default mount policy needed special handling: with path-aware prefix matching, `~/` (expanding to homedir) would block ALL paths under home.
The fix: home directory root is exact-match only, preventing `~/` from blocking `~/Documents` or `~/Pictures`.
Other rules like `~/.ssh` still use prefix matching (blocking `~/.ssh/config` etc.).

### Git identity env var correction
The fundamentals proposal's init script code reads `GIT_AUTHOR_NAME`, but the user-config proposal (round 3-4 review correction) specifies `LACE_GIT_NAME`/`LACE_GIT_EMAIL`.
Implementation follows the corrected design: the init script reads `LACE_GIT_NAME`/`LACE_GIT_EMAIL` and writes them to `~/.gitconfig` via `git config --global`.

### User mount template injection
User mount declarations need explicit template injection (Step 4.1) because `autoInjectMountTemplates` only processes project and feature declarations.
After merging user declarations into `mountDeclarations`, we inject `${lace.mount(user/...)}` templates into the mounts array.

### Fundamentals postCreateCommand composition
The init script injection composes with existing `postCreateCommand` in both string and object formats.
Init runs FIRST (before user commands) to ensure git identity and dotfiles are available.

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/user-config.ts` | User config types, loading, mount policy, feature validation |
| `packages/lace/src/lib/user-config-merge.ts` | Merge logic: mounts, features, containerEnv, git identity |
| `packages/lace/src/lib/up.ts` | Phase 0c (user config), Step 4.1 (user mount injection), fundamentals integration |
| `packages/lace/src/lib/template-resolver.ts` | Added "user" to valid mount namespaces |
| `packages/lace/src/lib/__tests__/user-config.test.ts` | 52 unit tests: loading, policy, symlinks, feature validation |
| `packages/lace/src/lib/__tests__/user-config-merge.test.ts` | 20 unit tests: all merge scenarios |
| `packages/lace/src/__tests__/user-config-scenarios.test.ts` | 6 integration tests: UC1-UC6 |
| `packages/lace/src/__tests__/fundamentals-scenarios.test.ts` | 5 integration tests: F1-F4 |
| `devcontainers/features/src/lace-fundamentals/` | Feature scaffold: metadata, install.sh, 6 step scripts |
| `.devcontainer/devcontainer.json` | Migrated to lace-fundamentals, removed sshd/lace-sshd/nushell/neovim |
| `.devcontainer/Dockerfile` | Removed SSH directory setup (handled by feature) |
| `.devcontainer/features/lace-sshd/` | Deleted (replaced by lace-fundamentals) |

## Deferred Work

- UC Phase 5 (documentation and chezmoi example): deferred to a follow-up.
  The code is complete and tested; user-facing docs are a separate concern.
- Fund Phase 5 (sshd evolution proposal status update, README): deferred.
- Full container build verification: blocked on GHCR publish of lace-fundamentals.
  Scenario tests verify config generation; container-level verification requires publish.
- `LACE_DOTFILES_PATH` injection: the pipeline detects lace-fundamentals and injects `defaultShell`, but `LACE_DOTFILES_PATH` is not yet injected because it depends on dotfiles mount resolution (which requires repoMount configuration not yet implemented).

> NOTE(opus/user-config-fundamentals): Without `LACE_DOTFILES_PATH` injection, the init script defaults to `/mnt/lace/repos/dotfiles`.
> This default matches the `lace-fundamentals` feature's `dotfiles` mount declaration target, so the standard flow works without the env var.
> The env var exists for override flexibility: users who configure a non-default dotfiles mount target should set `LACE_DOTFILES_PATH` in their `containerEnv`.

## Verification

### Typecheck
```
> tsc --noEmit
(clean, no errors)
```

### Test Suite
```
Test Files  3 failed | 34 passed (37)
Tests  3 failed | 1009 passed (1012)
```

The 3 failures are pre-existing: `wezterm-server` feature not found (unrelated to this implementation).
All 1009 passing tests include 83 new tests (52 + 20 + 6 + 5).

### Manual CLI Verification
```
Loading user config...
User config applied: 1 mount(s), git identity
Resolved mount sources:
  user/test-mount: /home/mjr/.config/lace/lace/mounts/user/test-mount
Injected defaultShell="/usr/bin/nu" into lace-fundamentals
Auto-injected lace-fundamentals-init into postCreateCommand
```

Pipeline correctly loads user.json, validates mounts, merges config, detects lace-fundamentals, and injects defaultShell + init script.
Prebuild fails because lace-fundamentals is not yet published to GHCR (expected: Phase 4 of the proposal notes this dependency).

### Verification Honest Assessment
The implementation is verified at the config-generation level through 83 automated tests and manual CLI dry-run.
Container-level verification (SSH hardening, git identity in container, chezmoi apply) cannot be done until lace-fundamentals is published to GHCR.
The scenario test infrastructure uses `skipDevcontainerUp: true`, which validates the pipeline but not the feature's install script execution.
The step scripts are written to the proposal spec but are not yet tested in a real container build.
