---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T10:30:00-08:00
task_list: lace/workspace-validation
type: proposal
state: live
status: wip
tags: [validation, worktree, workspaceMount, workspaceFolder, host-checks]
---

# Host-Side Validation and Workspace Layout Support

> BLUF: Add a two-part system to lace: (1) a `customizations.lace.workspace` block that detects bare-repo worktree layouts and auto-generates `workspaceMount`/`workspaceFolder`, and (2) a `customizations.lace.validate` block that checks host-side preconditions (file existence, directory structure) before container creation. Both run as a new "Phase 0" in the `lace up` pipeline, before metadata fetch, and follow the existing config-mutation pattern used by auto-injection. A `--skip-validation` flag provides an escape hatch consistent with the existing `--skip-metadata-validation`.

## Objective

Lace's devcontainer config generation pipeline currently passes `workspaceMount` and `workspaceFolder` through unchanged. Users who adopt the bare-repo worktree pattern must manually write four coordinated settings (`workspaceMount`, `workspaceFolder`, `postCreateCommand` for `safe.directory`, VS Code's `repositoryScanMaxDepth`), and there is no guard against misconfiguration. Similarly, devcontainer configs that depend on host-side resources (SSH keys, credential directories) fail with opaque Docker errors when those resources are missing.

This proposal adds:

1. **Workspace layout detection and auto-configuration** -- lace detects whether the host directory is a bare-repo worktree and generates the correct mount configuration automatically.
2. **Host-side precondition validation** -- lace checks that required host resources exist before invoking `devcontainer up`, producing actionable error messages instead of cryptic Docker failures.

## Background

### The bare-repo worktree pattern

The nikitabobko convention structures a repository as:

```
project/                    # bare-repo root
  .git          (file)     # gitdir: ./.bare
  .bare/        (dir)      # bare git internals (objects, refs, HEAD)
    worktrees/
      main/                # worktree-specific git state
      feature-x/
  main/         (dir)      # worktree working directory
    .git        (file)     # gitdir: ../.bare/worktrees/main
  feature-x/   (dir)      # another worktree
    .git        (file)     # gitdir: ../.bare/worktrees/feature-x
```

To use this in a devcontainer, you mount the entire `project/` directory (the bare-repo root) into the container, then set `workspaceFolder` to a specific worktree subdirectory. Lace's own devcontainer already does this manually:

```jsonc
"workspaceMount": "source=${localWorkspaceFolder}/..,target=/workspace,type=bind,consistency=delegated",
"workspaceFolder": "/workspace/main",
"postCreateCommand": "git config --global --add safe.directory '*'"
```

### What lace already has

- **Config generation pipeline**: `lace up` reads source config, auto-injects templates, resolves them, generates `.lace/devcontainer.json`. The `workspaceMount`/`workspaceFolder` fields pass through unchanged.
- **In-place config mutation pattern**: `autoInjectPortTemplates()` and `autoInjectMountTemplates()` both mutate the raw config object before template resolution. Workspace layout auto-generation follows the same pattern.
- **Phase-based error reporting**: Each pipeline phase records `{ exitCode, message }` in `result.phases`. Validation would be a new phase.
- **`--skip-metadata-validation` precedent**: An existing escape hatch for bypassing metadata checks. `--skip-validation` follows the same pattern.

### Prior analysis

- [`cdocs/reports/2026-02-13-worktree-aware-devcontainers.md`](../reports/2026-02-13-worktree-aware-devcontainers.md) — full analysis of the single-container bare-repo model
- [`cdocs/reports/2026-02-13-worktree-support-executive-summary.md`](../reports/2026-02-13-worktree-support-executive-summary.md) — executive summary recommending auto-configuration (Tier 2)

## Proposed Solution

### Architecture overview

Two new `customizations.lace` blocks, processed as "Phase 0" in `lace up`:

