---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-05T14:00:00-06:00
task_list: lace/worktree-conversion
type: proposal
state: live
status: review_ready
tags: [worktree, bare-worktree, conversion, nushell, git, workspace-layout, dotfiles, chezmoi]
related_to:
  - cdocs/proposals/2026-02-16-unify-worktree-project-identification.md
  - cdocs/proposals/2026-02-15-workspace-validation-and-layout.md
  - cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md
---

# Worktree Conversion Scripts (Nushell)

> BLUF: The `bare-worktree` workspace layout is a prerequisite for running
> multiple devcontainers from the same repo simultaneously, but converting an
> existing normal clone to this layout is a manual, error-prone process. The
> weftwise project already has a `migrate_to_bare.sh` script
> (`code/weft/weftwise/main/scripts/migrate_to_bare.sh`) that handles
> conversion, but it is project-specific (hardcoded config file lists, weftwise
> directory conventions) and not reusable. This proposal defines two nushell
> commands -- `wt convert` for conversion of existing clones and `wt clone` for
> fresh bare-worktree clones -- that generalize the weftwise script's approach
> as personal dotfile tools. Post-conversion verification uses
> `lace up --skip-devcontainer-up` to confirm the layout is valid.

## Objective

Make it trivial to adopt the `bare-worktree` layout for any project. Currently,
users must either find the weftwise migration script (which is project-specific
and lives in a different repo) or follow a multi-step manual process. Two short,
memorable commands (`wt clone`, `wt convert`) eliminate that friction.

## Background

### The Bare-Worktree Convention

The "nikitabobko convention" (named after the blog post author who popularized
it) structures a git repository as:

```
project/
  .bare/                 # Bare git database (clone --bare output)
  .git                   # File containing "gitdir: ./.bare"
  .worktree-root         # Optional marker file
  main/                  # Worktree (branch: main)
    .git                 # File containing "gitdir: ../.bare/worktrees/main"
    src/
    ...
  feature-x/             # Another worktree (branch: feature-x)
    .git                 # File containing "gitdir: ../.bare/worktrees/feature-x"
    src/
    ...
```

This layout enables each worktree to be mounted as a separate devcontainer
workspace, each with its own port allocation, while sharing the git object
database. Lace's workspace detector (`workspace-detector.ts`) identifies this
layout and the workspace layout applier (`workspace-layout.ts`) generates the
correct `workspaceMount`, `workspaceFolder`, and `postCreateCommand`.

### Existing Scripts

The weftwise project contains two bash scripts at
`/home/mjr/code/weft/weftwise/main/scripts/`:

1. **`migrate_to_bare.sh`** -- Converts a normal clone to bare-worktree layout
   by cloning bare from the existing `.git` directory, creating worktree paths
   with relative gitdir pointers, copying project-specific config files
   (`.devcontainer`, `.claude`, `.vscode`, `.env`, `.sculptor`, `.mcp.json`),
   and creating a `.worktree-root` marker file. Creates a *new* directory
   alongside the existing repo rather than converting in-place.

2. **`worktree.sh`** -- Manages worktrees within an existing bare-worktree
   layout. Supports `add`, `list`, `status`, and `remove` subcommands. Fixes
   worktree paths to use relative gitdir pointers for host/container
   portability. Hardcoded to `/workspace` mount target.

Both scripts are duplicated identically in the `loro_migration` worktree and an
older `code/apps/weft_old/scripts/` location.

### Limitations of Existing Scripts

- **Project-specific config lists**: The `ROOT_CONFIG` and `WORKTREE_CONFIG`
  arrays in `migrate_to_bare.sh` hardcode weftwise-specific files (`.sculptor`,
  `.mcp.json`). Other projects have different untracked config files.
- **No in-place conversion**: The script always creates a new sibling directory.
  Users must manually clean up the old repo.
- **No post-conversion verification**: The scripts do not validate the
  conversion against lace's workspace detector. A conversion that produces a
  layout lace cannot detect is a silent failure.
- **Hardcoded `/workspace` paths**: The `worktree.sh` script assumes the
  devcontainer mount target is always `/workspace`.
