---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-05T14:00:00-06:00
task_list: lace/worktree-tooling
type: proposal
state: live
status: draft
tags: [worktree, bare-worktree, clone, nushell, git, workspace-layout, dotfiles, chezmoi]
related_to:
  - cdocs/proposals/2026-02-16-unify-worktree-project-identification.md
  - cdocs/proposals/2026-02-15-workspace-validation-and-layout.md
  - cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md
---

# `wt clone`: Bare-Worktree Clone Command (Nushell)

> BLUF: A `wt clone` nushell command in the user's dotfiles creates fresh
> bare-worktree clones that lace's `classifyWorkspace()` immediately
> recognizes. The command handles the multi-step git ceremony (bare clone,
> `.git` file creation, refspec configuration, worktree creation, relative
> gitdir fixup) in a single invocation. No conversion logic -- the user
> philosophy is "push, delete, re-clone" rather than converting in-place.

## Objective

Make it trivial to clone any git repository into the bare-worktree layout
that lace expects. Today this requires remembering a 6-step manual process
(`git clone --bare`, create `.git` file, fix refspec, fetch, add worktree,
fix gitdir paths). `wt clone` reduces that to one command.

## Background

### The Bare-Worktree Convention

The "nikitabobko convention" structures a git repository as:

```
project/
  .bare/                 # Bare git database (clone --bare output)
  .git                   # File containing "gitdir: ./.bare"
  main/                  # Worktree (branch: main)
    .git                 # File containing "gitdir: ../.bare/worktrees/main"
    src/
    ...
  feature-x/             # Another worktree (branch: feature-x)
    .git                 # File containing "gitdir: ../.bare/worktrees/feature-x"
    src/
    ...
```

This layout enables lace to mount the parent directory (containing `.bare/`
and all worktrees) into a SINGLE devcontainer. The `workspaceFolder`
setting selects which worktree to open, but all worktrees are accessible as
sibling directories inside the same container. Lace's workspace detector
(`workspace-detector.ts`) identifies this layout and the workspace layout
applier (`workspace-layout.ts`) generates the correct `workspaceMount`,
`workspaceFolder`, and `postCreateCommand`.

### Why Clone-Only, No Conversion

The user's philosophy: pushing all that needs pushing, deleting, and
re-cloning is cleaner than trying to convert in-place. In-place conversion
has many failure modes:

- Uncommitted changes and stashes must be migrated
- Untracked config files (`.env`, `.claude/`, `.vscode/`) need heuristic
  placement decisions (bare-repo root vs worktree)
- Submodules require complex path rewriting
- An interrupted in-place conversion leaves the repo in an inconsistent state
- Remote URLs need fixup after local-to-local bare clone

A fresh `wt clone` from the remote avoids all of these. The user pushes
their work, deletes the old clone, and runs `wt clone` to get a clean
bare-worktree layout. This is the same workflow as "delete and re-clone"
that developers already do for other reasons.

### Existing Tools

