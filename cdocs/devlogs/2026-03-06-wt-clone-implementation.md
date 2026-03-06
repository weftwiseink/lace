---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-06T09:38:00-08:00
task_list: lace/worktree-tooling
type: devlog
state: live
status: review_ready
tags: [worktree, bare-worktree, clone, nushell, dotfiles, chezmoi]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-06T14:30:00-06:00
  round: 1
---

# `wt-clone` Implementation

## Objective

Implement the `wt-clone` nushell command per the proposal at
`cdocs/proposals/2026-03-05-worktree-conversion-script.md`. This creates a
single nushell script in the chezmoi dotfiles that clones any git repo into
the bare-worktree layout that lace's `classifyWorkspace()` recognizes.

## Plan

1. Create `wt-clone.nu` in `dot_config/nushell/scripts/` following patterns from `wez-session.nu`
2. Add `source` line to `config.nu`
3. Deploy via `chezmoi apply`
4. Test against real repos (SSH + HTTPS, default + non-default branch, edge cases)
5. Verify lace recognizes the resulting layout

## Testing Approach

Manual structured testing against real repos per the proposal's test plan.
This is a personal dotfile script, not a library with a test suite. Each test
case was run in `/tmp/` and verified with explicit checks.

## Implementation Notes

### Phases 1+2: Core Command With Edge Cases

Combined phases 1 and 2 since edge case handling (target existence, reserved
names, shallow flag, submodule detection) is integral to a working command.

**Pattern decisions:**
- Followed `wez-session.nu` patterns: non-exported helpers, `error make` for
  user errors, `path expand` for safety, `try/catch` for external commands
- Used `^git` prefix for all git calls (nushell external command syntax)
- `path expand | into string` for passing paths to external commands
- Early validation for `--name` flag (before clone), late validation for
  branch-derived name (with cleanup)
- Return type annotation `-> string` removed from helpers -- nushell uses
  `: input -> output` syntax after the param block, not `-> type` in params

**Key implementation detail:**
- Reserved name check happens in two places: early (when `--name` is provided)
  to avoid unnecessary cloning, and late (after branch detection) with cleanup
  of the already-cloned bare repo.

## Changes Made

| File | Description |
|------|-------------|
| `dot_config/nushell/scripts/wt-clone.nu` | New: `wt-clone` command (core algorithm + all edge cases) |
| `dot_config/nushell/config.nu` | Added `source` line for `wt-clone.nu` |

Both files are in the chezmoi dotfiles repo at `/home/mjr/code/personal/dotfiles/`.

## Verification

### Parse Check

```
$ nu -c 'source ~/.config/nushell/scripts/wt-clone.nu; wt-clone --help'
Clone a git repo into bare-worktree layout

Usage:
  > wt-clone {flags} <url> (target)

Flags:
  -b, --branch <string>: Branch to checkout (default: repo's default branch)
  -n, --name <string>: Worktree directory name (default: branch name)
  --shallow: Shallow clone (--depth 1) for large repos

Parameters:
  url <string>: Git remote URL (SSH or HTTPS)
  target <path>: Target directory (default: derived from URL) (optional)
```

### Test 1: Basic SSH Clone

```
$ wt-clone git@github.com:weftwiseink/lace.git /tmp/test-wt-clone/lace
Cloning git@github.com:weftwiseink/lace.git...
Cloning into bare repository '/tmp/test-wt-clone/lace/.bare'...
[branches fetched]
Preparing worktree (checking out 'main')

Created bare-worktree layout:
  /tmp/test-wt-clone/lace/
    .bare/          (bare git database)
    .git            (gitdir: ./.bare)
    main/         (worktree: main)
    .worktree-root

Next steps:
  cd /tmp/test-wt-clone/lace/main
  lace up
```

Structure verified:
- `.git` file: `gitdir: ./.bare`
- `main/.git` file: `gitdir: ../.bare/worktrees/main` (relative)
- `.bare/worktrees/main/gitdir`: `../../main` (relative)
- `git log --oneline -3` works from worktree
- `git remote -v` shows original URL
- All remote branches tracked locally

### Test 2: HTTPS Clone + Auto-Derived Target

```
$ cd /tmp/test-auto-derive
$ wt-clone https://github.com/weftwiseink/lace.git
Cloning https://github.com/weftwiseink/lace.git...
  [creates ./lace/ in CWD -- correct auto-derivation]
```

### Test 3: Non-Default Branch

```
$ wt-clone git@github.com:weftwiseink/lace.git /tmp/test-wt-clone/lace-branch --branch mountvars
  [worktree directory: mountvars/]
  [git branch --show-current: mountvars]
  [gitdir: ../.bare/worktrees/mountvars -- correct relative path]
```

### Test 4: Custom Worktree Name

```
$ wt-clone git@github.com:weftwiseink/lace.git /tmp/test-wt-clone/lace-named --branch mountvars --name mv
  [worktree directory: mv/]
  [git branch --show-current: mountvars]
  [.bare/worktrees/mv/gitdir: ../../mv -- correct]
```

### Test 5: Shallow Clone

```
$ wt-clone git@github.com:weftwiseink/lace.git /tmp/test-wt-clone/lace-shallow --shallow
Note: Shallow clone. Run `git fetch --unshallow` for full history.
  [git rev-parse --is-shallow-repository: true]
```

### Test 6: Target Exists (Error)

```
$ wt-clone https://github.com/weftwiseink/lace.git  # target already exists
Error: Target directory '/tmp/test-wt-clone/lace' already exists and is not empty.
  Choose a different target or remove it first.
```

### Test 7: Reserved Name (Early Validation)

```
$ wt-clone git@github.com:weftwiseink/lace.git /tmp/test-reserved --name .bare
Error: Worktree name '.bare' conflicts with layout structure. Use --name to choose a different name.
  [/tmp/test-reserved does NOT exist -- no clone was attempted]
```

### Test 8: Lace Layout Recognition

```
$ cd /tmp/test-wt-clone/lace/main && lace up --skip-devcontainer-up
Auto-configured for worktree 'main' in /tmp/test-wt-clone/lace
Fetching feature metadata...
Validated metadata for 6 feature(s)
Auto-injected port templates for: wezterm-server/hostSshPort
Auto-injected mount templates for: project/bash-history, project/claude-config, wezterm-server/authorized-keys
Allocated ports:
  wezterm-server/hostSshPort: 22425
[...]
lace up completed (devcontainer up skipped)
LACE_RESULT: {"exitCode":0,"failedPhase":null,"containerMayBeRunning":false}
```

Lace correctly detected `worktree 'main'` in the bare-worktree layout.

### All 8 Test Cases Pass
