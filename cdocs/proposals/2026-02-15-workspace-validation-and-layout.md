---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T10:30:00-08:00
task_list: lace/workspace-validation
type: proposal
state: live
status: wip
tags: [validation, worktree, workspaceMount, workspaceFolder, host-checks]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-15T14:30:00-08:00
  round: 2
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
  Phase 0: Host validation + workspace layout (NEW — impl phases 1-2)
    0a. Read customizations.lace.workspace → detect layout → mutate config
    0b. Read customizations.lace.validate → run checks → fail/warn
  Phase 1: Metadata fetch + validation (existing)
  Phase 2: Auto-inject templates (existing)
  Phase 3: Resolve templates (existing)
  Phase 3+: Infer mount source checks from resolved mounts → warn (NEW — impl phase 3)
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

> NOTE: Bootstrap concern — lace's own devcontainer requires `lace up` to function, which requires lace to be built. Keep the manual `workspaceMount`/`workspaceFolder` values as comments in the config so contributors who bootstrap without lace can uncomment them. Alternatively, `devcontainer up` without lace still works — it just ignores the `customizations.lace` block and passes through any non-lace config unchanged.

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

## Detailed Implementation Guide

This section provides implementation-level detail sufficient for an implementing agent to build the feature end-to-end. All code examples are concrete TypeScript targeting the existing patterns in this codebase.

### 1. Type Definitions

All new types live in their respective module files. They follow the established pattern of co-locating types with the module that owns them.

#### `workspace-detector.ts` types

```typescript
/** Classification of a workspace directory's git layout. */
export type WorkspaceClassification =
  | {
      type: "worktree";
      /** Absolute path to the bare-repo root (parent of .bare/) */
      bareRepoRoot: string;
      /** Name of this worktree (basename of the workspace directory) */
      worktreeName: string;
      /** Whether the .git file used an absolute gitdir path */
      usesAbsolutePath: boolean;
    }
  | {
      type: "bare-root";
      /** Absolute path to the bare-repo root (same as workspace) */
      bareRepoRoot: string;
    }
  | {
      type: "normal-clone";
    }
  | {
      type: "standard-bare";
    }
  | {
      type: "not-git";
    }
  | {
      type: "malformed";
      /** Description of what went wrong */
      reason: string;
    };

/** Warnings emitted during workspace classification. */
export interface ClassificationWarning {
  code: "absolute-gitdir" | "standard-bare" | "prunable-worktree";
  message: string;
  remediation?: string;
}

/** Full result of workspace classification. */
export interface ClassificationResult {
  classification: WorkspaceClassification;
  warnings: ClassificationWarning[];
}
```

#### `workspace-layout.ts` types

```typescript
/** Schema for customizations.lace.workspace in devcontainer.json. */
export interface WorkspaceConfig {
  /** Layout type. Currently only "bare-worktree" or false (disabled). */
  layout: "bare-worktree" | false;
  /** Container mount target path (default: "/workspace"). */
  mountTarget?: string;
  /** Post-creation configuration. */
  postCreate?: {
    /** Inject `git config --global --add safe.directory '*'` (default: true). */
    safeDirectory?: boolean;
    /** Set git.repositoryScanMaxDepth in VS Code settings (default: 2). */
    scanDepth?: number;
  };
}

/** Result of applying workspace layout to a config. */
export interface WorkspaceLayoutResult {
  /** Outcome of the layout application. */
  status: "skipped" | "applied" | "error";
  /** Human-readable summary message. */
  message: string;
  /** Warnings emitted during application. */
  warnings: string[];
}
```

#### `host-validator.ts` types

```typescript
/** A single file-existence check, fully normalized. */
export interface FileExistsCheck {
  /** Absolute host path (after tilde/env expansion). */
  path: string;
  /** Original path string from config (for error messages). */
  originalPath: string;
  /** "error" aborts lace up; "warn" logs and continues. */
  severity: "error" | "warn";
  /** Remediation hint shown alongside the error/warning. */
  hint?: string;
}

/** Schema for customizations.lace.validate in devcontainer.json. */
export interface ValidateConfig {
  fileExists?: Array<string | FileExistsCheckInput>;
}

/** Input shape before normalization (from devcontainer.json). */
export interface FileExistsCheckInput {
  path: string;
  severity?: "error" | "warn";
  hint?: string;
}

/** Result of a single validation check. */
export interface CheckResult {
  passed: boolean;
  severity: "error" | "warn";
  message: string;
  hint?: string;
}

/** Aggregated result of all host validation checks. */
export interface HostValidationResult {
  /** Whether all error-severity checks passed. */
  passed: boolean;
  /** Individual check results. */
  checks: CheckResult[];
  /** Number of checks that failed with severity "error". */
  errorCount: number;
  /** Number of checks that failed with severity "warn". */
  warnCount: number;
}
```

