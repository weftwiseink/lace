---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-20T12:20:00-07:00
task_list: lace/cdocs-plugin-mounting
type: proposal
state: archived
status: implementation_accepted
tags: [mounts, cdocs, plugins, configuration]
---

# Mount Clauthier Marketplace into Lace Devcontainer

> BLUF: Two configuration changes (zero code changes) make the `cdocs@clauthier` plugin work inside the devcontainer.
> Add a `repoMounts` declaration to `.devcontainer/devcontainer.json` and an override entry to `~/.config/lace/settings.json` with host-path mirroring.
> Verification requires `lace up`, container rebuild, and confirming the marketplace path resolves inside the container.

## Objective

Make the `cdocs@clauthier` Claude Code plugin functional inside the lace devcontainer.
The plugin's marketplace source path (`/var/home/mjr/code/weft/clauthier/main`) must exist inside the container so that plugin resolution, skill loading, and marketplace updates work correctly.

## Background

The lace devcontainer bind-mounts `~/.claude` into the container.
This carries along Claude Code's plugin registry (`~/.claude/plugins/`), which includes `known_marketplaces.json` and `installed_plugins.json`.

The `clauthier` marketplace is registered as a local directory source:
```json
"clauthier": {
  "source": { "source": "directory", "path": "/var/home/mjr/code/weft/clauthier/main" },
  "installLocation": "/var/home/mjr/code/weft/clauthier/main"
}
```

This absolute host path does not exist inside the container.
While the plugin cache at `~/.claude/plugins/cache/clauthier/cdocs/0.1.0` is present (via the `~/.claude` mount), the marketplace source is unreachable, preventing updates and potentially causing resolution errors.

The repoMounts feature in lace handles exactly this case via `overrideMount.target` (host-path mirroring).
See `cdocs/reports/2026-03-20-cdocs-plugin-mounting-status.md` for the full investigation.

## Proposed Solution

### Change 1: `.devcontainer/devcontainer.json`

Add a `repoMounts` section to `customizations.lace`:

```json
"repoMounts": {
  "github.com/weftwiseink/clauthier": {}
}
```

This declares clauthier as an external repo to mount.
Without a settings override, lace would shallow-clone from GitHub.
With an override (Change 2), lace uses the local checkout instead.

### Change 2: `~/.config/lace/settings.json`

Add a repoMounts override entry:

```json
"github.com/weftwiseink/clauthier": {
  "overrideMount": {
    "source": "~/code/weft/clauthier/main",
    "target": "/var/home/mjr/code/weft/clauthier/main",
    "readonly": true
  }
}
```

This tells lace to:
1. Mount `~/code/weft/clauthier/main` (host) to `/var/home/mjr/code/weft/clauthier/main` (container).
2. Generate a symlink from `/mnt/lace/repos/clauthier` to the custom target path.
3. Mark the mount readonly.

The target matches the absolute host path stored in `known_marketplaces.json`, so Claude Code's plugin resolution finds the marketplace at the expected location.

> NOTE(opus/cdocs-plugin-mounting): `settings.json` is a user-level file (not committed).
> Contributors without a local clauthier clone would use the default clone-from-GitHub behavior, which places the repo at `/mnt/lace/repos/clauthier`.
> In that case, `known_marketplaces.json` paths would not match, but the cached plugin would still load.
> Full portability is a separate concern from this proposal.

### Generated Result

After `lace up`, the generated `.lace/devcontainer.json` will include:

**In `mounts` array:**
```
type=bind,source=/var/home/mjr/code/weft/clauthier/main,target=/var/home/mjr/code/weft/clauthier/main,readonly
```

**In `postCreateCommand`:**
```sh
mkdir -p "$(dirname '/mnt/lace/repos/clauthier')" && rm -f '/mnt/lace/repos/clauthier' && ln -s '/var/home/mjr/code/weft/clauthier/main' '/mnt/lace/repos/clauthier'
```

## Important Design Decisions

**Mount the worktree, not the bare repo parent.**
The marketplace source path points to `/var/home/mjr/code/weft/clauthier/main` (the worktree), not the bare repo parent.
Mounting just the worktree is more precise and avoids exposing git internals.
The `overrideMount.source` is the only path that needs to match; the repoId (`github.com/weftwiseink/clauthier`) is a logical identifier, not a file path.

**Host-path mirroring via `overrideMount.target`.**
The target must be `/var/home/mjr/code/weft/clauthier/main` (the exact host path) so that absolute paths in `known_marketplaces.json` resolve inside the container.
This is the documented "host-path mirroring" pattern from the README.

**Readonly mount.**
The marketplace directory should not be modified from inside the container.
Plugin development happens on the host.

## Edge Cases

**Contributor without local clauthier clone.**
Lace falls through to the clone codepath: shallow-clone from `github.com/weftwiseink/clauthier` to `~/.config/lace/<projectId>/repos/clauthier`, mount at `/mnt/lace/repos/clauthier`.
The `known_marketplaces.json` path mismatch means marketplace operations may fail, but the cached plugin loads from `~/.claude/plugins/cache/`.

**Clauthier worktree does not exist at override source.**
`resolveOverrideRepoMount()` validates `existsSync(override.source)` and throws `MountsError` with a clear message.
The user would need to clone clauthier or remove the override.

**Bare-worktree layout evolves.**
If the clauthier worktree moves (e.g., a new worktree name), the settings override source path must be updated.
This is a manual operation.

## Test Plan

No new unit tests are needed: the `overrideMount.target` codepath has existing test coverage in `mounts.test.ts` (symlink generation, custom target resolution).

### Integration Verification

1. Run `lace up` and inspect `.lace/devcontainer.json` for the mount spec and symlink command.
2. Rebuild the container.
3. Inside the container, verify:
   - `/var/home/mjr/code/weft/clauthier/main` exists and contains the marketplace files.
   - `/mnt/lace/repos/clauthier` is a symlink pointing to the above.
   - `claude` loads the cdocs plugin (skills appear in `/help`).

## Implementation Phases

### Phase 1: Add repoMounts declaration to devcontainer.json

Add `"repoMounts"` to the existing `customizations.lace` section in `.devcontainer/devcontainer.json`:

```json
"repoMounts": {
  "github.com/weftwiseink/clauthier": {}
}
```

Place it after the `"mounts"` section.

### Phase 2: Add settings override

Add the clauthier entry to the `repoMounts` section of `~/.config/lace/settings.json`:

```json
"github.com/weftwiseink/clauthier": {
  "overrideMount": {
    "source": "~/code/weft/clauthier/main",
    "target": "/var/home/mjr/code/weft/clauthier/main",
    "readonly": true
  }
}
```

### Phase 3: Run `lace up` and verify generated config

Run `lace up` and inspect `.lace/devcontainer.json`:
- Confirm the clauthier mount spec appears in the `mounts` array.
- Confirm the symlink command appears in `postCreateCommand`.

### Phase 4: Rebuild container and verify end-to-end

Rebuild the devcontainer and verify inside the container:
- The marketplace path exists: `ls /var/home/mjr/code/weft/clauthier/main/plugins/cdocs`.
- The symlink exists: `readlink /mnt/lace/repos/clauthier`.
- Claude Code loads the plugin: cdocs skills appear in the skill list.
