---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T21:00:00-07:00
task_list: lace/user-config-and-fundamentals
type: devlog
state: live
status: review_ready
tags: [lace, user_config, devcontainer_features, handoff]
---

# User-Level Config and Fundamentals Feature: Implementation Handoff

> BLUF(opus/handoff): Two accepted proposals are ready for implementation: `~/.config/lace/user.json` (user-level config) and `lace-fundamentals` (consolidated devcontainer feature).
> This devlog provides the implementer with the document map, build/test workflow, and implementation sequence.
> The proposals went through 4 review rounds each with substantial revision.
> Key complexity: configurable mount policy, two-layer git identity via `LACE_GIT_NAME`/`GIT_CONFIG_*`, and feature mount requests for dotfiles/screenshots.

## Document Map

### Primary specs (read these in full)

| Document | Path | Status |
|----------|------|--------|
| User-level config proposal | `cdocs/proposals/2026-03-24-lace-user-level-config.md` | Accepted (round 4) |
| Fundamentals feature proposal | `cdocs/proposals/2026-03-24-lace-fundamentals-feature.md` | Accepted (round 4) |

### Supporting documents (read as needed)

| Document | Path | Purpose |
|----------|------|---------|
| Research report | `cdocs/reports/2026-03-24-user-level-devcontainer-config-approaches.md` | Background research on approach |
| Design decisions report | `cdocs/reports/2026-03-24-user-config-fundamentals-design-decisions.md` | Rationale for key decisions |
| Gap analysis | `cdocs/reports/2026-03-24-lace-vs-vscode-devcontainer-gap-analysis.md` | Context for what VS Code provides |
| Planning devlog | `cdocs/devlogs/2026-03-24-user-config-and-fundamentals-feature.md` | Session history and evolution |

### Review history (reference if a design decision seems wrong)

Reviews are in `cdocs/reviews/2026-03-24-review-*`.
Each review documents specific issues found and how they were resolved.
The round 3 reviews are most informative: they caught the `mergeUserGitIdentity` env var override bug and the screenshots mount target conflict.

## Implementation Sequence

The user-level config proposal (Phase 1-5) must be implemented before the fundamentals feature (which depends on `user.json` for git identity, default shell, and mount configuration).

### User-level config phases

1. **Types and loading** (`user-config.ts`): `UserConfig` interface, `findUserConfig()`, `readUserConfig()`, `loadUserConfig()`.
2. **Security validation**: configurable mount policy (`loadMountPolicy()`, `evaluateMountPolicy()`), feature registry validation (reuse `isLocalPath()`).
3. **Merge logic** (`user-config-merge.ts`): `mergeUserMounts()`, `mergeUserFeatures()`, `mergeUserContainerEnv()`, `mergeUserGitIdentity()`.
4. **Pipeline integration** (`up.ts`): insert Phase 0c between host validation and metadata fetch. Update `validateMountNamespaces()` in `template-resolver.ts` to accept `"user"` namespace.
5. **Documentation and chezmoi example**.

### Fundamentals feature phases

1. **Feature scaffold** (`devcontainers/features/src/lace-fundamentals/`): `devcontainer-feature.json`, `install.sh` orchestrator, `steps/` scripts.
2. **Test suite updates**: scenario tests for the new feature.
3. **Pipeline integration**: detect fundamentals feature, inject `defaultShell` option, set `LACE_DOTFILES_PATH`, auto-inject `lace-fundamentals-init` into `postCreateCommand`.
4. **Migrate lace's own devcontainer**: replace sshd pair with fundamentals, remove nushell from prebuildFeatures.
5. **Cleanup**: delete `.devcontainer/features/lace-sshd/`, update related proposals.

## Build and Test Workflow

### Commands

```bash
cd /workspaces/lace/main/packages/lace

# Build
pnpm run build

# Run full test suite
pnpm test

# Run a single test file
npx vitest src/__tests__/claude-code-scenarios.test.ts

# Run tests matching a pattern
npx vitest --grep "user-config" run

# Watch mode for iterative development
npx vitest --watch

# Typecheck
pnpm run typecheck
```

### Test patterns

Scenario tests use `createScenarioWorkspace()` from `src/__tests__/helpers/scenario-utils.ts`.
Each scenario:
1. Creates a temp workspace with `.devcontainer/` and `.lace/` dirs.
2. Writes a `devcontainer.json` via `writeDevcontainerJson()`.
3. Symlinks local features via `symlinkLocalFeature()`.
4. Runs `runUp()` with `skipDevcontainerUp: true` (config generation only, no Docker).
5. Reads the generated config via `readGeneratedConfig()`.
6. Asserts on the generated `.lace/devcontainer.json` contents.

Reference tests to study:
- `src/__tests__/claude-code-scenarios.test.ts`: mount auto-injection, settings overrides, Docker smoke test.
- `src/__tests__/portless-scenarios.test.ts`: port injection and resolution.
- `src/__tests__/neovim-scenarios.test.ts`: mount-only features.
- `src/lib/__tests__/metadata.test.ts`: unit test patterns.

### Key source files

| File | What it does |
|------|-------------|
| `src/lib/up.ts` | Main pipeline (`runUp()`, line 137). This is where Phase 0c goes. |
| `src/lib/template-resolver.ts` | `validateMountNamespaces()` at line 325. Add `"user"` to valid set. |
| `src/lib/settings.ts` | `loadSettings()`. Pattern to follow for `loadUserConfig()`. |
| `src/lib/feature-metadata.ts` | `isLocalPath()` at line 286. Reuse for feature validation. |
| `src/__tests__/helpers/scenario-utils.ts` | Test infrastructure. |

## Critical Design Details

These are the non-obvious parts that caused bugs in review. Read the proposals for full context, but flag these early.

### Git identity is NOT injected as `GIT_AUTHOR_NAME`

The user-level config merges git identity as `LACE_GIT_NAME`/`LACE_GIT_EMAIL` containerEnv variables.
These are NOT recognized by git.
The `lace-fundamentals-init` script reads them to write `~/.gitconfig`.
Projects override via `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*` in their containerEnv.

If you inject `GIT_AUTHOR_NAME` directly, it overrides everything including project-level `GIT_CONFIG_*`, breaking the two-layer identity system.

### Mount policy uses path-aware prefix matching

`~/.ssh` must match `~/.ssh/config` but NOT `~/.sshrc`.
The match requires the source path to equal the rule or to have a `/` separator immediately after.

### `validateMountNamespaces()` must accept `"user"`

One-line change at `template-resolver.ts:329`:
```typescript
const validNamespaces = new Set(["project", "user", ...featureShortIds]);
```

### User mounts skip on missing source (warning, not error)

Unlike project mounts (which error), user mounts with missing sources are skipped with a warning.
This is intentional: user config is portable across machines with different directory layouts.

### Feature mount requests for dotfiles and screenshots

The fundamentals feature declares `dotfiles` and `screenshots` mounts in its `customizations.lace.mounts`.
These follow the same pattern as `claude-code` (config mount) and `neovim` (plugins mount).
Lace prompts users to configure sources when not provided.
Screenshots target `/mnt/lace/screenshots` (not `/mnt/user/screenshots`).
