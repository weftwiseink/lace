---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-20T12:13:45-07:00
task_list: lace/cdocs-plugin-mounting
type: report
state: archived
status: done
tags: [status, mounts, cdocs, plugins]
---

# cdocs Plugin Mounting in the Lace Devcontainer

> BLUF: The cdocs plugin works on the host via a local `clauthier` marketplace but will fail inside the devcontainer because the marketplace source path (`/var/home/mjr/code/weft/clauthier/main`) is not mounted.
> The repoMounts feature is fully implemented and has test coverage for the `overrideMount.target` (host-path mirroring) codepath.
> The fix requires two configuration additions (devcontainer.json and settings.json) and no code changes.

## Context

The lace devcontainer mounts `~/.claude` into the container, carrying along Claude Code's plugin registry.
The project's `.claude/settings.json` enables `cdocs@clauthier`, a plugin installed from a local directory marketplace at `/var/home/mjr/code/weft/clauthier/main`.

Three concerns prompted this investigation:
1. Whether the repoMounts feature has regressed.
2. Missing `~/.config/lace/settings.json` entry for clauthier.
3. Missing `customizations.lace.repoMounts` declaration in `.devcontainer/devcontainer.json`.

## Key Findings

### 1. repoMounts Implementation: No Regression

The repoMounts feature in `packages/lace/src/lib/mounts.ts` is complete and correct:

- `resolveOverrideRepoMount()` handles `overrideMount.target` (lines 207-239).
- When `override.target` differs from the default (`/mnt/lace/repos/<name>`), a `symlink` spec is generated so `/mnt/lace/repos/<name>` symlinks to the custom target.
- `generateSymlinkCommands()` produces `mkdir -p && rm -f && ln -s` chains injected into `postCreateCommand`.
- `up.ts` wires mountSpecs and symlinkCommands into the generated `.lace/devcontainer.json` (lines 620-644, 875-906).
- Test coverage exists for the override+symlink path in `mounts.test.ts`.

The feature was never configured for clauthier; it hasn't regressed.

### 2. Plugin Registry Anatomy

`~/.claude/plugins/known_marketplaces.json` has three marketplaces:

| Marketplace | Source | Install Location |
|---|---|---|
| `claude-plugins-official` | GitHub `anthropics/claude-plugins-official` | `~/.claude/plugins/marketplaces/claude-plugins-official` |
| `weft-marketplace` | GitHub `weftwiseink/clauthier` | `~/.claude/plugins/marketplaces/weft-marketplace` |
| `clauthier` | Local directory `/var/home/mjr/code/weft/clauthier/main` | `/var/home/mjr/code/weft/clauthier/main` |

The `cdocs` plugin is installed from `clauthier` (local) and cached at `~/.claude/plugins/cache/clauthier/cdocs/0.1.0`.

### 3. Why the Plugin Partially Works In-Container Today

The plugin cache (`~/.claude/plugins/cache/`) lives inside `~/.claude/`, which is bind-mounted via the `claude-config` mount.
Claude Code loads skills and agents from the cache path, so the plugin's skills/agents may load even without the marketplace source path.

However, `plugin update` or any marketplace refresh would fail because it resolves back to the local directory source path, which doesn't exist in the container.

### 4. Two Alternative Approaches Exist

**Option A: repoMounts with host-path mirroring (local dev workflow).**
Mount clauthier into the container at the same host path so all absolute paths in the registry resolve.
This is the documented pattern from `README.md` lines 513-531.

**Option B: Switch to GitHub-backed `weft-marketplace`.**
A `weft-marketplace` already exists in `known_marketplaces.json`, backed by `weftwiseink/clauthier` on GitHub.
If `.claude/settings.json` used `cdocs@weft-marketplace` instead of `cdocs@clauthier`, no host-path mount is needed: updates would clone from GitHub into `~/.claude/plugins/marketplaces/`.

### 5. What Option A Requires

Two config changes, zero code changes:

1. **`.devcontainer/devcontainer.json`**: add `customizations.lace.repoMounts`:
```json
"repoMounts": {
  "github.com/weftwiseink/clauthier": {}
}
```

2. **`~/.config/lace/settings.json`**: add override with target for symmetric path:
```json
"github.com/weftwiseink/clauthier": {
  "overrideMount": {
    "source": "~/code/weft/clauthier",
    "target": "/var/home/mjr/code/weft/clauthier",
    "readonly": true
  }
}
```

After `lace up`, the generated config would include the bind mount and a postCreateCommand symlink from `/mnt/lace/repos/clauthier` to `/var/home/mjr/code/weft/clauthier`.

### 6. Clauthier Repo Structure

Clauthier uses bare-worktree layout: the `main` worktree is at `/var/home/mjr/code/weft/clauthier/main`.
The marketplace source in `known_marketplaces.json` points to the `main` worktree specifically.
The mount source should be `~/code/weft/clauthier` (the parent), and the repoMount target should be `/var/home/mjr/code/weft/clauthier` so that the `main` subdirectory resolves at the same absolute path.

## Analysis: Option A vs Option B

| Criterion | A: repoMounts | B: weft-marketplace |
|---|---|---|
| Local edits visible in container | Yes (bind mount) | No (GitHub snapshot) |
| Plugin updates in container | Works via local path | Works via GitHub |
| Configuration complexity | Two config files | One settings.json change |
| Portability to other machines | Requires local clauthier clone | Works anywhere with GitHub access |
| Development iteration speed | Instant (file changes propagate) | Requires push+update cycle |

Option A is better for active plugin development (which lace+cdocs is doing).
Option B is better for stable consumption.
Both can coexist: use Option A locally, Option B on CI/other machines.

## Open Questions

1. **Worktree mount granularity**: Should we mount `~/code/weft/clauthier` (the bare repo parent) or `~/code/weft/clauthier/main` (just the worktree)?
   The marketplace source path points to `main`, so the parent mount would make all worktrees accessible.
   A `main`-only mount would be more precise but would need the repoId to use a subdirectory path.

2. **Dual marketplace coexistence**: Should `.claude/settings.json` switch to `cdocs@weft-marketplace` (Option B) as the default, with Option A used only during active development?
   This would make the project more portable.

## Recommendations

1. Implement Option A for the local development workflow.
2. Consider switching the committed `.claude/settings.json` to use `cdocs@weft-marketplace` for portability, with a note in CLAUDE.md about using the local override for plugin development.
3. No code changes are needed: the repoMounts feature is working correctly.