#### `up.ts` type extensions

```typescript
// Add to UpOptions:
export interface UpOptions {
  // ... existing fields ...
  /** Skip host-side validation (downgrade errors to warnings). */
  skipValidation?: boolean;
}

// Add to UpResult.phases:
export interface UpResult {
  // ... existing fields ...
  phases: {
    workspaceLayout?: { exitCode: number; message: string };
    hostValidation?: { exitCode: number; message: string };
    // ... existing phase fields ...
  };
}
```

### 2. `workspace-detector.ts` — Detailed Implementation

File: `packages/lace/src/lib/workspace-detector.ts`

#### Function signatures

```typescript
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename, isAbsolute, sep } from "node:path";

/**
 * Classify a workspace directory's git layout using filesystem-only detection.
 * No git binary required for core detection. Supplemental warnings may use git.
 */
export function classifyWorkspace(workspacePath: string): ClassificationResult;

/**
 * Parse a .git file's "gitdir: <target>" content and resolve the target path.
 * Returns the resolved absolute path of the gitdir target.
 * Throws if the file doesn't start with "gitdir: ".
 */
export function resolveGitdirPointer(
  dotGitFilePath: string,
): { resolvedPath: string; isAbsolute: boolean; rawTarget: string };

/**
 * Walk up from a resolved worktrees path to find the bare-repo root.
 * Given a path like /foo/project/.bare/worktrees/main, returns /foo/project.
 * The bare-repo root is the parent of the directory containing "worktrees/".
 */
export function findBareRepoRoot(resolvedWorktreePath: string): string | null;

/**
 * Check sibling worktrees in the bare-repo tree for absolute gitdir paths.
 * Returns warnings for worktrees using absolute paths.
 * Only scans immediate children of bareRepoRoot (nikitabobko convention).
 * Worktrees outside the bare-repo root directory are not scanned.
 *
 * @param excludeWorktree Name of worktree to skip (avoids duplicate warnings
 *   when the current worktree was already checked by classifyWorkspace).
 */
export function checkAbsolutePaths(
  bareRepoRoot: string,
  excludeWorktree?: string,
): ClassificationWarning[];
```

#### Core algorithm (`classifyWorkspace`)

