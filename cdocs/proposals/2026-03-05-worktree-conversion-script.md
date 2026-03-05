---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-05T14:00:00-06:00
task_list: lace/worktree-conversion
type: proposal
state: live
status: review_ready
tags: [worktree, bare-worktree, conversion, cli, git, workspace-layout, onboarding, devcontainer]
related_to:
  - cdocs/proposals/2026-02-16-unify-worktree-project-identification.md
  - cdocs/proposals/2026-02-15-workspace-validation-and-layout.md
  - cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md
---

# Worktree Conversion CLI Tool

> BLUF: Lace's `bare-worktree` workspace layout is a prerequisite for running
> multiple devcontainers from the same repo simultaneously, but converting an
> existing normal clone to this layout is a manual, error-prone process. The
> weftwise project already has a `migrate_to_bare.sh` script
> (`code/weft/weftwise/main/scripts/migrate_to_bare.sh`) that handles
> conversion, but it is project-specific (hardcoded config file lists, weftwise
> directory conventions) and not reusable. This proposal adds two lace CLI
> commands -- `lace worktree convert` for in-place conversion of existing clones
> and `lace worktree clone` for fresh bare-worktree clones -- that generalize
> the weftwise script's approach, integrate with lace's existing workspace
> detector, and close the gap where `workspace-layout.ts` tells users to
> "convert to the bare-worktree convention" but offers no tool to do so.

## Objective

Make it trivial to adopt the `bare-worktree` layout for any project that wants
to use lace devcontainers with multi-worktree support. Currently, users who
encounter the error "Workspace layout `bare-worktree` declared but
`/path/to/repo` is a normal git clone. Remove the workspace.layout setting or
convert to the bare-worktree convention" must either find the weftwise migration
script (which is project-specific and lives in a different repo) or follow a
multi-step manual process.

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

The weftwise project contains two scripts at
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
- **No integration with lace**: The scripts do not validate the conversion
  against lace's workspace detector. A conversion that produces a layout lace
  cannot detect is a silent failure.
- **Hardcoded `/workspace` paths**: The `worktree.sh` script assumes the
  devcontainer mount target is always `/workspace`.
- **No stash/uncommitted change preservation**: The migration script warns about
  dirty state but does not migrate stashes or preserve uncommitted changes.
- **No remote URL fixup**: After cloning bare from a local `.git` directory, the
  remote `origin` URL points to the old local `.git` path, not the upstream
  remote.
- **Interactive prompts**: Both scripts use `read -p` for confirmation, making
  them unsuitable for scripted/CI usage.

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

### Lace's Current Capabilities

Lace already has the building blocks:

- **`classifyWorkspace()`** (`workspace-detector.ts`): Identifies `worktree`,
  `bare-root`, `normal-clone`, `standard-bare`, `not-git`, and `malformed`
  layouts. Can validate whether a conversion succeeded.
- **`resolveGitdirPointer()`** (`workspace-detector.ts`): Parses `.git` files
  and detects absolute vs relative gitdir paths.
- **`checkAbsolutePaths()`** (`workspace-detector.ts`): Scans sibling worktrees
  for absolute paths that break inside containers.
- **`applyWorkspaceLayout()`** (`workspace-layout.ts`): Generates devcontainer
  config from a classified workspace. Currently emits the error message that
  motivates this proposal.
- **Port allocator, mount resolver, host validator**: All downstream consumers
  that benefit from the bare-worktree layout.

What is missing is the *conversion* step -- the tool that transforms a
normal-clone into the layout that these detectors and appliers expect.

## Proposed Solution

### Two New Subcommands Under `lace worktree`

```
lace worktree convert [--target <dir>] [--worktree-name <name>] [--force] [--no-verify]
lace worktree clone <url> [<dir>] [--branch <branch>] [--worktree-name <name>]
```

#### `lace worktree convert`