```
lace up pipeline:
  Phase 0: Host validation + workspace layout (NEW)
    0a. Read customizations.lace.workspace → detect layout → mutate config
    0b. Read customizations.lace.validate → run checks → fail/warn
    0c. Infer mount source checks from mounts array → warn on missing
  Phase 1: Metadata fetch + validation (existing)
  Phase 2: Auto-inject templates (existing)
  Phase 3: Resolve templates (existing)
  Phase 4: Prebuild (existing)
  Phase 5: Resolve repo mounts (existing)
  Phase 6: Generate extended config (existing)
  Phase 7: devcontainer up (existing)
```

### Part 1: Workspace layout detection (`customizations.lace.workspace`)

#### Schema

```jsonc
{
  "customizations": {
    "lace": {
      "workspace": {
        "layout": "bare-worktree",   // "bare-worktree" | false
        "mountTarget": "/workspace", // container mount path (default: "/workspace")
        "postCreate": {
          "safeDirectory": true,     // inject safe.directory '*' (default: true)
          "scanDepth": 2             // git.repositoryScanMaxDepth (default: 2)
        }
      }
    }
  }
}
```

#### Detection algorithm

When `layout: "bare-worktree"` is set, lace runs a filesystem-only detection from the `--workspace-folder` path:

```
1. stat(<workspaceFolder>/.git)
   .git is DIRECTORY → normal clone → ERROR: "bare-worktree layout declared
     but workspace is a normal git clone"
   .git is FILE → parse "gitdir: <target>"
     resolve <target> relative to <workspaceFolder>
     resolved contains "/worktrees/" → this is a WORKTREE
       bareRepoRoot = walk up from resolved to find parent of .bare/
       worktreeName = basename of <workspaceFolder>
     resolved does NOT contain "/worktrees/" → this is the BARE-ROOT
       bareRepoRoot = <workspaceFolder>
   .git MISSING → ERROR: "bare-worktree layout declared but no .git found"
```