```typescript
export function classifyWorkspace(workspacePath: string): ClassificationResult {
  const absPath = resolve(workspacePath);
  const dotGitPath = join(absPath, ".git");
  const warnings: ClassificationWarning[] = [];

  // Step 1: Check if .git exists at all
  if (!existsSync(dotGitPath)) {
    // E4: Check for non-nikitabobko standard bare repo
    if (
      existsSync(join(absPath, "HEAD")) &&
      existsSync(join(absPath, "objects"))
    ) {
      warnings.push({
        code: "standard-bare",
        message:
          "Workspace appears to be a standard bare git repo (not the nikitabobko convention). " +
          "The nikitabobko layout (.git file -> .bare/) is recommended for devcontainer compatibility.",
        remediation:
          "See https://morgan.cugerone.com/blog/worktrees-step-by-step/ for migration guidance.",
      });
      return { classification: { type: "standard-bare" }, warnings };
    }
    return { classification: { type: "not-git" }, warnings };
  }

  // Step 2: Determine if .git is a file or directory
  const stat = statSync(dotGitPath);

  if (stat.isDirectory()) {
    return { classification: { type: "normal-clone" }, warnings };
  }

  if (!stat.isFile()) {
    return {
      classification: { type: "malformed", reason: ".git exists but is neither file nor directory" },
      warnings,
    };
  }

  // Step 3: .git is a FILE — parse "gitdir: <target>"
  let pointer;
  try {
    pointer = resolveGitdirPointer(dotGitPath);
  } catch (err) {
    return {
      classification: { type: "malformed", reason: (err as Error).message },
      warnings,
    };
  }

  // Step 4: Determine if this is a worktree or the bare-root
  const resolvedPath = pointer.resolvedPath;

  if (resolvedPath.includes(`${sep}worktrees${sep}`) || resolvedPath.includes("/worktrees/")) {
    // This is a WORKTREE
    const bareRoot = findBareRepoRoot(resolvedPath);
    if (!bareRoot) {
      return {
        classification: {
          type: "malformed",
          reason: `gitdir points to worktrees path but could not locate bare-repo root: ${resolvedPath}`,
        },
        warnings,
      };
    }

    if (pointer.isAbsolute) {
      warnings.push({
        code: "absolute-gitdir",
        message:
          `Worktree '${basename(absPath)}' uses an absolute gitdir path (${pointer.rawTarget}) ` +
          "that will not resolve inside the container.",
        remediation:
          "Run `git worktree repair --relative-paths` (requires git 2.48+) or recreate the worktree.",
      });
    }

    // Also check sibling worktrees for absolute paths (excluding current to avoid duplicates)
    warnings.push(...checkAbsolutePaths(bareRoot, basename(absPath)));

    return {
      classification: {
        type: "worktree",
        bareRepoRoot: bareRoot,
        worktreeName: basename(absPath),
        usesAbsolutePath: pointer.isAbsolute,
      },
      warnings,
    };
  }

  // The .git file points to .bare (or similar) — this is the BARE-ROOT
  if (existsSync(join(resolvedPath, "HEAD"))) {
    return {
      classification: { type: "bare-root", bareRepoRoot: absPath },
      warnings,
    };
  }

  return {
    classification: {
      type: "malformed",
      reason: `gitdir target ${resolvedPath} does not appear to be a git directory (no HEAD found)`,
    },
    warnings,
  };
}
```

#### `resolveGitdirPointer` implementation

```typescript
export function resolveGitdirPointer(
  dotGitFilePath: string,
): { resolvedPath: string; isAbsolute: boolean; rawTarget: string } {
  const content = readFileSync(dotGitFilePath, "utf-8").trim();

  if (!content.startsWith("gitdir: ")) {
    throw new Error(
      `Unexpected .git file format at ${dotGitFilePath}: ` +
      `expected "gitdir: <path>" but got "${content.slice(0, 50)}"`,
    );
  }

  const rawTarget = content.slice("gitdir: ".length).trim();
  const usesAbsolute = isAbsolute(rawTarget);
  const resolvedPath = usesAbsolute
    ? rawTarget
    : resolve(dirname(dotGitFilePath), rawTarget);

  return { resolvedPath, isAbsolute: usesAbsolute, rawTarget };
}
```

#### `findBareRepoRoot` implementation

```typescript
export function findBareRepoRoot(resolvedWorktreePath: string): string | null {
  let current = resolvedWorktreePath;

  while (current !== dirname(current)) {
    if (basename(current) === "worktrees") {
      const bareInternals = dirname(current);
      if (existsSync(join(bareInternals, "HEAD"))) {
        return dirname(bareInternals);
      }
    }
    current = dirname(current);
  }

  return null;
}
```

#### `checkAbsolutePaths` implementation

```typescript
export function checkAbsolutePaths(
  bareRepoRoot: string,
  excludeWorktree?: string,
): ClassificationWarning[] {
  const warnings: ClassificationWarning[] = [];

  try {
    const entries = readdirSync(bareRepoRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      // Skip the current worktree (already checked by classifyWorkspace)
      if (excludeWorktree && entry.name === excludeWorktree) continue;

      const worktreeGitPath = join(bareRepoRoot, entry.name, ".git");
      if (!existsSync(worktreeGitPath)) continue;

      const stat = statSync(worktreeGitPath);
      if (!stat.isFile()) continue;

      try {
        const pointer = resolveGitdirPointer(worktreeGitPath);
        if (pointer.isAbsolute) {
          warnings.push({
            code: "absolute-gitdir",
            message:
              `Worktree '${entry.name}' uses an absolute gitdir path (${pointer.rawTarget}) ` +
              "that will not resolve inside the container.",
            remediation:
              "Run `git worktree repair --relative-paths` (requires git 2.48+).",
          });
        }
      } catch { /* skip malformed .git files in sibling worktrees */ }
    }
  } catch { /* if we can't read the directory, skip the supplemental check */ }

  return warnings;
}
```

