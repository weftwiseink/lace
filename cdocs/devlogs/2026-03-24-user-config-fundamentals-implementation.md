---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T23:46:00-07:00
task_list: lace/user-config-and-fundamentals
type: devlog
state: live
status: wip
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

*Updated as work proceeds.*

## Changes Made

| File | Description |
|------|-------------|
| *TBD* | |

## Verification

*Populated after each phase with build/test output.*