Key insight from research: always resolve from the **forward pointer** (worktree's `.git` file → `.bare/worktrees/<name>`), never from `git worktree list` which is unreliable when back-pointers are broken.

This detection is **filesystem-only** — no `git` binary required. It parses the `.git` file and resolves relative paths. This means it works before the container starts, in CI without git installed, and avoids the overhead of spawning subprocesses.

#### Auto-generation

When a bare-worktree layout is detected and the user has **not** explicitly set `workspaceMount` or `workspaceFolder`, lace mutates the raw config:

```typescript
// Only if user hasn't explicitly set these:
if (!config.workspaceMount) {
  config.workspaceMount =
    `source=${bareRepoRoot},target=${mountTarget},type=bind,consistency=delegated`;
}
if (!config.workspaceFolder) {
  config.workspaceFolder = `${mountTarget}/${worktreeName}`;
}
```

When the user **has** set `workspaceMount`/`workspaceFolder`, lace respects them (opt-out). A log message notes the override.

Additionally, when `postCreate.safeDirectory` is true (default), lace appends `git config --global --add safe.directory '*'` to `postCreateCommand` using the same merging logic already in `generateExtendedConfig()` for symlink commands. When `postCreate.scanDepth` is set, lace merges `git.repositoryScanMaxDepth` into `customizations.vscode.settings`.

#### Supplemental validation

When workspace layout detection runs, it also performs:

1. **Absolute path check**: Scan `.git` files in the bare-repo root for absolute `gitdir:` paths. Warn (not error) that these will break inside the container, with remediation: `git worktree repair --relative-paths` (git 2.48+).
2. **Worktree health check**: Run `git worktree list --porcelain` (if `git` is available) and warn about `prunable` worktrees with guidance to run `git worktree repair`.
3. **Mounted-from check**: When the user opens from a worktree (not the bare-root), lace infers the bare-repo root and uses it for the mount. Log message: "Detected worktree 'main' in bare repo at <path>. Mounting bare-repo root."

### Part 2: Host-side validation (`customizations.lace.validate`)

#### Schema

```jsonc
{
  "customizations": {
    "lace": {
      "validate": {
        "fileExists": [
          { "path": "~/.ssh/lace_devcontainer.pub", "severity": "error",
            "hint": "Run: ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ''" },
          { "path": "~/.claude", "severity": "warn",
            "hint": "Claude Code config directory. Create with: mkdir -p ~/.claude" }
        ]
      }
    }
  }
}
```

#### Check types

**`fileExists`**: Validates that a file or directory exists on the host. Each entry has:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | required | Host path. `~` expanded to `$HOME`. `${localEnv:VAR}` supported. |
| `severity` | `"error" \| "warn"` | `"error"` | `error` aborts `lace up`; `warn` prints warning and continues. |
| `hint` | string | none | Remediation guidance printed alongside the error/warning. |

Shorthand: A bare string `"~/.ssh/key.pub"` is equivalent to `{ "path": "~/.ssh/key.pub", "severity": "error" }`.

#### Inferred mount validation (automatic, no config needed)

As a bonus, lace automatically validates bind-mount sources in the `mounts` array after template resolution. For each entry matching `source=<path>,target=...,type=bind,...`:

- If `<path>` is a devcontainer variable (`${localEnv:...}`, `${localWorkspaceFolder}`), skip (resolved by devcontainer CLI, not lace).
- If `<path>` is a concrete absolute path and does not exist: emit a **warning** (not error, because Docker auto-creates missing directory sources — only file sources fail).

This catches the common case of a missing SSH public key in a bind mount without any explicit `validate` config.

#### Escape hatch

`--skip-validation` flag on `lace up`:
- Downgrades all `severity: "error"` checks to warnings.
- Workspace layout detection still runs (it's generative, not just assertive), but mismatches become warnings instead of errors.
- Follows the `--skip-metadata-validation` implementation pattern exactly.

### Why not a devcontainer feature?

The user raised the question of whether validation logic could live in a feature like `lace-enforce-bare-worktree-workspaces`. After analysis, baked-in is the right choice for several reasons:

1. **Host-side execution**: Workspace layout detection and file-existence checks run on the host before the container exists. Features run inside the container.
2. **Config generation**: The workspace block modifies `workspaceMount`/`workspaceFolder`, which are host-side Docker config. Features cannot modify these — they are consumed by `devcontainer up` before any feature runs.
3. **No network dependency**: Feature metadata requires OCI registry access. Validation should be fast and offline-capable.
4. **Simplicity**: A single `customizations.lace.workspace` block is more discoverable than installing a separate feature.

Features **can** declare mount needs via `customizations.lace.mounts` — the inferred mount validation (Part 2's automatic check) catches missing sources for feature-declared mounts too, so features benefit from the validation framework without needing to know about it.

## Important Design Decisions

### D1: Filesystem-only detection vs `git rev-parse`

**Decision**: Use filesystem-only detection (parse `.git` file contents), fall back to `git rev-parse` for supplemental checks (worktree health, absolute paths).

**Rationale**: The core detection must work without `git` installed (CI environments, minimal host setups). Parsing the `.git` file is deterministic and sufficient for identifying the layout. The `git` commands provide supplemental warnings but are not required.

### D2: Auto-generate vs template variables

**Decision**: Auto-generate `workspaceMount`/`workspaceFolder` by mutating the raw config, rather than adding new `${lace.workspace.*}` template variables.

**Rationale**: Template variables would need to be present in the devcontainer.json, which defeats the "zero-config" goal. Auto-generation lets the user write just `"workspace": { "layout": "bare-worktree" }` and get the rest for free. The mutation pattern is already established by `autoInjectPortTemplates()` and `autoInjectMountTemplates()`.

### D3: User-set values always win

**Decision**: If `workspaceMount` or `workspaceFolder` are explicitly set in the source devcontainer.json, lace does not override them even when workspace layout detection succeeds.

**Rationale**: Consistent with auto-injection suppression for ports and mounts (existing behavior). Power users can set custom mount paths and lace respects them. The workspace detection still runs for validation (warns if the layout looks wrong) but does not mutate.

### D4: `safe.directory '*'` is acceptable

**Decision**: Auto-inject `safe.directory '*'` (wildcard) rather than per-worktree entries.

**Rationale**: This is standard practice for devcontainers with bind mounts. Per-path entries are fragile (must enumerate all worktrees) and provide no meaningful security benefit inside an ephemeral dev container where the user already has root access. The worktree analysis report confirms this.

### D5: Validation severity model

**Decision**: Two levels (`error` = abort, `warn` = continue). No `info` level.

**Rationale**: Keep it simple. `error` catches real blockers (missing SSH key means the container is useless). `warn` catches nice-to-haves (missing claude config is degraded but functional). An `info` level would be noise — use log messages instead.

### D6: No workspace layout "auto" mode (yet)

**Decision**: Require explicit `layout: "bare-worktree"` rather than supporting `layout: "auto"` that detects the layout and adapts.

**Rationale**: Auto-detection without opt-in risks surprising behavior — silently changing `workspaceMount` because lace detected an unexpected `.git` file pattern. Explicit declaration makes the intent clear. An `"auto"` mode can be added later once the detection logic is proven reliable.

## Edge Cases / Challenging Scenarios

### E1: User opens from bare-repo root vs worktree

When `--workspace-folder` points to the bare-repo root (contains `.git` file → `.bare`), there is no "current worktree" to set as `workspaceFolder`. Lace sets `workspaceFolder` to the mount target root (e.g., `/workspace`) and emits a note: "Opened from bare-repo root. workspaceFolder set to mount root — navigate to a worktree directory to begin work."

### E2: Absolute paths in `.git` files

Git defaults to absolute paths in worktree `.git` files. These resolve correctly on the host but break inside the container (different mount path). Lace emits a warning with remediation: "Worktree 'feature-x' uses an absolute gitdir path that will not resolve inside the container. Run `git worktree repair --relative-paths` (requires git 2.48+) or recreate the worktree."

This is a **warning**, not an error, because:
- The container may still work if the user sets `workspaceMount` to the exact expected path.
- The user may not have git 2.48+ available.

### E3: User has workspaceMount but not workspaceFolder (or vice versa)

If only one of the pair is user-set, lace generates the other. If `workspaceMount` is set but `workspaceFolder` is not, lace infers `workspaceFolder` from the detected worktree name and the mount target in `workspaceMount`. If `workspaceFolder` is set but `workspaceMount` is not, lace generates `workspaceMount` to mount the bare-repo root and logs a note.

### E4: Non-nikitabobko bare repo layouts

Some users do `git clone --bare repo.git` without the `.git` wrapper file. In this case the bare-repo root *is* the git internals directory (contains `HEAD`, `objects/`, etc. directly). The detection algorithm handles this: if `.git` doesn't exist but `HEAD` and `objects/` do, it's a standard bare repo. However, the nikitabobko convention (`.git` file → `.bare/`) is the target pattern; standard bare repos without the wrapper are an edge case that should emit a warning suggesting migration to the nikitabobko convention for devcontainer compatibility.

### E5: Nested git repos / submodules

The detection only looks at `<workspaceFolder>/.git`. It does not recursively scan for `.git` files in subdirectories. Submodules within a worktree have their own `.git` files but these are handled by git's own submodule machinery, not by lace.

### E6: `validate.fileExists` with symlinks

`~/.claude` may be a symlink. The existence check should follow symlinks (`fs.existsSync` does this by default in Node.js). The check passes if the symlink target exists.

### E7: Race condition — file removed between validation and container start

Validation runs before `devcontainer up`. A file could be removed between the check and Docker's bind mount. This is inherently racy and not worth solving — the validation catches the 99% case (file was never created). The 1% case (file deleted mid-run) produces the same Docker error as today.

## Test Plan

### Unit tests: workspace detection (`workspace-detector.ts`)

| Test | Input | Expected |
|------|-------|----------|
| Normal clone detection | `.git` is a directory | `{ type: 'normal-clone' }` |
| Bare-root detection | `.git` file → `.bare` | `{ type: 'bare-root', bareRepoRoot: <path> }` |
| Worktree detection | `.git` file → `../.bare/worktrees/main` | `{ type: 'worktree', bareRepoRoot: <parent>, worktreeName: 'main' }` |
| Missing .git | No `.git` | `{ type: 'not-git' }` |
| Absolute gitdir path | `.git` file with absolute path | Detection succeeds + warning emitted |
| Relative gitdir path | `.git` file with relative path | Detection succeeds, no warning |
| Malformed .git file | `.git` file without `gitdir:` prefix | Error: "unexpected .git file format" |
| Non-nikitabobko bare repo | `HEAD` + `objects/` exist, no `.git` file | `{ type: 'standard-bare' }` + warning |

### Unit tests: config auto-generation (`workspace-layout.ts`)

| Test | Input | Expected |
|------|-------|----------|
| Auto-generate both fields | worktree detected, no user workspaceMount/Folder | Both fields set in config |
| User workspaceMount wins | worktree detected, user has workspaceMount | workspaceMount unchanged, workspaceFolder auto-generated |
| User workspaceFolder wins | worktree detected, user has workspaceFolder | workspaceMount auto-generated, workspaceFolder unchanged |
| Both user-set | worktree detected, user has both | Neither overridden, log note |
| Layout mismatch | `layout: "bare-worktree"` but normal clone | Error exit with message |
| safe.directory injection | workspace detected, `safeDirectory: true` | postCreateCommand includes safe.directory |
| scanDepth injection | workspace detected, `scanDepth: 2` | vscode settings merged |
| Bare-root opened | workspace is bare-root, not worktree | workspaceFolder = mountTarget root |

### Unit tests: host validation (`host-validator.ts`)

| Test | Input | Expected |
|------|-------|----------|
| fileExists — present | Existing file path | Check passes |
| fileExists — missing, severity error | Non-existent path, `"error"` | Validation fails, hint shown |
| fileExists — missing, severity warn | Non-existent path, `"warn"` | Warning emitted, validation passes |
| fileExists — symlink to existing target | Symlink to real file | Check passes |
| fileExists — symlink to missing target | Broken symlink | Check fails |
| fileExists — tilde expansion | `~/file` | Expanded to `$HOME/file` |
| fileExists — shorthand string | `"~/.ssh/key"` string | Treated as `{ path, severity: "error" }` |
| --skip-validation | Error-severity check fails + flag set | Downgraded to warning |

### Integration tests: `lace up` with workspace validation

| Test | Setup | Expected |
|------|-------|----------|
| Worktree workspace, no user mount config | Create fake bare-repo layout + devcontainer.json with `workspace.layout` | Generated config has auto-generated workspaceMount/workspaceFolder |
| Normal clone, no workspace config | Normal `.git` directory | No workspace phase output |
| Normal clone, workspace declared | `layout: "bare-worktree"` but normal clone | `exitCode: 1`, phases.workspaceValidation.message |
| fileExists validation blocks | Missing file, `severity: "error"` | `exitCode: 1` |
| fileExists validation warns | Missing file, `severity: "warn"` | `exitCode: 0`, warning logged |
| Skip validation flag | Missing file + `--skip-validation` | `exitCode: 0`, downgraded warnings |
| End-to-end with existing lace config | Lace's own `.devcontainer/devcontainer.json` adapted | Generated config matches expected layout |

### Test infrastructure

Create a `createBareRepoWorkspace()` helper in `scenario-utils.ts` that sets up a fake bare-repo layout:
- Creates `.bare/` directory with `HEAD`, `objects/`, `refs/` stubs
- Creates `.git` file with `gitdir: ./.bare`
- Creates worktree directories with `.git` files pointing to `.bare/worktrees/<name>`
- Creates `.bare/worktrees/<name>/` with `commondir` and `gitdir` back-pointers

This helper is reusable for all worktree-related tests without requiring a real git repo.

## Implementation Phases

### Phase 1: Workspace detection and auto-generation

**Files to create:**
- `packages/lace/src/lib/workspace-detector.ts` — `classifyWorkspace()`, `resolveGitdirPointer()`, `checkAbsolutePaths()`
- `packages/lace/src/lib/workspace-layout.ts` — `applyWorkspaceLayout()` (reads `customizations.lace.workspace`, calls detector, mutates config)
- `packages/lace/src/lib/__tests__/workspace-detector.test.ts`
- `packages/lace/src/lib/__tests__/workspace-layout.test.ts`

**Files to modify:**
- `packages/lace/src/lib/up.ts` — insert Phase 0a call to `applyWorkspaceLayout()` after config read, before metadata fetch. Add `workspaceValidation` to `UpResult.phases`.
- `packages/lace/src/__tests__/helpers/scenario-utils.ts` — add `createBareRepoWorkspace()` helper.

**Acceptance criteria:**
- `lace up` in a bare-repo worktree with `workspace.layout: "bare-worktree"` auto-generates correct `workspaceMount`/`workspaceFolder` in `.lace/devcontainer.json`.
- User-set `workspaceMount`/`workspaceFolder` are never overridden.
- Layout mismatch (declared bare-worktree but workspace is a normal clone) fails with a clear error.
- All unit and integration tests pass.

### Phase 2: Host-side validation framework

**Files to create:**
- `packages/lace/src/lib/host-validator.ts` — `runHostValidation()`, `checkFileExists()`, `expandPath()`
- `packages/lace/src/lib/__tests__/host-validator.test.ts`

**Files to modify:**
- `packages/lace/src/lib/up.ts` — insert Phase 0b call to `runHostValidation()` after workspace layout. Add `hostValidation` to `UpResult.phases`. Add `skipValidation` to `UpOptions`.
- `packages/lace/src/commands/up.ts` — add `--skip-validation` CLI flag.

**Acceptance criteria:**
- `validate.fileExists` checks run before metadata fetch.
- `severity: "error"` aborts `lace up` with actionable message + hint.
- `severity: "warn"` logs warning and continues.
- `--skip-validation` downgrades errors to warnings.
- Shorthand string and object forms both work.

### Phase 3: Inferred mount validation and documentation

**Files to modify:**
- `packages/lace/src/lib/up.ts` — after template resolution (when mount paths are concrete), scan resolved `mounts` array for bind-mount sources that don't exist. Emit warnings.
- `packages/lace/README.md` — document `customizations.lace.workspace` and `customizations.lace.validate` schemas.

**Acceptance criteria:**
- A resolved mount with `source=/nonexistent/path,target=...,type=bind` emits a warning.
- `${localEnv:*}` and `${localWorkspaceFolder}` mount sources are skipped (resolved by devcontainer CLI).
- README documents the new features with examples.

### Phase 4: Apply to lace's own devcontainer

**Files to modify:**
- `.devcontainer/devcontainer.json` — replace manual `workspaceMount`/`workspaceFolder`/`postCreateCommand` with `customizations.lace.workspace` block. Add `validate.fileExists` for SSH key.

**Before:**
```jsonc
"workspaceMount": "source=${localWorkspaceFolder}/..,target=/workspace,type=bind,consistency=delegated",
"workspaceFolder": "/workspace/main",
"postCreateCommand": "git config --global --add safe.directory '*'"
```

**After:**
```jsonc
"customizations": {
  "lace": {
    "workspace": {
      "layout": "bare-worktree",
      "mountTarget": "/workspace"
    },
    "validate": {
      "fileExists": [
        { "path": "~/.ssh/lace_devcontainer.pub", "severity": "error",
          "hint": "Run: ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ''" }
      ]
    }
  }
}
```

**Acceptance criteria:**
- `lace up` with the updated config produces an identical `.lace/devcontainer.json` to the current manual setup.
- Missing SSH key produces a clear error message before container creation.