### 3. Test helper: `createBareRepoWorkspace`

Add to `packages/lace/src/__tests__/helpers/scenario-utils.ts`:

```typescript
export interface BareRepoWorkspace {
  root: string;
  worktrees: Record<string, string>;
  bareDir: string;
}

export function createBareRepoWorkspace(
  parentDir: string,
  projectName: string,
  worktreeNames: string[] = ["main"],
  options: { useAbsolutePaths?: boolean } = {},
): BareRepoWorkspace {
  const root = join(parentDir, projectName);
  const bareDir = join(root, ".bare");

  mkdirSync(join(bareDir, "objects"), { recursive: true });
  mkdirSync(join(bareDir, "refs"), { recursive: true });
  writeFileSync(join(bareDir, "HEAD"), "ref: refs/heads/main\n", "utf-8");
  writeFileSync(join(root, ".git"), "gitdir: ./.bare\n", "utf-8");

  const worktrees: Record<string, string> = {};
  for (const name of worktreeNames) {
    const worktreeDir = join(root, name);
    const worktreeGitStateDir = join(bareDir, "worktrees", name);

    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(worktreeGitStateDir, { recursive: true });

    const gitdirTarget = options.useAbsolutePaths
      ? join(bareDir, "worktrees", name)
      : `../.bare/worktrees/${name}`;
    writeFileSync(join(worktreeDir, ".git"), `gitdir: ${gitdirTarget}\n`, "utf-8");
    writeFileSync(join(worktreeGitStateDir, "commondir"), "../..\n", "utf-8");
    writeFileSync(
      join(worktreeGitStateDir, "gitdir"),
      join(root, name, ".git") + "\n",
      "utf-8",
    );

    worktrees[name] = worktreeDir;
  }

  return { root, worktrees, bareDir };
}

export function createNormalCloneWorkspace(
  parentDir: string,
  projectName: string,
): string {
  const root = join(parentDir, projectName);
  const gitDir = join(root, ".git");
  mkdirSync(join(gitDir, "objects"), { recursive: true });
  mkdirSync(join(gitDir, "refs"), { recursive: true });
  writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n", "utf-8");
  return root;
}
```

### 4. `workspace-layout.ts` — Detailed Implementation

File: `packages/lace/src/lib/workspace-layout.ts`