Converts the current working directory (or a specified repo path) from a normal
git clone to the bare-worktree convention. Two modes:

1. **Adjacent mode** (default): Creates a new directory alongside the existing
   repo, similar to the weftwise `migrate_to_bare.sh` script. The original repo
   is left intact. Specified via `--target <dir>`.

2. **In-place mode** (`--target .` or `--in-place`): Restructures the current
   directory. The `.git/` directory becomes `.bare/`, a `.git` file is created
   pointing to `.bare/`, and the current working tree contents move into a
   worktree subdirectory.

In-place conversion steps:

1. Verify the repo is a normal git clone (`classifyWorkspace()` returns
   `normal-clone`).
2. Check for uncommitted changes and stashes. Warn if present; abort unless
   `--force`.
3. Stash uncommitted changes if any (auto-applied after conversion).
4. Record the current branch name and remote URL.
5. Move `.git/` to `.bare/`.
6. Create `.git` file with `gitdir: ./.bare`.
7. Configure fetch refspec: `remote.origin.fetch = +refs/heads/*:refs/remotes/origin/*`.
8. Fix remote origin URL if it points to a local path (replace with the
   upstream URL from the old remote config).
9. Create the worktree subdirectory (default name: current branch name, or
   `main`, or specified via `--worktree-name`).
10. Move all non-hidden, non-`.git` files/directories into the worktree
    subdirectory.
11. Move relevant dotfiles (`.devcontainer/`, `.claude/`, `.vscode/`, etc.)
    into appropriate locations (root vs worktree).
12. Run `git worktree add` to register the worktree with git.
13. Fix gitdir paths to use relative pointers (host/container portability).
14. Pop the stash if one was created.
15. Validate the result with `classifyWorkspace()` -- must return `worktree`
    type.
16. Create `.worktree-root` marker file.
17. Print summary and next steps.

#### `lace worktree clone`

Fresh clone directly into bare-worktree layout:

1. `git clone --bare <url> <dir>/.bare`
2. Create `.git` file with `gitdir: ./.bare`.
3. Configure fetch refspec.
4. Fetch all refs.
5. Create default worktree (`main` or specified branch).
6. Fix gitdir paths to relative.
7. Validate with `classifyWorkspace()`.
8. Create `.worktree-root` marker file.
9. Print summary and next steps.

This is essentially a polished, lace-integrated version of the
`git_clone_bare_worktree` script pattern.

### Post-Conversion Verification

Both commands finish with a verification step:

```typescript
const result = classifyWorkspace(worktreePath);
if (result.classification.type !== "worktree") {
  throw new Error(
    `Conversion verification failed: expected "worktree" classification ` +
    `but got "${result.classification.type}". The directory structure may ` +
    `be in an inconsistent state.`
  );
}
if (result.warnings.some(w => w.code === "absolute-gitdir")) {
  console.warn("Warning: Some worktrees use absolute gitdir paths. " +
    "Run `git worktree repair --relative-paths` (requires git 2.48+).");
}
```

This closes the loop between the conversion tool and the existing detector --
the same code that will later validate the workspace during `lace up` is used
to verify the conversion succeeded.

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

**Configurable** (user decides via `--config-placement` or interactive prompt):
- `.env`, `.env.local` -- could be shared or per-branch
- Other untracked dotfiles

The default placement can be guided by a `.lace/worktree-layout.json`
config file if present, or by detecting common patterns.

### Integration with `workspace-layout.ts` Error Message

Update the error message in `applyWorkspaceLayout()` to reference the new tool:

```typescript
// Before:
"Remove the workspace.layout setting or convert to the bare-worktree convention."

// After:
"Remove the workspace.layout setting or run `lace worktree convert` to convert " +
"this clone to the bare-worktree convention."
```

## Important Design Decisions

### Decision: Subcommand Under `lace worktree` Rather Than Top-Level

