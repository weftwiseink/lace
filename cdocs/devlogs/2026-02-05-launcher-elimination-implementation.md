---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T17:30:00-08:00
task_list: lace/dotfiles-migration
type: devlog
state: live
status: wip
tags: [implementation, launcher, devcontainer, port-range, elimination]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-05T17:45:00-08:00
  round: 1
---

# Launcher Elimination Implementation

## Objective

Implement the dotfiles launcher elimination as specified in `cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md`. Migrate the dotfiles devcontainer to the lace port-range model (port 22426, shared SSH key) and delete the 373-line `bin/open-dotfiles-workspace` launcher script. The lace ecosystem (plugin discovery, `wez-lace-into`, project picker) replaces all launcher functionality.

## Prerequisites Verified

- **lace.wezterm plugin docker user lookup**: Implemented in `/home/mjr/code/weft/lace.wezterm/plugin/init.lua` (see devlog `2026-02-05-plugin-docker-user-lookup-implementation.md`). The plugin now resolves per-container SSH usernames via `docker inspect`, so the dotfiles container's `vscode` user is correctly handled.
- **Archive migration**: Complete (see devlog `2026-02-05-archive-migration-implementation.md`).

## Implementation Notes

### Phase 1: Devcontainer Configuration Update

Two changes to `dotfiles/.devcontainer/devcontainer.json`:

**Port change**: `appPort` from `"2223:2222"` to `"22426:2222"`

```diff
-  // Uses port 2223 to avoid conflict with lace devcontainer (port 2222)
-  "appPort": ["2223:2222"],
+  // Port 22426 is in the lace discovery range (22425-22499) for auto-discovery
+  "appPort": ["22426:2222"],
```

**SSH key change**: mount source from `dotfiles_devcontainer.pub` to `lace_devcontainer.pub`

```diff
-    // One-time setup: ssh-keygen -t ed25519 -f ~/.ssh/dotfiles_devcontainer -N ""
-    "source=${localEnv:HOME}/.ssh/dotfiles_devcontainer.pub,target=/home/vscode/.ssh/authorized_keys,type=bind,readonly"
+    // One-time setup: ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ""
+    "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/vscode/.ssh/authorized_keys,type=bind,readonly"
```

No other changes to devcontainer.json. The image, features, postStartCommand, customizations, and mount target (`/home/vscode/.ssh/authorized_keys`) are all unchanged.

### Phase 2: Discovery Verification

**SSH key existence**: Confirmed `~/.ssh/lace_devcontainer` (private) and `~/.ssh/lace_devcontainer.pub` exist on the host, created 2026-02-01.

**Port range check**: Verified programmatically that port 22426 is within the lace discovery range 22425-22499. `lace-discover` scans this range via Docker port mappings.

**lace-discover script**: Reviewed `/var/home/mjr/code/weft/lace/bin/lace-discover`. It queries Docker for containers with the `devcontainer.local_folder` label, filters for ports in 22425-22499 mapped to internal port 2222, and outputs `name:port:user:path`. Port 22426 will be discovered correctly.

**Deferred verification**: Full end-to-end testing (container rebuild, `lace-discover` output, `wez-lace-into dotfiles`, project picker) cannot be performed without rebuilding the container, which would disrupt the current running session on port 2223. This must be verified manually after the session ends by running:

```bash
devcontainer up --workspace-folder ~/code/personal/dotfiles --remove-existing-container
lace-discover  # Should show: dotfiles:22426:vscode:/home/mjr/code/personal/dotfiles
wez-lace-into dotfiles  # Should connect via lace:22426
```

### Phase 3: Launcher Deletion

**Line count**: 373 lines (the proposal cited 374; the actual count is 373 because the file has no trailing newline).

**Reference check**: Searched the entire dotfiles repo for references to `open-dotfiles-workspace`. Found 4 self-references within the script itself (usage comments, log file path). No external references in any `.sh`, `.json`, `.md`, `.lua`, bashrc, or alias files.

**Port 2223 references**: Found only in `bin/open-dotfiles-workspace` (line 46: `SSH_PORT=2223`) and `devcontainer.json` (lines 18-19, now updated). After deletion and update, no references to port 2223 remain in the repo.

**Static WezTerm domain check**: Searched `dot_config/wezterm/` for any static `dotfiles` SSH domain configuration. None found -- the wezterm config uses the lace.wezterm plugin for all domain registration.

**Shell alias check**: Searched `dot_bashrc` and all alias-related files for references to `open-dotfiles-workspace` or port 2223. None found.

**bin/ directory**: After `git rm bin/open-dotfiles-workspace`, the `bin/` directory was empty and automatically removed. No other files were in it.

**Deleted via**: `git rm bin/open-dotfiles-workspace`

### Phase 4: known_hosts Cleanup

Ran `ssh-keygen -R "[localhost]:2223"` to remove the stale known_hosts entry for the old port. No error (entry may or may not have existed).

### Commit

Committed as `67c0ea8` on branch `weztime`:

```
refactor(devcontainer): migrate to lace port-range model, delete launcher

- Change SSH port from 2223 to 22426 (in lace discovery range 22425-22499)
- Switch SSH key from dotfiles_devcontainer to lace_devcontainer
- Delete 373-line bin/open-dotfiles-workspace launcher script
- The lace ecosystem (plugin discovery, wez-lace-into, project picker)
  now handles all connection functionality

Depends on: lace.wezterm docker user lookup (for vscode username resolution)
```

Diff stats: 2 files changed, 4 insertions, 377 deletions.

## What Was Not Changed

- **`dot_config/wezterm/wezterm.lua`**: Not touched. Another parallel agent is managing this file (nushell setup). No stale dotfiles SSH domain was found in it anyway.
- **`archive/setup.sh`**: Uncommitted changes from a prior session, left untouched.
- **`dot_config/nushell/`**: Untracked nushell config from parallel agent, left untouched.
- **Phase 4 of the proposal** (migrate lace's own devcontainer to port 22425): Out of scope per the proposal.
- **`~/.ssh/dotfiles_devcontainer`**: Old SSH key pair left in place for now. Can be deleted after verifying the migration works end-to-end.

## Deferred Steps

1. **Container rebuild and end-to-end test**: Must rebuild the dotfiles container with `--remove-existing-container` to pick up the new port and key. Cannot do this during the current session.
2. **Old SSH key cleanup**: Delete `~/.ssh/dotfiles_devcontainer` and `~/.ssh/dotfiles_devcontainer.pub` after confirming the migration works.
3. **Convenience alias**: Consider adding `alias dotfiles-up='devcontainer up --workspace-folder ~/code/personal/dotfiles'` to shell config (the dotfiles repo itself, via nushell or bashrc).