```typescript
import { resolve } from "node:path";
import { classifyWorkspace } from "./workspace-detector";
import type { ClassificationResult, WorkspaceConfig, WorkspaceLayoutResult } from "./types";

export function extractWorkspaceConfig(
  config: Record<string, unknown>,
): WorkspaceConfig | null {
  const customizations = config.customizations as Record<string, unknown> | undefined;
  if (!customizations) return null;
  const lace = customizations.lace as Record<string, unknown> | undefined;
  if (!lace) return null;
  const workspace = lace.workspace;
  if (!workspace || typeof workspace !== "object") return null;
  const ws = workspace as Record<string, unknown>;
  if (!ws.layout || ws.layout === false) return null;
  if (ws.layout !== "bare-worktree") {
    console.warn(
      `Warning: Unrecognized workspace layout "${ws.layout}". ` +
      `Supported values: "bare-worktree", false. Ignoring.`,
    );
    return null;
  }
  const postCreate = ws.postCreate as Record<string, unknown> | undefined;
  return {
    layout: "bare-worktree",
    mountTarget: typeof ws.mountTarget === "string" ? ws.mountTarget : "/workspace",
    postCreate: {
      safeDirectory: postCreate && typeof postCreate.safeDirectory === "boolean"
        ? postCreate.safeDirectory : true,
      scanDepth: postCreate && typeof postCreate.scanDepth === "number"
        ? postCreate.scanDepth : 2,
    },
  };
}

export function applyWorkspaceLayout(
  config: Record<string, unknown>,
  workspaceFolder: string,
): WorkspaceLayoutResult {
  const wsConfig = extractWorkspaceConfig(config);
  if (!wsConfig) {
    return { status: "skipped", message: "No workspace layout config", warnings: [] };
  }

  const mountTarget = wsConfig.mountTarget ?? "/workspace";
  const warnings: string[] = [];
  const result = classifyWorkspace(workspaceFolder);

  for (const w of result.warnings) {
    warnings.push(w.message + (w.remediation ? ` Remediation: ${w.remediation}` : ""));
  }

  const { classification } = result;

  // Validate layout matches
  if (classification.type === "normal-clone") {
    return {
      status: "error",
      message: `Workspace layout "bare-worktree" declared but ${workspaceFolder} is a normal git clone. ` +
        "Remove the workspace.layout setting or convert to the bare-worktree convention.",
      warnings,
    };
  }
  if (classification.type === "not-git" || classification.type === "standard-bare" ||
      classification.type === "malformed") {
    const reason = classification.type === "malformed" ? classification.reason : classification.type;
    return {
      status: "error",
      message: `Workspace layout "bare-worktree" declared but detection failed: ${reason}`,
      warnings,
    };
  }

  let bareRepoRoot: string;
  let worktreeName: string | null;

  if (classification.type === "worktree") {
    bareRepoRoot = classification.bareRepoRoot;
    worktreeName = classification.worktreeName;
  } else {
    bareRepoRoot = classification.bareRepoRoot;
    worktreeName = null;
  }

  const userHasWorkspaceMount = "workspaceMount" in config && config.workspaceMount != null;
  const userHasWorkspaceFolder = "workspaceFolder" in config && config.workspaceFolder != null;

  if (!userHasWorkspaceMount) {
    config.workspaceMount =
      `source=${bareRepoRoot},target=${mountTarget},type=bind,consistency=delegated`;
  }
  if (!userHasWorkspaceFolder) {
    config.workspaceFolder = worktreeName ? `${mountTarget}/${worktreeName}` : mountTarget;
  }

  // Merge postCreateCommand
  if (wsConfig.postCreate?.safeDirectory !== false) {
    mergePostCreateCommand(config, "git config --global --add safe.directory '*'");
  }

  // Merge vscode settings
  if (wsConfig.postCreate?.scanDepth != null) {
    mergeVscodeSettings(config, { "git.repositoryScanMaxDepth": wsConfig.postCreate.scanDepth });
  }

  return {
    status: "applied",
    message: worktreeName
      ? `Auto-configured for worktree '${worktreeName}' in ${bareRepoRoot}`
      : `Auto-configured for bare-repo root ${bareRepoRoot}`,
    warnings,
  };
}
```

The `mergePostCreateCommand()` and `mergeVscodeSettings()` are private helpers:

```typescript
/**
 * Merge a command into postCreateCommand with idempotency.
 * Skips injection if the command already appears in the existing value.
 * Follows the same format handling as generateExtendedConfig() in up.ts.
 */
function mergePostCreateCommand(config: Record<string, unknown>, command: string): void {
  const existing = config.postCreateCommand;

  // Idempotency: check if command already present
  if (typeof existing === "string" && existing.includes(command)) return;
  if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
    const values = Object.values(existing as Record<string, unknown>);
    if (values.some((v) => typeof v === "string" && v.includes(command))) return;
  }

  if (!existing) {
    config.postCreateCommand = command;
  } else if (typeof existing === "string") {
    config.postCreateCommand = `${existing} && ${command}`;
  } else if (Array.isArray(existing)) {
    config.postCreateCommand = {
      "lace:user-setup": existing,
      "lace:workspace": command,
    };
  } else if (typeof existing === "object") {
    const obj = existing as Record<string, unknown>;
    if (!("lace:workspace" in obj)) {
      obj["lace:workspace"] = command;
      config.postCreateCommand = obj;
    }
  }
}

/**
 * Deep-merge settings into customizations.vscode.settings.
 * Creates the nested structure if absent. User-set values are never overridden.
 */
function mergeVscodeSettings(
  config: Record<string, unknown>,
  settings: Record<string, unknown>,
): void {
  if (!config.customizations || typeof config.customizations !== "object") {
    config.customizations = {};
  }
  const customizations = config.customizations as Record<string, unknown>;
  if (!customizations.vscode || typeof customizations.vscode !== "object") {
    customizations.vscode = {};
  }
  const vscode = customizations.vscode as Record<string, unknown>;
  if (!vscode.settings || typeof vscode.settings !== "object") {
    vscode.settings = {};
  }
  const existingSettings = vscode.settings as Record<string, unknown>;
  for (const [key, value] of Object.entries(settings)) {
    if (!(key in existingSettings)) {
      existingSettings[key] = value;
    }
  }
}
```

### 5. `up.ts` Modifications — Exact Insertion Points