**Decision:** Place the commands under `lace worktree convert` and
`lace worktree clone` rather than `lace convert-to-worktree` or a standalone
script.

**Why:** The `lace worktree` namespace groups all worktree-related operations
(convert, clone, and potentially `add`/`list`/`remove` in the future --
absorbing the weftwise `worktree.sh` functionality). This mirrors `git worktree`
subcommand structure, which users are already familiar with. A top-level command
like `lace convert-to-worktree` is too specific to warrant top-level namespace
space, and a standalone script outside lace cannot leverage `classifyWorkspace()`
for verification.

### Decision: Adjacent Mode as Default, In-Place as Opt-In

**Decision:** Default to creating a new directory alongside the existing repo
(adjacent mode). In-place conversion requires explicit `--in-place` or
`--target .`.

**Why:** In-place conversion is destructive -- if it fails midway, the repo can
be left in an inconsistent state. Adjacent mode is always safe: the original
repo is untouched, and the user can verify the new layout before deleting the
old one. This matches the weftwise `migrate_to_bare.sh` script's behavior and
follows the principle of least surprise. Users who understand the risks can
opt into in-place mode for convenience.

### Decision: Validate with `classifyWorkspace()` Post-Conversion

**Decision:** Use lace's own workspace classifier to verify the conversion
result rather than relying on git commands or filesystem checks.

**Why:** The classifier is the same code that `lace up` will use to detect the
workspace layout. If the classifier does not recognize the conversion result as
a valid `worktree` type, `lace up` will also fail. By testing with the same
code, the conversion tool guarantees compatibility with the downstream pipeline.
This also serves as an integration test for the classifier itself.

### Decision: Fix Remote URL After Local-to-Local Clone

**Decision:** After `git clone --bare <local-path>/.git`, automatically fix the
remote origin URL to point to the upstream remote, not the local `.git`
directory.

**Why:** `git clone --bare /path/to/repo/.git` sets `origin` to the local
filesystem path. This is almost never what the user wants -- they want `origin`
to remain the upstream GitHub/GitLab URL. The weftwise script does not fix this,
which means the first `git push` after migration targets the old local `.git`
directory. The fix is straightforward: read the upstream URL from the old repo's
config and set it as the new `origin`.

### Decision: No Automatic Submodule Handling in Phase 1

**Decision:** Defer submodule support to a later phase. Phase 1 detects
submodules and aborts with a clear error.

**Why:** Submodule paths inside a worktree are relative to the worktree root,
and submodule `.git` files point into `.git/modules/` (which becomes
`.bare/modules/` after conversion). The path rewriting is complex and
error-prone. Most lace-managed projects do not use submodules. Adding submodule
support later is additive and does not change the core conversion logic.

### Decision: TypeScript Implementation, Not Shell Script

**Decision:** Implement the conversion logic in TypeScript as part of the lace
CLI, not as a standalone shell script.

**Why:** The conversion needs to call `classifyWorkspace()` for pre-flight
validation and post-conversion verification. It needs structured error handling,
progress reporting, and JSON output for `--json` mode. Shelling out to `git`
commands from TypeScript is straightforward (lace already does this in other
commands). A TypeScript implementation also enables proper unit testing with
filesystem fixtures, which the weftwise shell script lacks entirely.

## Stories

### S1: New User Adopts Bare-Worktree for Existing Project

A developer has a normal clone at `~/code/myproject/`. They add
`"layout": "bare-worktree"` to their `devcontainer.json` and run `lace up`.
Lace reports: "Workspace layout `bare-worktree` declared but ~/code/myproject
is a normal git clone. Run `lace worktree convert` to convert this clone to
the bare-worktree convention."

The developer runs `lace worktree convert` from inside `~/code/myproject/`. Lace
creates `~/code/myproject-worktrees/` with the bare-worktree layout, prints the
new directory structure and next steps. The developer verifies, moves their work
to the new directory, and `lace up` succeeds.

