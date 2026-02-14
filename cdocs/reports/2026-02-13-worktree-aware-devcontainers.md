---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T14:00:00-08:00
task_list: lace/worktree-support
type: report
state: live
status: wip
tags: [git, worktrees, devcontainer, bare-repo, analysis, architecture]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-13T16:30:00-08:00
  round: 1
---

# Worktree-Aware Devcontainers: Affordances for Bare-Repo Git Worktrees in Lace

> NOTE: This report considers a single container model: mount the entire bare-repo root (all worktrees) into one devcontainer, then navigate between worktrees as sibling directories within that container. The one-container-per-worktree model (as pursued by BranchBox, DevTree, and the devcontainers/cli `--mount-git-worktree-common-dir` flag) is a different architecture and out of scope.

> BLUF: The bare-repo worktree pattern is becoming the standard git isolation strategy for parallel development, but devcontainer tooling still treats it as a second-class citizen. Lace is well-positioned: its own devcontainer already uses the parent-mount pattern, and its config generation pipeline is the natural place to automate it. This report maps three tiers of potential support, from passive validation through auto-configuration. The sweet spot is Tier 2: a `customizations.lace.worktree` config block that auto-generates the correct mount configuration, eliminating the manual boilerplate that currently gates adoption.

## Context / Background

### The bare-repo worktree pattern

The "bare clone" workflow uses `git clone --bare` to create a repository without a working tree, then uses `git worktree add` to create multiple checked-out branches as sibling directories:

```
my-project/
  .bare/                  # bare git repo (objects, refs, config)
  .git                    # text file: "gitdir: ./.bare"
  main/                   # worktree on main branch
  feature-auth/           # worktree on feature-auth branch
  hotfix/                 # worktree on hotfix branch
```

This pattern has been adopted by the AI agent ecosystem (Cursor's parallel agents, Cline's worktree isolation, Dagger's container-use, Claude Code's parallel-cc) and by developer tooling (VS Code 1.103+ native support, gtr/git-worktree-runner, lazygit). It solves a real problem: switching branches is expensive (reinstall dependencies, rebuild, lose editor state), and worktrees eliminate that cost entirely.

### The devcontainer gap

When you open a worktree in a devcontainer, the container only sees the worktree directory, not the bare repo parent. Inside the worktree, `.git` is a *file* containing `gitdir: ../.bare/worktrees/main`, which points to a path outside the mount. Every `git` command fails with `fatal: not a git repository`.

The workaround is manual: override `workspaceMount` to mount the parent directory and set `workspaceFolder` to the worktree subdirectory. Lace's own devcontainer does exactly this. But this configuration is bespoke, error-prone, and requires the user to understand the mount plumbing.

### What lace does today

Lace is currently workspace-agnostic. The `lace up` pipeline:
1. Reads `.devcontainer/devcontainer.json` as JSONC
2. Resolves `${lace.port()}` templates to concrete port numbers
3. Processes prebuild features, repo mounts, and port declarations
4. Generates `.lace/devcontainer.json` with resolved values
5. Invokes `devcontainer up --config .lace/devcontainer.json`

Crucially, `workspaceMount` and `workspaceFolder` pass through **unchanged**. Lace does not inspect git state, validate directory structure, or modify mount configuration. Worktree support is entirely a concern of the user-authored `devcontainer.json`.

### Prior art in this repo

Two archived reports cover the broader git-isolation landscape:

- [Git Parallelism Strategies for Agent-Oriented Devcontainer Workspaces](./2026-02-02-git-parallelism-strategies-for-agent-devcontainers.md) — evaluates 7 strategies; concludes worktrees are strong for single-agent/supervised work.
- [Operational Tradeoffs of Git Parallelism](./2026-02-02-git-parallelism-operational-tradeoffs.md) — examines history management, state sync, and shared-state risks.

This report builds on those findings by asking the implementation question: **what should lace do to make the parent-mount worktree pattern automatic?**

## Key Findings

### What breaks without worktree awareness

| Scenario | What happens | Severity |
|---|---|---|
| User opens worktree in devcontainer without `workspaceMount` override | `git` commands fail inside container: `.git` file points outside the mount | **Fatal** |
| `safe.directory` not configured in `postCreateCommand` | Git rejects operations because mounted files are owned by a different UID | **Fatal** |
| User mounts `..` but parent is a normal clone (not bare-repo layout) | Mounts the wrong directory; `workspaceFolder` path doesn't exist | **Confusing** |
| `.git` file uses absolute path (default before Git 2.48) | Path doesn't resolve inside the container even with parent mount | **Breaking** |
| Agent runs `git gc --prune=now` in one worktree | Objects needed by in-progress operations in other worktrees may be deleted | **Destructive** |
| Agent runs `git stash` in one worktree | Stash is global: other terminals/agents in the same container see it | **Surprising** |
| `git.repositoryScanMaxDepth` not increased | VS Code Source Control panel doesn't discover sibling worktrees | **Degraded UX** |