#### New imports (at top of file)

```typescript
import { applyWorkspaceLayout } from "./workspace-layout";
import { runHostValidation } from "./host-validator";
```

#### `UpOptions` addition (after `skipMetadataValidation`)

```typescript
  /** Skip host-side validation (downgrade errors to warnings) */
  skipValidation?: boolean;
```

#### `UpResult.phases` additions (before `portAssignment`)

```typescript
    workspaceLayout?: { exitCode: number; message: string };
    hostValidation?: { exitCode: number; message: string };
```

#### Destructure `skipValidation` (in `runUp()` destructuring)

```typescript
    skipValidation = false,
```

#### Phase 0 insertion (after line 123 — after `configMinimal` read, before `hasPrebuildFeatures`)

```typescript
  // ── Phase 0a: Workspace layout detection + auto-configuration ──
  // NOTE: This must run before the structuredClone at line 221 so that
  // workspaceMount/workspaceFolder/postCreateCommand mutations propagate
  // into configForResolution and through the rest of the pipeline.
  {
    const layoutResult = applyWorkspaceLayout(configMinimal.raw, workspaceFolder);

    if (layoutResult.status === "applied") {
      result.phases.workspaceLayout = { exitCode: 0, message: layoutResult.message };
      console.log(layoutResult.message);
    } else if (layoutResult.status === "error" && !skipValidation) {
      result.phases.workspaceLayout = { exitCode: 1, message: layoutResult.message };
      result.exitCode = 1;
      result.message = `Workspace layout failed: ${layoutResult.message}`;
      return result;
    } else if (layoutResult.status === "error" && skipValidation) {
      console.warn(`Warning: ${layoutResult.message} (continuing due to --skip-validation)`);
      result.phases.workspaceLayout = { exitCode: 0, message: `${layoutResult.message} (downgraded)` };
    }
    // status === "skipped": no workspace config present, nothing to do

    for (const warning of layoutResult.warnings) {
      console.warn(`Warning: ${warning}`);
    }
  }

  // ── Phase 0b: Host-side validation ──
  {
    const validationResult = runHostValidation(configMinimal.raw, { skipValidation });

    if (validationResult.checks.length > 0) {
      for (const check of validationResult.checks) {
        if (!check.passed) {
          const prefix = check.severity === "error" ? "ERROR" : "Warning";
          console.warn(`${prefix}: ${check.message}`);
          if (check.hint) console.warn(`  Hint: ${check.hint}`);
        }
      }

      if (!validationResult.passed) {
        const msg = `Host validation failed: ${validationResult.errorCount} error(s). ` +
          "Use --skip-validation to downgrade to warnings.";
        result.phases.hostValidation = { exitCode: 1, message: msg };
        result.exitCode = 1;
        result.message = msg;
        return result;
      }

      result.phases.hostValidation = {
        exitCode: 0,
        message: validationResult.warnCount > 0
          ? `Passed with ${validationResult.warnCount} warning(s)`
          : `All ${validationResult.checks.length} check(s) passed`,
      };
    }
  }
```

### 6. `commands/up.ts` Modifications

Add `--skip-validation` to the `args` object following the `--skip-metadata-validation` pattern. In the `run()` function, extract the arg, add it to the filter list for devcontainerArgs passthrough, and include it in the `UpOptions`.

### 7. Summary of Files to Create and Modify

**New files (Phase 1):**
- `packages/lace/src/lib/workspace-detector.ts`
- `packages/lace/src/lib/workspace-layout.ts`
- `packages/lace/src/lib/__tests__/workspace-detector.test.ts`
- `packages/lace/src/lib/__tests__/workspace-layout.test.ts`

**New files (Phase 2):**
- `packages/lace/src/lib/host-validator.ts`
- `packages/lace/src/lib/__tests__/host-validator.test.ts`

**Modified files:**
- `packages/lace/src/lib/up.ts` — add `skipValidation` to `UpOptions`, add phase fields to `UpResult.phases`, insert Phase 0a/0b
- `packages/lace/src/commands/up.ts` — add `--skip-validation` CLI arg
- `packages/lace/src/__tests__/helpers/scenario-utils.ts` — add `createBareRepoWorkspace()` + `createNormalCloneWorkspace()`
- `packages/lace/src/commands/__tests__/up.integration.test.ts` — add workspace layout and host validation integration tests