- [git-worktree-manager (gwtm)](https://github.com/lucasmodrich/git-worktree-manager):
  Manages bare-clone + worktree workflows via `gwtm setup`, but uses a
  different directory convention and does not fix gitdir paths for container
  portability.
- [git_clone_bare_worktree](https://github.com/ckstevenson/scripts/blob/main/git_clone_bare_worktree):
  A simple script that clones bare, sets up `.git` file, configures fetch
  refspec, and creates one worktree. Close to what we need but lacks
  relative gitdir fixup and nushell integration.
- The weftwise `migrate_to_bare.sh` script handles conversion (not clone)
  and is project-specific with hardcoded config file lists.

### Lace's Role (Verification, Not Cloning)

Lace already has the building blocks for detecting and validating the
bare-worktree layout:

- **`classifyWorkspace()`** (`workspace-detector.ts`): Identifies `worktree`,
  `bare-root`, `normal-clone`, `standard-bare`, `not-git`, and `malformed`
  layouts.
- **`applyWorkspaceLayout()`** (`workspace-layout.ts`): Generates devcontainer
  config from a classified workspace.

The cloning itself does not need to be part of lace. It is a personal
workflow tool that belongs in dotfiles, not in a shared project CLI. After
cloning, running `lace up --skip-devcontainer-up` from the new worktree
confirms the layout is recognized, but only if the project has a
`.devcontainer` directory.

## Proposed Solution

### Command: `wt clone`

A single nushell custom command in the chezmoi-managed dotfiles.

**Location:** `dot_config/nushell/scripts/wt.nu` (chezmoi source), deployed
to `~/.config/nushell/scripts/wt.nu`. Sourced from `config.nu` via:

```nu
source ($nu.default-config-dir | path join "scripts/wt.nu")
```

This follows the exact same pattern as `wez-session.nu` which provides
`wez save`, `wez restore`, `wez list`, and `wez delete`.

**Signature:**

```nu
export def "wt clone" [
  url: string           # Git remote URL (SSH or HTTPS)
  target?: path         # Target directory (default: derived from URL)
  --branch (-b): string # Branch to checkout (default: repo's default branch)
  --name (-n): string   # Worktree directory name (default: branch name)
  --shallow             # Shallow clone (--depth 1) for large repos
] { ... }
```

**Usage examples:**

```nu
# Basic clone: git@github.com:org/repo.git -> ./repo/{.bare, .git, main/}
wt clone git@github.com:org/repo.git

# Explicit target directory
wt clone git@github.com:org/repo.git ~/code/org/repo

# Clone with non-default branch
wt clone git@github.com:org/repo.git --branch develop

# Custom worktree name for the initial checkout
wt clone git@github.com:org/repo.git --branch develop --name dev

# Shallow clone for large repos
wt clone git@github.com:org/huge-monorepo.git --shallow
```

### Algorithm

1. **Derive target directory** from URL if not specified:
   - `git@github.com:org/repo.git` -> `./repo/`
   - `https://github.com/org/repo.git` -> `./repo/`
   - Strip `.git` suffix, take the last path component.

2. **Check target directory** does not already exist (or is empty). If it
   exists and is non-empty, abort with an error suggesting the user choose a
   different target or remove the existing directory.

3. **Bare clone**: `git clone --bare <url> <target>/.bare`
   - If `--shallow`: add `--depth 1`
   - This creates the bare git database at `<target>/.bare/`

4. **Create `.git` file** at `<target>/.git` with content:
   ```
   gitdir: ./.bare
   ```

5. **Configure fetch refspec** for all branches:
   ```
   git -C <target>/.bare config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
   ```
   By default, `git clone --bare` sets the refspec to not fetch any remote
   tracking branches. This fix ensures `git fetch` retrieves all branches.

6. **Fetch all refs**: `git -C <target>/.bare fetch origin`
   - If `--shallow`: add `--depth 1`

7. **Determine default branch** if `--branch` not specified:
   - Parse `HEAD` from the bare repo: `git -C <target>/.bare symbolic-ref HEAD`
   - Extract branch name (e.g., `refs/heads/main` -> `main`)
   - Fall back to `main` if HEAD is detached or cannot be determined.

8. **Determine worktree name** if `--name` not specified:
   - Use the branch name (e.g., `main`, `develop`)

9. **Create worktree**: `git -C <target>/.bare worktree add ../<name> <branch>`
   - This creates `<target>/<name>/` with a `.git` file pointing into
     `.bare/worktrees/<name>/`

10. **Fix gitdir paths** to use relative pointers (critical for container
    portability):
    ```nu
    # Fix worktree .git file to use relative path
    $"gitdir: ../.bare/worktrees/($name)" | save -f <target>/<name>/.git

    # Fix bare repo's worktree gitdir to use relative path back
    $"../../($name)" | save -f <target>/.bare/worktrees/<name>/gitdir
    ```
    Git 2.48+ has `git worktree repair --relative-paths` but we cannot
    assume that version is available. The manual fixup works on all git
    versions.

11. **Create `.worktree-root` marker file** at `<target>/.worktree-root`:
    ```
    # This file marks the root of a bare-worktree layout.
    # See: https://nikitabobko.github.io/blog/git-worktree
    ```

12. **Print summary** and next steps:
    ```
    Created bare-worktree layout:
      <target>/
        .bare/          (bare git database)
        .git            (gitdir: ./.bare)
        <name>/         (worktree: <branch>)
        .worktree-root

    Next steps:
      cd <target>/<name>
      # If project has .devcontainer/:
      lace up
    ```

### Command Structure

```nu
# Helper: fix worktree gitdir paths to use relative pointers
def wt-fix-paths [name: string, root: path] {
  let worktree_git = ($root | path join $name ".git")
  let bare_gitdir = ($root | path join ".bare" "worktrees" $name "gitdir")

  $"gitdir: ../.bare/worktrees/($name)" | save -f $worktree_git
  $"../../($name)" | save -f $bare_gitdir
}

# Helper: create .worktree-root marker file
def wt-create-marker [root: path] {
  "# This file marks the root of a bare-worktree layout.\n" | save -f ($root | path join ".worktree-root")
}

# Helper: derive repo name from URL
def wt-repo-name [url: string] -> string {
  $url | path basename | str replace -r '\.git$' ''
}

# Fresh clone into bare-worktree layout
export def "wt clone" [
  url: string           # Git remote URL (SSH or HTTPS)
  target?: path         # Target directory (default: derived from URL)
  --branch (-b): string # Branch to checkout (default: repo's default branch)
  --name (-n): string   # Worktree directory name (default: branch name)
  --shallow             # Shallow clone (--depth 1) for large repos
] {
  # ... implementation ...
}
```

## Important Design Decisions

### Decision: Nushell Script in Dotfiles, Not Built Into Lace

**Decision:** Implement as a nushell custom command in the chezmoi-managed
dotfiles, not as a lace CLI subcommand.

**Why:** Worktree cloning is a personal workflow operation, not a project
build tool. It runs on the host machine, outside any devcontainer, and only
needs to happen once per project. Putting it in lace would mean requiring
lace to be installed on the host (lace is primarily a devcontainer tool),
adding TypeScript code to shell out to git commands that nushell handles
natively, and coupling a one-shot clone tool to a project's build lifecycle.
Nushell scripts in dotfiles are the right abstraction level: they are
personal tools that work across all projects, run in the user's primary
shell with native structured data handling, and follow the same pattern as
existing dotfile commands (`wez save`, `wez restore`, etc.).

### Decision: Clone-Only, No Conversion

**Decision:** Only implement `wt clone` for fresh clones. No `wt convert`
for existing repos.

**Why:** The user's philosophy is that pushing, deleting, and re-cloning is
cleaner than converting in-place. In-place conversion has many edge cases
(uncommitted changes, stashes, untracked config files, submodules,
interrupted operations, remote URL fixup) that add complexity without
proportional value. A fresh clone from the remote is always clean and
deterministic. If a user has unpushed work, `git push` first, then
`wt clone`. This keeps the tool simple and reliable.

### Decision: `wt` Command Namespace

**Decision:** Use `wt` as the command prefix rather than longer names like
`worktree-clone` or `git-wt`.

**Why:** Short and memorable. Matches the convention of other dotfile
commands (`wez save`, `wez restore`). Does not conflict with any existing
command. The `wt` prefix is an obvious abbreviation for "worktree" and
groups related operations naturally (future: `wt add` for adding worktrees
to an existing bare-worktree layout).

### Decision: Relative Gitdir Paths (Container Portability)

**Decision:** Always fix `.git` files to use relative gitdir paths, even
though `git worktree repair --relative-paths` exists in git 2.48+.

**Why:** The manual fixup works on all git versions. Relative paths are
essential for container portability -- when the repo is mounted at a
different path inside a devcontainer, absolute gitdir paths break. Lace's
workspace detector (`checkAbsolutePaths()`) flags absolute paths as errors.
The two-line fixup is simple and reliable.

### Decision: Target Directory Naming

**Decision:** `wt clone git@github.com:org/repo.git` creates `./repo/`
with `.bare/` and `main/` inside.

**Why:** The URL's last path component (minus `.git`) is the natural
directory name. This matches `git clone` behavior where
`git clone git@github.com:org/repo.git` creates `./repo/`. The user can
override with an explicit target path. Inside the target directory, the
worktree name defaults to the branch name (`main`, `develop`, etc.),
matching the nikitabobko convention.

### Decision: Post-Clone Verification is Optional

**Decision:** Print `lace up --skip-devcontainer-up` as a suggested next
step, but do not run it automatically. Only suggest it if the project has
a `.devcontainer` directory.

**Why:** Not every project uses lace or devcontainers. The `wt clone`
command is useful for any bare-worktree workflow, not just lace projects.
Running `lace up` requires lace to be installed and the project to have a
`.devcontainer` directory. Making verification optional keeps the tool
general-purpose.

## Edge Cases / Challenging Scenarios

### E1: Non-Default Branch

When the repo's default branch is not `main` (e.g., `develop`, `master`,
`trunk`), the algorithm in step 7 reads `HEAD` from the bare repo to
determine the actual default branch. The `--branch` flag allows explicit
override for cases where the user wants to start from a different branch.

**Handling:** Parse `git symbolic-ref HEAD` from the bare repo. If HEAD is
detached (rare for a fresh clone), fall back to `main`.

### E2: SSH vs HTTPS URLs

Both URL formats must work for target directory derivation:
- `git@github.com:org/repo.git` -> `repo`
- `https://github.com/org/repo.git` -> `repo`
- `git@github.com:org/repo` (no `.git` suffix) -> `repo`

**Handling:** Strip `.git` suffix if present, then take the last path
component. For SSH URLs with `:` separator, split on `:` first, then take
the basename.

### E3: Shallow Clone for Large Repos

Large monorepos benefit from `--depth 1` cloning to avoid downloading full
history. The bare-worktree layout works with shallow repos, but operations
like `git log` and `git blame` will be limited.

**Handling:** The `--shallow` flag passes `--depth 1` to both `git clone`
and `git fetch`. Print a note that the clone is shallow and how to
unshallow later (`git fetch --unshallow`).

### E4: Target Directory Already Exists

If the target directory exists and is non-empty, the bare clone will fail
with a confusing git error about the directory not being empty.

**Handling:** Check before cloning. If the target exists and is non-empty,
print a clear error: "Target directory `<path>` already exists and is not
empty. Choose a different target or remove it first." If the target exists
but is empty, proceed (git clone into an empty directory works fine).

### E5: Network Failure During Clone

If the network fails during `git clone --bare`, a partial `.bare/` directory
may be left behind.

**Handling:** If the `git clone --bare` command fails, clean up the
partially created target directory before reporting the error. Use a try
block around the clone and delete the target on failure.

### E6: Repo With Submodules

Submodules are not automatically initialized in a bare clone. The worktree
will have `.gitmodules` but submodule directories will be empty.

**Handling:** Detect `.gitmodules` after clone and print a reminder:
"This repo uses submodules. Run `git submodule update --init --recursive`
from the worktree to initialize them."

### E7: Authentication Failure

SSH key not configured, or HTTPS credentials not cached.

**Handling:** Let git's native error messages propagate. Git produces
clear authentication failure messages. No special handling needed.

### E8: Worktree Name Conflicts With Git Internals

Names like `.bare`, `.git`, or `.worktree-root` would conflict with the
layout structure.

**Handling:** Validate the worktree name against a blocklist of reserved
names. Error if the name would conflict.

## Test Plan

Since this is a personal dotfile script (not a library with a test suite),
the testing strategy is manual but structured:

1. **Basic SSH clone**: `wt clone git@github.com:org/public-repo.git /tmp/test-repo`
   - Verify directory structure: `.bare/`, `.git`, `main/`, `.worktree-root`
   - Verify `.git` file contains `gitdir: ./.bare`
   - Verify `main/.git` file contains relative path `gitdir: ../.bare/worktrees/main`
   - Verify `.bare/worktrees/main/gitdir` contains `../../main`
   - Verify `git -C /tmp/test-repo/main log --oneline -5` works
   - Verify `git -C /tmp/test-repo/main remote -v` shows the original URL

2. **Basic HTTPS clone**: Same checks with an HTTPS URL.

3. **Non-default branch**: `wt clone <url> /tmp/test-repo --branch develop`
   - Verify worktree directory is `develop/`
   - Verify `git -C /tmp/test-repo/develop branch` shows `develop`

4. **Custom worktree name**: `wt clone <url> /tmp/test-repo --branch develop --name dev`
   - Verify worktree directory is `dev/`
   - Verify the worktree tracks `develop`

5. **Auto-derived target**: `wt clone git@github.com:org/myproject.git`
   - Verify creates `./myproject/` in cwd

6. **Target exists**: Create directory, then try clone
   - Verify clear error message

7. **Shallow clone**: `wt clone <url> /tmp/test-repo --shallow`
   - Verify `git -C /tmp/test-repo/main rev-parse --is-shallow-repository` returns `true`

8. **Lace verification** (for projects with `.devcontainer`):
   - After clone, `cd <worktree> && lace up --skip-devcontainer-up`
   - Verify `.lace/devcontainer.json` has correct `workspaceMount` and `workspaceFolder`

## Implementation Phases

### Phase 1: Core `wt clone` Command

Implement the basic clone flow:
- URL parsing and target directory derivation
- `git clone --bare`, `.git` file creation, refspec fixup
- `git fetch`, default branch detection, worktree creation
- Relative gitdir path fixup
- `.worktree-root` marker creation
- Summary output

This covers the primary use case and all the test plan items.

**Deliverable:** `dot_config/nushell/scripts/wt.nu` with `wt clone` command,
sourced from `config.nu`.

### Phase 2: Polish and Edge Cases

Add handling for:
- `--shallow` flag
- Target directory existence check with cleanup on failure
- Submodule detection and reminder
- Worktree name validation (reserved name blocklist)
- Better URL parsing for edge cases (no `.git` suffix, unusual URL formats)

### Phase 3: Future `wt add` (Not In Scope)

A natural follow-up would be `wt add <branch>` to add new worktrees to an
existing bare-worktree layout, with relative gitdir fixup. This is out of
scope for this proposal but the `wt` namespace is designed to accommodate it.
