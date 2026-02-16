---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T12:00:00-06:00
task_list: maintenance/worktrunk-migration
type: devlog
state: live
status: wip
tags: [worktrunk, npm-link, nushell, migration, wez-into, retry]
---

# Worktrunk Migration Fix: Devlog

## Objective

After migrating the lace repo from a regular clone at `/var/home/mjr/code/weft/lace/`
to a bare-repo + worktree layout (bare at `lace/`, worktree at `lace/main/`), the `lace`
command is no longer found. Need to fix all path references that still point to the old
layout so the CLI works from the new worktrunk structure.

## Root Cause

Three broken path references from the old layout:

1. **npm global symlink** — `/home/linuxbrew/.linuxbrew/lib/node_modules/lace` →
   `../../../../mjr/code/weft/lace/packages/lace` (old, pre-migration path).
   Needs to point to `lace/main/packages/lace`.

2. **No build artifacts** — `packages/lace/dist/index.js` doesn't exist in the worktree
   (never built after migration).

3. **Nushell PATH** — `env.nu` adds `/var/home/mjr/code/weft/lace/bin` to PATH, but `bin/`
   is now at `lace/main/bin/`.

## Plan

1. Install dependencies and build the CLI in the worktree
2. Re-link npm from the new worktree location
3. Fix the nushell PATH entry
4. Verify `lace` command works

## Testing Approach

Manual verification + full test suite (690 tests).

## Implementation Notes

### Git layout after migration

```
/var/home/mjr/code/weft/lace/
├── .git/           # bare repo (core.bare = true)
│   └── worktrees/
│       └── main/   # worktree metadata
└── main/           # worktree checkout (branch: main)
    ├── packages/lace/  # CLI source
    ├── bin/            # helper scripts (lace-discover, wez-into)
    └── ...
```

### npm symlink chain (before fix)

```
/home/linuxbrew/.linuxbrew/bin/lace
  → ../lib/node_modules/lace/dist/index.js
/home/linuxbrew/.linuxbrew/lib/node_modules/lace
  → ../../../../mjr/code/weft/lace/packages/lace   ← BROKEN (old path)
```

### Additional discovery: wez-into fallback paths

The `bin/wez-into` script had 4 hardcoded fallback paths for locating `lace-discover` and
the `lace` CLI that also referenced the old layout (without `/main/`). These are used when
the commands aren't found on PATH or co-located with the script.

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/` | `npm link` — re-linked global symlink from new worktree location |
| `bin/wez-into` | Updated 4 hardcoded fallback paths to include `/main/` |
| `bin/wez-into` | Fixed retry regression: fail fast when lace up never reached `devcontainer up` |
| `~/.config/nushell/env.nu` (chezmoi) | Updated PATH entry from `lace/bin` to `lace/main/bin` |

External changes (not in this repo):
- **chezmoi source**: `dot_config/nushell/env.nu` in dotfiles repo updated + `chezmoi apply`
- **npm global**: Ran `npm unlink -g && npm link` in `packages/lace/`

### Retry regression fix (wez-into)

The `start_and_connect` function previously retried discovery 10 times for ANY non-zero
exit from `lace up` (except 126/127). This included definitive config errors like
"Cannot read devcontainer.json" where the container was never started.

**Fix**: Check if `lace up` output contains `"Starting devcontainer"` — this line is
printed by `up.ts:542` immediately before invoking `devcontainer up`. If absent, lace
failed in an early phase and the container was never started. Fail immediately.

The retry loop is still preserved for the case where `devcontainer up` was invoked but
something failed afterward (e.g., `postStartCommand` failure), since the container may
actually be running.

## Known Issues / Remaining Work

### Stale Docker container

The old container `confident_noether` has `devcontainer.local_folder=/var/home/mjr/code/weft/lace`
baked into its Docker labels (pre-migration path). Docker labels are immutable after creation.
This container must be removed and re-created from the worktree path.

```sh
docker rm confident_noether
lace up --workspace-folder /var/home/mjr/code/weft/lace/main
```

### Project naming with worktrunk layout

Both `lace-discover` and `discover_stopped` use `basename` of the `devcontainer.local_folder`
label to derive the project name. After worktrunk migration:
- Old path: `basename /var/home/mjr/code/weft/lace` → **"lace"**
- New path: `basename /var/home/mjr/code/weft/lace/main` → **"main"**

This means `wez-into lace` would become `wez-into main` after re-creating the container.
This needs a design decision — possible approaches:
1. Use the devcontainer.json `name` field instead of `basename`
2. Walk up the path to find the repo name (parent of worktree)
3. A naming convention in `customizations.lace`

This is tracked as a separate design question, not addressed in this fix.

## Verification

### lace CLI resolves correctly

```
$ readlink -f /home/linuxbrew/.linuxbrew/bin/lace
/var/home/mjr/code/weft/lace/main/packages/lace/dist/index.js

$ lace --help
Devcontainer orchestration CLI (lace v0.1.0)
USAGE lace prebuild|resolve-mounts|restore|status|up
```

### Full test suite: 690/690 passed

```
 Test Files  27 passed (27)
      Tests  690 passed (690)
   Duration  23.62s
```