### Lace's structural advantage

The `.lace/devcontainer.json` generation pipeline is the right place to inject worktree-aware configuration. Lace already transforms the source devcontainer.json (resolving port templates, rebasing paths, merging port entries). Adding mount overrides for worktree support is architecturally consistent: the source `devcontainer.json` declares intent (`worktree: { enabled: "auto" }`), and lace resolves it to concrete mount configuration in the generated output.

### The `.git` file path resolution chain

In a bare-repo worktree setup, git resolves the repository through a two-hop chain:

```
worktree/.git  (file)
  → gitdir: ../.bare/worktrees/main  (relative path to worktree metadata)
    → ../.bare/worktrees/main/commondir  (file)
      → "../.."  (relative path back to .bare/)
        → .bare/  (the actual object store, refs, config)
```

The parent-mount approach (mount the entire bare-repo root at `/workspace`) preserves this chain because all relative paths resolve within the mount. This sidesteps the absolute-vs-relative path problem that plagues tools mounting a single worktree: when the entire tree is mounted, `../.bare/worktrees/main` resolves correctly regardless of where `/workspace` lives on the host.

That said, validation should still warn on absolute paths. They would break if the host path differs from the container mount path (which it always does), and they indicate a worktree that wasn't created with `--relative-paths`.

### Absolute vs. relative path landscape

| Git version | Default `.git` file path | Relative support |
|---|---|---|
| < 2.48 | Absolute | Manual only (`git-worktree-relative` tool or hand-edit) |
| 2.48+ | Absolute (unless configured) | `git worktree add --relative-paths` per-worktree |
| 2.48+ with config | Relative | `git config worktree.useRelativePaths true` (sets `extensions.relativeWorktrees`) |

## Analysis: Three Tiers of Support

### Tier 0: Documentation only (no code changes)

**What:** Document the bare-repo + worktree devcontainer pattern. Provide a reference `devcontainer.json` snippet. Warn about common pitfalls (`safe.directory`, absolute paths, `repositoryScanMaxDepth`).

**Effort:** Minimal.

**Value:** Low. The information exists scattered across blog posts and GitHub issues but isn't consolidated. Helps users who are already worktree-curious but doesn't lower the adoption barrier.

**Verdict:** Necessary foundation regardless of which tier we pursue. Not sufficient on its own.

### Tier 1: Workspace validation

**What:** `lace up` inspects the workspace before invoking `devcontainer up` and provides actionable warnings or errors.

**Detections:**

| Check | Trigger | Action |
|---|---|---|
| `.git` is a file (worktree) but `workspaceMount` doesn't mount parent | Always | **Error** with fix suggestion |
| `.git` is a file with absolute `gitdir:` path | Always | **Warning**: recommend `git worktree repair --relative-paths` or Git 2.48+ config |
| `workspaceMount` mounts `..` but parent has no `.bare/` or `.git/` directory | When `workspaceMount` contains `${localWorkspaceFolder}/..` | **Warning**: parent doesn't look like a bare-repo root |
| `safe.directory` not in `postCreateCommand` | When worktree detected | **Warning**: suggest adding `git config --global --add safe.directory '*'` |

**Effort:** Moderate. Requires reading `.git` file, checking mount config, validating parent directory structure. All local filesystem operations, no new dependencies.

**Value:** High. Prevents the most common failure modes. Users get clear errors instead of cryptic `fatal: not a git repository` inside the container.

**Trade-offs:**
- Must handle `.git` directories (normal clones) gracefully with no false warnings
- Detection logic must work both when the user has written a correct worktree config and when they haven't
- The bare-repo layout (`.bare/` + `.git` file) is convention, not specification: some users use `git clone --bare repo.git` directly without the `.bare` wrapper

### Tier 2: Auto-configuration (recommended)

**What:** A `customizations.lace.worktree` configuration block that makes worktree devcontainers work automatically.

```jsonc
{
  "customizations": {
    "lace": {
      "worktree": {
        "enabled": true,           // or "auto" (detect), false (disable)
        "mountTarget": "/workspace", // where to mount the bare-repo root
        "defaultCwd": null          // override workspaceFolder; null = auto-detect
      }
    }
  }
}
```

When `worktree.enabled` is `true` or `"auto"`:
- Lace auto-generates `workspaceMount` and `workspaceFolder` in `.lace/devcontainer.json`
- Injects `git config --global --add safe.directory '*'` into `postCreateCommand` if not already present
- Validates `.git` file paths are relative
- Sets `git.repositoryScanMaxDepth: 2` in VS Code customizations (so sibling worktrees are discoverable)

**Resolution logic:**