- **No stash/uncommitted change preservation**: The migration script warns about
  dirty state but does not migrate stashes or preserve uncommitted changes.
- **No remote URL fixup**: After cloning bare from a local `.git` directory, the
  remote `origin` URL points to the old local `.git` path, not the upstream
  remote.
- **Interactive prompts**: Both scripts use `read -p` for confirmation, making
  them unsuitable for scripted usage.
- **Bash, not nushell**: The scripts are written in bash, not the user's
  primary shell. They cannot leverage nushell's structured data, error handling,
  or interactive features (like `input list`).

### External Tools

- [git-worktree-manager (gwtm)](https://github.com/lucasmodrich/git-worktree-manager):
  Manages bare-clone + worktree workflows but only for fresh clones via
  `gwtm setup`, not for converting existing repos.
- [git_clone_bare_worktree](https://github.com/ckstevenson/scripts/blob/main/git_clone_bare_worktree):
  A simple script that clones bare, sets up `.git` file, configures fetch
  refspec, and creates one worktree. Fresh clone only.
- [Git worktree layout gist](https://gist.github.com/sellout/3361145fac9bf2dfdc6a9bc18dcdff36):
  Discusses organizing repos with bare worktrees but uses a non-standard
  approach (empty commit tree) rather than the nikitabobko `.bare/` convention.

None of these tools handle in-place conversion of an existing clone or integrate
with a devcontainer orchestrator.

### Lace's Role (Verification, Not Conversion)

Lace already has the building blocks for *detecting* and *validating* the
bare-worktree layout:

- **`classifyWorkspace()`** (`workspace-detector.ts`): Identifies `worktree`,
  `bare-root`, `normal-clone`, `standard-bare`, `not-git`, and `malformed`
  layouts.
- **`resolveGitdirPointer()`** (`workspace-detector.ts`): Parses `.git` files
  and detects absolute vs relative gitdir paths.
- **`checkAbsolutePaths()`** (`workspace-detector.ts`): Scans sibling worktrees
  for absolute paths that break inside containers.
- **`applyWorkspaceLayout()`** (`workspace-layout.ts`): Generates devcontainer
  config from a classified workspace.

The conversion itself does not need to be part of lace. It is a personal
workflow tool -- the kind of thing that belongs in dotfiles, not in a shared
project CLI. Lace's `classifyWorkspace()` concept is used as a post-conversion
verification step by running `lace up --skip-devcontainer-up` after conversion
to confirm the layout is recognized correctly.

## Proposed Solution

### Two Nushell Commands: `wt clone` and `wt convert`

The commands are implemented as nushell custom commands in a script file sourced
from `config.nu`, following the same pattern as the existing `wez save`,
`wez restore`, `wez list`, and `wez delete` commands in `wez-session.nu`.

**Location:** `dot_config/nushell/scripts/wt.nu` in the chezmoi dotfiles repo,
deployed to `~/.config/nushell/scripts/wt.nu`. Sourced from `config.nu` via:

```nu
source ($nu.default-config-dir | path join "scripts/wt.nu")
```

**Commands:**

```
wt clone <url> [target] [--branch <branch>] [--name <worktree-name>]
wt convert [--target <dir>] [--name <worktree-name>] [--force] [--in-place]
```

#### `wt clone`

Fresh clone directly into bare-worktree layout:

1. `git clone --bare <url> <dir>/.bare`
2. Create `.git` file with `gitdir: ./.bare`.
3. Configure fetch refspec for all branches:
   `remote.origin.fetch = +refs/heads/*:refs/remotes/origin/*`.
4. `git fetch origin` to pull all refs.
5. Determine the default branch (`git remote show origin | head` or parse
   `HEAD` ref) if `--branch` not specified.
6. Create worktree via `git worktree add <name> <branch>`.
7. Fix gitdir paths to use relative pointers (host/container portability).
8. Create `.worktree-root` marker file.
9. Print summary, directory structure, and next steps.

```nu
# Example usage:
wt clone git@github.com:org/project.git ~/code/org/project
wt clone git@github.com:org/project.git ~/code/org/project --branch develop --name dev
```

#### `wt convert`

Converts the current working directory (or a specified repo path) from a normal
git clone to the bare-worktree convention. Two modes:

1. **Adjacent mode** (default): Creates a new directory alongside the existing
   repo, similar to the weftwise `migrate_to_bare.sh` script. The original repo
   is left intact.

2. **In-place mode** (`--in-place`): Restructures the current directory. The
   `.git/` directory becomes `.bare/`, a `.git` file is created pointing to
   `.bare/`, and the current working tree contents move into a worktree
   subdirectory.

**Adjacent mode steps:**

1. Verify the current directory is a normal git clone (`.git/` is a directory
   with `objects/` inside, not a file pointing elsewhere).
2. Check for uncommitted changes and stashes. Warn if present; abort unless
   `--force`.
3. Record the current branch name and upstream remote URL.
4. Determine target directory (default: `<repodir>-worktrees`, or specified
   via `--target`).
5. `git clone --bare .git <target>/.bare`.
6. Create `<target>/.git` file with `gitdir: ./.bare`.
7. Configure fetch refspec for all remotes.
8. Fix remote origin URL to point to the upstream remote, not the local `.git`
   path.
9. `git fetch origin` in the new bare repo.
10. Create worktree: `git worktree add <name> <branch>`.
11. Fix gitdir paths to use relative pointers.
12. Copy untracked config files to appropriate locations (see Dotfile Placement).
13. Create `.worktree-root` marker file.
14. Print summary, directory tree, and next steps (including verification
    command).

**In-place mode steps:**

1. Same pre-flight checks as adjacent mode.
2. Stash uncommitted changes if any (auto-applied after conversion).
3. Record the current branch name and remote URL.
4. Move `.git/` to `.bare/`.
5. Create `.git` file with `gitdir: ./.bare`.
6. Configure fetch refspec.
7. Create the worktree subdirectory (default name: current branch name, or
   `main`, or specified via `--name`).
8. Move all working tree files/directories into the worktree subdirectory.
9. Move relevant dotfiles into appropriate locations (root vs worktree).
10. Register the worktree with `git worktree add` (pointing to existing
    checkout).
11. Fix gitdir paths to use relative pointers.
12. Pop the stash if one was created.
13. Create `.worktree-root` marker file.
14. Print summary and next steps.

### Post-Conversion Verification

Both commands print a verification step at the end:

```
Conversion complete. Verify with:
  cd <worktree-path> && lace up --skip-devcontainer-up
```

This runs lace's `classifyWorkspace()` pipeline against the new layout. If lace
recognizes it as a valid `worktree` type and generates the correct devcontainer
config, the conversion succeeded. If it reports a layout error, the conversion
produced an invalid structure.

This approach leverages lace's detection capabilities without coupling the
conversion tool to lace's internals. The scripts are standalone nushell
commands; lace is used as a verifier, not a dependency.

### Dotfile Placement Heuristics

The weftwise script hardcodes which files go to the bare-repo root vs the
worktree. A general-purpose tool needs heuristics:

**Always at bare-repo root** (shared across worktrees):
- `.devcontainer/` -- container config is per-repo, not per-branch
- `.worktree-root` -- marker file

**Always in worktree** (per-branch state):
- All tracked files (moved automatically since they are the working tree)
- `.claude/` -- agent context is branch-specific
- `.vscode/` -- workspace settings may differ per branch

**Copy to worktree by default** (can be shared manually if needed):
- `.env`, `.env.local` -- usually per-worktree to avoid port conflicts
- `.mcp.json` -- may reference worktree-specific paths
- Other untracked dotfiles found in the repo root

The heuristics are simple defaults. Since this is a personal dotfile tool (not a
shared library), if a specific project needs different placement, the user
adjusts manually after conversion. No configuration file or interactive prompt
is needed.

### Relative Gitdir Path Fixup

A critical detail from the weftwise scripts that must be preserved: after
`git worktree add`, the `.git` file inside the worktree and the `gitdir` file
inside `.bare/worktrees/<name>/` use absolute paths by default. These break when
the repo is mounted inside a devcontainer at a different path.

The fix (from weftwise `fix_worktree_paths`):

```nu
# Fix worktree .git file to use relative path
"gitdir: ../.bare/worktrees/<name>" | save -f <worktree>/.git

# Fix bare repo's worktree gitdir to use relative path back
"../../<name>/.git" | save -f .bare/worktrees/<name>/gitdir
```

Git 2.48+ has `git worktree repair --relative-paths` but we cannot assume that
version is available. The manual fixup works on all git versions.

## Important Design Decisions

### Decision: Nushell Scripts in Dotfiles, Not Built Into Lace

**Decision:** Implement as nushell custom commands in the chezmoi-managed
dotfiles, not as lace CLI subcommands.

**Why:** Worktree conversion is a personal workflow operation, not a project
build tool. It runs on the host machine, outside any devcontainer, and only
needs to happen once per project. Putting it in lace would mean:
- Requiring lace to be installed on the host (lace is primarily a devcontainer
  tool).
- Adding TypeScript code to shell out to git commands that nushell handles
  natively.
- Coupling a one-shot conversion tool to a project's build lifecycle.

Nushell scripts in dotfiles are the right abstraction level: they are personal
tools that work across all projects, they run in the user's primary shell with
native structured data handling, and they follow the same pattern as existing
dotfile commands (`wez save`, `wez restore`, `ssh-del`, `extract`, etc.).

### Decision: `wt` Command Namespace

**Decision:** Use `wt` as the command prefix (`wt clone`, `wt convert`) rather
than longer names like `worktree-convert` or `git-wt`.

**Why:** Short and memorable. Matches the convention of other dotfile commands
(`wez save`, `wez restore`). Does not conflict with any existing command (verified:
no `wt` in PATH or nushell config). The `wt` prefix is an obvious abbreviation
for "worktree" and groups related operations naturally.

### Decision: Adjacent Mode as Default, In-Place as Opt-In

**Decision:** Default to creating a new directory alongside the existing repo
(adjacent mode). In-place conversion requires explicit `--in-place`.

**Why:** In-place conversion is destructive -- if it fails midway, the repo can
be left in an inconsistent state. Adjacent mode is always safe: the original
repo is untouched, and the user can verify the new layout before deleting the
old one. This matches the weftwise `migrate_to_bare.sh` script's behavior and
follows the principle of least surprise. Users who understand the risks can
opt into in-place mode for convenience.

### Decision: Post-Conversion Verification via `lace up`

**Decision:** Use `lace up --skip-devcontainer-up` as the verification step
rather than reimplementing workspace classification in nushell.

**Why:** Lace's `classifyWorkspace()` is the authoritative source of truth for
whether a layout is valid. Reimplementing that logic in nushell would create
drift risk. Running `lace up --skip-devcontainer-up` exercises the exact same
code path that will be used when the user actually starts a devcontainer. If the
verification passes, the conversion is guaranteed to work with lace. The
`--skip-devcontainer-up` flag (or equivalent) prevents actually launching a
container during verification.

### Decision: Fix Remote URL After Local-to-Local Clone

**Decision:** After `git clone --bare <local-path>/.git`, automatically fix the
remote origin URL to point to the upstream remote, not the local `.git`
directory.

**Why:** `git clone --bare /path/to/repo/.git` sets `origin` to the local
filesystem path. This is almost never what the user wants -- they want `origin`
to remain the upstream GitHub/GitLab URL. The weftwise script does not fix this,
which means the first `git push` after migration targets the old local `.git`
directory. The fix is straightforward: read the upstream URL from the old repo's
config before cloning, then set it on the new bare repo afterward.

### Decision: No Automatic Submodule Handling

**Decision:** Detect submodules and abort with a clear error rather than
attempting conversion.

**Why:** Submodule paths inside a worktree are relative to the worktree root,
and submodule `.git` files point into `.git/modules/` (which becomes
`.bare/modules/` after conversion). The path rewriting is complex and
error-prone. Most projects using the bare-worktree convention do not use
submodules. If submodule support is needed later, it can be added incrementally.

## Stories

### S1: Fresh Clone into Bare-Worktree Layout

A developer wants to start working on a project with worktree support:

```nu
wt clone git@github.com:org/project.git ~/code/org/project
```

This creates the bare-worktree layout directly, with a `main/` worktree. The
developer can immediately `cd ~/code/org/project/main && lace up`.

### S2: Convert an Existing Clone

A developer has a normal clone at `~/code/myproject/`. They want to convert:

```nu
cd ~/code/myproject
wt convert
```

This creates `~/code/myproject-worktrees/` with the bare-worktree layout. The
original repo at `~/code/myproject/` is untouched. The developer verifies:

```nu
cd ~/code/myproject-worktrees/main
lace up --skip-devcontainer-up
```

Then removes the old repo:

```nu
rm -rf ~/code/myproject
```

### S3: In-Place Conversion

An experienced developer with a clean working tree runs:

```nu
cd ~/code/myproject
wt convert --in-place
```

The directory structure changes from a normal clone to bare-worktree layout.
Files are now under `~/code/myproject/main/`. The developer verifies with
`lace up --skip-devcontainer-up` from the worktree directory.

### S4: Conversion with Dirty Working Tree

A developer has uncommitted changes and tries to convert:

```
Warning: Working directory has uncommitted changes.
  Use --force to stash changes and proceed, or commit/stash manually first.
```

With `--force`, the script stashes, converts, and pops the stash in the new
worktree.

### S5: Clone with Specific Branch

```nu
wt clone git@github.com:org/project.git ~/code/org/project --branch develop --name dev
```

Creates bare-worktree layout with a `dev/` worktree tracking the `develop`
branch.

## Edge Cases / Challenging Scenarios

### E1: Shallow Clones

Shallow clones (`git clone --depth 1`) have truncated history. `git clone --bare`
from a shallow clone produces a shallow bare repo. This works but limits
operations like `git log` and `git blame` in the worktrees.

**Handling:** Detect shallow clones (`git rev-parse --is-shallow-repository`)
and warn. Offer to unshallow first (`git fetch --unshallow`) or proceed with the
shallow bare clone.

### E2: Submodules

Repos with submodules have `.gitmodules` and `.git/modules/` directories. The
module paths need rewriting after conversion.

**Handling:** Detect submodules (check for `.gitmodules` file) and abort with a
clear error: "Repository contains submodules, which are not supported by
`wt convert`. Convert manually."

### E3: Existing Worktrees

If the repo already has `git worktree add`-created worktrees (normal clone with
worktrees, not the bare-worktree convention), conversion is more complex because
the existing worktree `.git` files point into `.git/worktrees/` which will become
`.bare/worktrees/`.

**Handling:** Detect existing worktrees via `git worktree list`. If any exist
beyond the main working tree, abort with guidance to remove them first or convert
manually.

### E4: Git Hooks

Custom hooks in `.git/hooks/` need to be preserved. After conversion, they end
up in `.bare/hooks/`. Git automatically uses hooks from the bare directory for
all worktrees, so no path rewriting is needed. However, hooks that reference
paths relative to the working tree root may break.

**Handling:** Copy hooks during conversion (they move naturally with `.git/` ->
`.bare/`). Warn if any hooks contain hardcoded paths. Print a post-conversion
reminder to verify hook behavior.

### E5: Interrupted In-Place Conversion

If the in-place conversion fails midway (power loss, disk full), the repo could
be in an inconsistent state -- `.git/` partially renamed, files partially moved.

**Handling:** Write a `.wt-conversion-in-progress` marker file at the start of
in-place conversion, containing the original state (branch, remote URL). If a
subsequent `wt convert` finds this marker, print guidance for manual recovery.
The marker is removed on successful completion.

### E6: LFS-Tracked Files

Git LFS stores pointers in the working tree and objects in `.git/lfs/`. After
conversion, LFS objects are in `.bare/lfs/`, which is correct -- all worktrees
share the LFS cache. However, `git lfs install` may need to be re-run in the
new worktree.

**Handling:** Detect LFS usage (`.gitattributes` with `filter=lfs`). After
conversion, run `git lfs install` in the new worktree and print a reminder.

### E7: Large Repos / Monorepos

For very large repos, the in-place file move could take significant time. Moving
files within the same filesystem is O(n) in the number of entries but does not
copy data (rename syscall).

**Handling:** Use `mv` (rename) operations, not copy, for in-place conversion.
For adjacent mode, `git clone --bare` uses hardlinks on the same filesystem,
which is fast and space-efficient.

### E8: Non-Default Remote Names

Some repos use a remote named something other than `origin` (e.g., `upstream`).
The conversion should preserve all remotes, not just `origin`.

**Handling:** Iterate over all remotes in the old config and verify they are
preserved in the new bare repo. Fix the fetch refspec for each remote, not just
`origin`.

## Implementation Plan

### File Layout

A single nushell script in the chezmoi dotfiles:

```
dot_config/nushell/scripts/wt.nu    # wt clone, wt convert commands
```

Sourced from `config.nu`:

```nu
source ($nu.default-config-dir | path join "scripts/wt.nu")
```

This follows the exact same pattern as `wez-session.nu` which provides
`wez save`, `wez restore`, `wez list`, and `wez delete`.

### Command Structure

```nu
# Helper: fix worktree gitdir paths to use relative pointers
def wt-fix-paths [name: string, root: path] { ... }

# Helper: create .worktree-root marker file
def wt-create-marker [root: path] { ... }

# Helper: detect repo type (normal-clone, worktree, bare, not-git)
def wt-detect-layout [] { ... }

# Fresh clone into bare-worktree layout
export def "wt clone" [
  url: string           # Git remote URL to clone
  target?: path         # Target directory (default: derived from URL)
  --branch (-b): string # Branch to checkout (default: repo default branch)
  --name (-n): string   # Worktree directory name (default: branch name)
] { ... }

# Convert existing normal clone to bare-worktree layout
export def "wt convert" [
  --target (-t): path   # Output directory (default: <repo>-worktrees)
  --name (-n): string   # Worktree name (default: current branch or "main")
  --force (-f)          # Proceed despite warnings (stashes uncommitted changes)
  --in-place            # Convert in-place instead of creating adjacent directory
] { ... }
```

### Testing Strategy

Since these are personal dotfile scripts (not a library with a test suite), the
testing strategy is manual but structured:

1. **Fresh clone test**: `wt clone` a known public repo, verify layout with
   `git worktree list`, check gitdir paths are relative, check remote URL is
   correct.
2. **Adjacent convert test**: Create a normal clone, `wt convert`, verify
   original is untouched, verify new layout, verify remote URL fixup.
3. **In-place convert test**: Create a throwaway clone, `wt convert --in-place`,
   verify layout.
4. **Dirty tree test**: Make uncommitted changes, verify `wt convert` warns,
   verify `--force` stashes and restores.
5. **Post-conversion lace verification**: Run `lace up --skip-devcontainer-up`
   in the new worktree to confirm lace recognizes it.
6. **Edge case spot checks**: Shallow clone warning, submodule abort, existing
   worktree abort.

### Nushell Patterns to Follow

Based on the existing dotfile scripts:

- **Structured output**: Use nushell's structured data for status reporting
  rather than `echo` with ANSI codes. The bash scripts' `log_info`, `log_warn`,
  `log_error` pattern becomes nushell's `print` with string interpolation.
- **Error handling**: Use `error make { msg: "..." }` for fatal errors (see
  `wez-session.nu` and `utils.nu` for examples).
- **Interactive prompts**: Use `input list` for choices (see `wez-session.nu`
  restore flow) and `input` for confirmation.
- **Git commands**: Shell out to git via `^git` (nushell external command
  syntax). Parse output with `lines`, `str trim`, `split column`, etc.
- **File operations**: Use nushell's native `mv`, `cp`, `mkdir`, `save` rather
  than shelling out.