### S2: Clone a New Repo Directly into Bare-Worktree Layout

A developer wants to start working on a new project that uses lace. They run:

```bash
lace worktree clone git@github.com:org/project.git ~/code/org/project
```

This creates the bare-worktree layout directly, with a `main` worktree ready
for `lace up`.

### S3: In-Place Conversion for Experienced Users

An experienced developer with a clean working tree runs:

```bash
cd ~/code/myproject
lace worktree convert --in-place
```

The conversion happens in-place. The directory structure changes from a normal
clone to a bare-worktree layout. The developer's files are now under
`~/code/myproject/main/`. A `lace up` from `~/code/myproject/main/` succeeds.

### S4: Conversion with Dirty Working Tree

A developer has uncommitted changes and tries to convert. Lace warns:

```
Warning: Working directory has 3 uncommitted changes.
  Changes will be stashed before conversion and re-applied after.
  Use --force to proceed, or commit/stash manually first.
```

With `--force`, lace stashes, converts, and pops the stash in the new worktree.

### S5: Error Message Guides User to the Tool

A developer working on any lace-managed project with a normal clone hits the
workspace layout error. The error message now includes the command to run,
reducing friction from "figure out how to convert" to "run this command."

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

**Handling (Phase 1):** Detect submodules and abort with a clear error:
"Repository contains submodules, which are not yet supported by `lace worktree
convert`. Convert manually or wait for submodule support in a future version."

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

**Handling:** Write a `.lace/conversion-in-progress.json` marker at the start of
in-place conversion, containing the original state (branch, remote URL, file
manifest). If a subsequent `lace worktree convert` finds this marker, offer to
resume or rollback. The marker is removed on successful completion.

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

**Handling:** Use rename/move operations (not copy) for in-place conversion.
Show progress for repos with many files. For adjacent mode, `git clone --bare`
uses hardlinks on the same filesystem, which is fast and space-efficient.

### E8: Non-Default Remote Names

Some repos use a remote named something other than `origin` (e.g., `upstream`).
The conversion should preserve all remotes, not just `origin`.

**Handling:** Iterate over all remotes in the old config and verify they are
preserved in the new bare repo. Fix the fetch refspec for each remote, not just
`origin`.

## Implementation Phases

### Phase 1: `lace worktree clone` (Fresh Clone)

The simpler command -- no existing state to preserve.

**Files:**
- `packages/lace/src/commands/worktree.ts` (new command module)
- `packages/lace/src/lib/worktree-converter.ts` (core logic)
- `packages/lace/src/lib/__tests__/worktree-converter.test.ts`

**Implementation:**
- Create the `lace worktree` command group with `clone` subcommand.
- Implement `cloneBareWorktree(url, targetDir, options)`:
  - Shell out to `git clone --bare <url> <targetDir>/.bare`.
  - Create `.git` file, configure fetch refspec, fetch refs.
  - Create worktree via `git worktree add`.
  - Fix gitdir paths to relative pointers (reuse the pattern from weftwise's
    `fix_worktree_paths`).
  - Create `.worktree-root` marker.
  - Validate with `classifyWorkspace()`.
- Support `--branch` to specify the initial worktree branch.
- Support `--worktree-name` to name the worktree directory differently from
  the branch name.
- Support `--json` for machine-readable output.

**Verification:**
- Unit test: clone a local test repo into bare-worktree layout, verify
  `classifyWorkspace()` returns `worktree` type.
- Unit test: verify gitdir pointers are relative.
- Unit test: verify remote URL is correct (not local path).
- Unit test: verify fetch refspec allows fetching all branches.

### Phase 2: `lace worktree convert` (Adjacent Mode)

Convert an existing normal clone by creating a new directory.

**Files:**
- `packages/lace/src/commands/worktree.ts` (add `convert` subcommand)
- `packages/lace/src/lib/worktree-converter.ts` (extend)
- `packages/lace/src/lib/__tests__/worktree-converter.test.ts` (extend)

**Implementation:**
- Add `convert` subcommand to the `lace worktree` group.
- Implement `convertToWorktree(repoPath, options)`:
  - Pre-flight: `classifyWorkspace()` must return `normal-clone`. Reject
    already-converted repos, bare repos, non-git directories.
  - Detect and warn about: dirty working tree, stashes, submodules, shallow
    clone, existing worktrees, LFS.
  - Determine target directory (default: `<repoPath>-worktrees` or
    `<parent>/<basename>` if repo is a sibling).
  - Clone bare from existing `.git/`.
  - Fix remote origin URL to upstream.
  - Create worktree, fix gitdir paths, create marker.
  - Copy relevant untracked config files (`.devcontainer/`, `.claude/`,
    `.vscode/`, `.env*`) using configurable placement heuristics.
  - Validate with `classifyWorkspace()`.
  - Print summary with directory structure and next steps.
- Support `--target <dir>` to specify the output directory.
- Support `--force` to proceed despite warnings.
- Support `--no-verify` to skip post-conversion validation.

**Verification:**
- Unit test: convert a normal clone, verify output layout.
- Unit test: verify original repo is untouched.
- Unit test: verify remote URL fixup.
- Unit test: verify config file placement heuristics.
- Unit test: reject already-converted repos gracefully.
- Unit test: reject repos with submodules.

### Phase 3: `lace worktree convert --in-place`

The most complex mode -- restructures the current directory.

**Files:**
- `packages/lace/src/lib/worktree-converter.ts` (extend)
- `packages/lace/src/lib/__tests__/worktree-converter.test.ts` (extend)

**Implementation:**
- Implement in-place conversion in `convertToWorktree()` when
  `options.inPlace === true`:
  - Write `.lace/conversion-in-progress.json` with rollback state.
  - Stash uncommitted changes if `--force`.
  - Rename `.git/` to `.bare/`.
  - Create `.git` file pointing to `.bare/`.
  - Create worktree subdirectory.
  - Move all working tree files into the worktree subdirectory.
  - Register the worktree with `git worktree add` (or manually create the
    worktree entry in `.bare/worktrees/`).
  - Fix gitdir paths.
  - Pop stash in the worktree if one was created.
  - Validate with `classifyWorkspace()`.
  - Remove `.lace/conversion-in-progress.json`.
  - Print summary and next steps.
- Implement rollback detection: if `.lace/conversion-in-progress.json` exists,
  offer to resume or rollback.

**Verification:**
- Unit test: in-place conversion produces valid layout.
- Unit test: verify files are moved, not copied (check inode if possible).
- Unit test: verify stash round-trip (stash before, pop after).
- Unit test: verify rollback marker is created and cleaned up.
- Integration test: `classifyWorkspace()` succeeds on converted repo.

### Phase 4: Error Message Integration and Documentation

**Files:**
- `packages/lace/src/lib/workspace-layout.ts` (update error message)
- `packages/lace/docs/troubleshooting.md` (update guidance)

**Implementation:**
- Update the `normal-clone` error message in `applyWorkspaceLayout()` to
  reference `lace worktree convert`.
- Add a troubleshooting section documenting the conversion workflow.
- Add a "Worktree Layout" section to the lace README or architecture docs
  explaining the convention and how to adopt it.

**Verification:**
- Verify error message includes the `lace worktree convert` command.
- Verify troubleshooting docs are accurate and complete.

### Phase 5: `lace worktree add/list/remove` (Optional, Future)

Absorb the weftwise `worktree.sh` functionality into lace, making worktree
management available to any lace-managed project. This is lower priority since
`git worktree add/list/remove` works directly; the value-add is lace-specific
features like relative-path fixup, context file creation, and dependency
installation.

**Deferred:** This phase is listed for completeness but is not part of the
initial implementation scope.