1. Check if `.git` is a file containing `gitdir:`
2. If yes: resolve the bare-repo root (walk up from `gitdir` target to find the directory containing objects/refs)
3. Generate `workspaceMount`: `source=<bare-repo-root>,target=<mountTarget>,type=bind,consistency=delegated`
4. Generate `workspaceFolder`: `<mountTarget>/<current-worktree-directory-name>`
5. If no: pass through `workspaceMount`/`workspaceFolder` unchanged (normal clone behavior)

**Effort:** Moderate-to-high. Extends the config generation pipeline, adds workspace detection logic to `up.ts`, needs thorough testing of normal-clone vs. worktree vs. bare-repo-without-wrapper cases.

**Value:** Very high. Eliminates the manual configuration entirely. A user adds `"worktree": { "enabled": "auto" }` and everything works. The devcontainer.json is portable: works for contributors with and without bare-repo setups because `"auto"` detects the layout at `lace up` time.

**Trade-offs:**
- `"auto"` detection must be reliable. False positives (treating a normal clone as a worktree) would mount the wrong directory. In practice, `.git`-is-a-file is an unambiguous signal, so this risk is low.
- The resolved `workspaceMount` in `.lace/devcontainer.json` will differ between contributors who use bare-repo and those who don't. This is by design (`.lace/` is gitignored), but may confuse debugging.

### Tier comparison matrix

| Dimension | Tier 0 (Docs) | Tier 1 (Validate) | Tier 2 (Auto-config) |
|---|---|---|---|
| Prevents `fatal: not a git repository` | No | Yes (error message) | Yes (auto-fix) |
| Prevents missing `safe.directory` | No | Yes (warning) | Yes (auto-inject) |
| Requires manual `workspaceMount` | Yes | Yes (but guided) | No |
| Works for non-worktree users | N/A | Yes (no false positives) | Yes (`"auto"` detection) |
| Effort | Minimal | Moderate | Moderate-high |

## In-Container Developer Experience

In the parent-mount model, all worktrees are sibling directories under `/workspace/`. The developer experience centers on navigating between them within one running container.

### Terminal navigation

Switching worktrees is `cd ../feature-auth`. Shell prompts that show the git branch (starship, oh-my-zsh, etc.) update automatically because each worktree has its own `HEAD`. `git worktree list` from inside the container shows all worktrees with their paths and branches, and the paths are correct (they resolve within the mount).

WezTerm panes and tabs map naturally to worktrees: one pane per worktree, each with its CWD set to a different `/workspace/<worktree>/` directory. The container's wezterm mux server sets `default_cwd` to the primary worktree (e.g., `/workspace/main`), and new panes open there by default.

### IDE worktree discovery

- **VS Code**: `git.repositoryScanMaxDepth: 2` causes the Source Control panel to discover sibling worktrees. The `jackiotyu.git-worktree-manager` extension (already in lace's devcontainer) provides a dedicated UI for switching between them.
- **Neovim**: `ThePrimeagen/git-worktree.nvim` provides telescope integration for worktree switching. Fugitive and gitsigns handle the `.git` file correctly (they follow the `gitdir:` pointer).

### Build artifacts and dependencies

Each worktree has its own `node_modules/`, `dist/`, `.next/`, etc. In the single-container model, this is disk usage within one container, not duplication across containers. The practical question is whether to install dependencies in every worktree or share them:

- **pnpm** uses a content-addressable store with symlinks: each worktree's `node_modules` is cheap because it links to a shared store
- **Worktrees for code review** (not active development) may not need dependencies installed at all
- **Shared volume mounts** for caches (e.g., `.turbo/`, `.nx/`) could reduce redundant builds, but add configuration complexity

### Lifecycle commands and CWD

When `workspaceFolder` is a subdirectory of the mount (e.g., `/workspace/main` inside a `/workspace` mount), `postCreateCommand` and `postStartCommand` run with CWD set to `workspaceFolder`. `devcontainer exec` also uses `workspaceFolder` as its CWD. This means lifecycle commands operate in the correct worktree by default.

If `lace up` is invoked from a worktree that is *not* the one specified in `workspaceFolder`, the container still opens in the configured worktree. The invoking worktree doesn't affect the container's CWD. With Tier 2 auto-configuration, `workspaceFolder` would be set to whichever worktree `lace up` was invoked from.

## Risk Assessment: Shared-State Hazards

These hazards are inherent to the worktree model (multiple branches sharing one git object store) and apply regardless of whether it's one container or many:

### Hazards that lace could mitigate

| Hazard | Mechanism | Possible lace mitigation |
|---|---|---|
| `git gc --prune=now` deleting objects | Aggressive GC in any terminal can remove objects needed by in-progress operations in other worktrees | Set `gc.pruneExpire=never` in `.bare/config` via `postCreateCommand`; document the risk |
| `git stash` pollution | Stash is global, not per-worktree; a stash from one terminal appears in all others | Document "never use stash with worktrees; use WIP commits on throwaway branches"; optionally install a git alias that warns |
| Missing `safe.directory` | UID mismatch between host and container user | Auto-inject into `postCreateCommand` (Tier 2) |
| Per-worktree disk usage | Each worktree has independent `node_modules`/build caches | Document pnpm as mitigation; could suggest shared cache volumes |

### Hazards that lace cannot mitigate

| Hazard | Why |
|---|---|
| Merge conflicts between branches | Fundamental to parallel development |
| `git branch -D` affecting all worktrees | Git design: branches are global |
| Submodule support in worktrees | Git limitation: "support for submodules is incomplete" |

## Ecosystem Context

The broader worktree + container ecosystem is converging on two models. Several tools (BranchBox, DevTree, Sprout, Dagger's container-use) pursue the one-container-per-worktree model, providing full environment isolation per branch. Lace's single-container parent-mount model is different: it optimizes for fluid cross-worktree navigation within one environment.

The most relevant ecosystem references for lace's model:

- **gtr (CodeRabbit)**: Worktree lifecycle CLI with post-creation hooks (e.g., `npm install`). Not container-aware, but its `.gtrconfig` file for team-shareable worktree conventions is a useful pattern.
- **visheshd/claude-devcontainer**: Uses a PATH-intercept git wrapper to translate host paths to container paths at runtime. Demonstrates the problem lace should solve, but via a fragile mechanism. Lace should solve at the mount layer, not the git command layer.
- **devcontainers/cli `--mount-git-worktree-common-dir`** (v0.81.0): Mounts just the git common directory alongside a single worktree. Designed for the one-container-per-worktree model; not applicable to the parent-mount approach.

### Not recommended: git-wrapper approach

The PATH-intercept git wrapper (as in claude-devcontainer) introduces a maintenance burden and surprising behavior. Lace should solve the problem at the mount layer.

### Not recommended: devcontainer feature for worktree support

A devcontainer feature cannot modify mount configuration (features run during image build, before workspace mount). The mount problem must be solved by the tool invoking `devcontainer up`, which is lace.

## Recommendations

**Implement Tier 2** (the `customizations.lace.worktree` config block), with Tier 1 validation checks as a natural byproduct of the detection logic.

Implementation approach:
1. Add worktree detection to `up.ts` after config read but before template resolution
2. When worktree mode is active, generate `workspaceMount` and `workspaceFolder` in `.lace/devcontainer.json`
3. Auto-inject `safe.directory` config into `postCreateCommand`
4. Auto-set `git.repositoryScanMaxDepth: 2` in VS Code customizations
5. When worktree mode is active but the user has already provided explicit `workspaceMount`/`workspaceFolder`, validate them and warn if they look wrong (Tier 1 behavior)

## Appendix: Reference Configuration

### Current lace devcontainer (manual worktree config)

```jsonc
{
  "name": "Lace Development (Worktrees)",
  "workspaceMount": "source=${localWorkspaceFolder}/..,target=/workspace,type=bind,consistency=delegated",
  "workspaceFolder": "/workspace/main",
  "postCreateCommand": "git config --global --add safe.directory '*'",
  "customizations": {
    "vscode": {
      "settings": {
        "git.repositoryScanMaxDepth": 2
      }
    }
  }
}
```

### Proposed lace-managed equivalent (Tier 2)

```jsonc
{
  "name": "My Project",
  "customizations": {
    "lace": {
      "worktree": {
        "enabled": "auto"
      }
    }
  }
  // workspaceMount, workspaceFolder, safe.directory, and repositoryScanMaxDepth
  // are all auto-generated by lace into .lace/devcontainer.json
}
```

### What `.lace/devcontainer.json` would contain (generated)

```jsonc
{
  "name": "My Project",
  "workspaceMount": "source=/home/user/projects/my-project,target=/workspace,type=bind,consistency=delegated",
  "workspaceFolder": "/workspace/main",
  "postCreateCommand": "git config --global --add safe.directory '*'",
  "customizations": {
    "vscode": {
      "settings": {
        "git.repositoryScanMaxDepth": 2
      }
    }
  }
}
```

## Appendix: Key External References

- [devcontainers/cli#796](https://github.com/devcontainers/cli/issues/796) — canonical worktree support issue
- [CodeRabbit gtr](https://github.com/coderabbitai/git-worktree-runner) — worktree lifecycle CLI with team-shareable conventions
- [visheshd/claude-devcontainer](https://github.com/visheshd/claude-devcontainer) — git-wrapper approach (illustrative anti-pattern)
- [Morgan Cugerone: Bare repo worktree setup](https://morgan.cugerone.com/blog/how-to-use-git-worktree-and-in-a-clean-way/)
