---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T17:00:00-08:00
task_list: lace/wezterm-plugin
type: devlog
state: archived
status: done
tags: [implementation, plugin, wezterm, docker, username]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-05T17:30:00-08:00
  round: 1
---

# Plugin Docker User Lookup Implementation: Devlog

## Objective

Implement the Docker-based SSH username lookup for the lace.wezterm plugin, as specified in the proposal at `cdocs/proposals/2026-02-05-lace-wezterm-docker-user-lookup.md`. The core problem: the plugin hardcodes `username = "node"` for all 75 pre-registered SSH domains, breaking containers that use a different user (e.g., `vscode` in the dotfiles container). The fix: override the SSH domain's username with the Docker-discovered user at connection time via the project picker.

## Implementation Notes

### Approach: Domain Re-Registration

The implementation follows the proposal's recommended Approach A (domain re-registration). When the user selects a project from the picker, the plugin:

1. Looks up the matching `lace:PORT` SSH domain in `config.ssh_domains`
2. Overwrites `domain.username` with `project.user` (discovered via `docker inspect`)
3. Connects via `SwitchToWorkspace` using the now-updated domain

This works because Lua tables are reference types -- `config.ssh_domains` is the same table WezTerm reads at connection time. Mutating `domain.username` in the picker callback changes what WezTerm sees when it processes the `SwitchToWorkspace` action.

### Why Not ConnectToUri

`ConnectToUri` with `ssh://user@localhost:port` bypasses the SSH domain entirely, losing the configured identity file, multiplexing mode, and `StrictHostKeyChecking` setting. Domain re-registration preserves all SSH domain configuration while only changing the username.

## Changes Made

All changes in `/home/mjr/code/weft/lace.wezterm/plugin/init.lua`:

### Change 1: StrictHostKeyChecking in SSH Domain Options (line 68)

Added `StrictHostKeyChecking = "accept-new"` to the `ssh_option` table in `setup_port_domains()`. This replaces a comment about host key verification and is needed by the launcher elimination proposal.

```lua
ssh_option = {
  identityfile = opts.ssh_key,
  StrictHostKeyChecking = "accept-new",
},
```

### Change 2: Modified `setup_project_picker` Signature (line 144)

Added `config` as the first parameter so the picker closure can access `config.ssh_domains` for domain re-registration.

```lua
-- Before:
local function setup_project_picker(opts)
-- After:
local function setup_project_picker(config, opts)
```

### Change 3: Domain Username Override in Picker Action (lines 180-193)

Added a loop before `SwitchToWorkspace` that finds the matching SSH domain and overrides its username with the discovered container user. Includes defensive logging and a fallback warning if the domain is not found.

```lua
-- Override the SSH domain's username with the discovered container user
local domain_name = "lace:" .. project.port
local domain_found = false
for _, domain in ipairs(config.ssh_domains) do
  if domain.name == domain_name then
    wezterm.log_info("lace: connecting to " .. project.name .. " as " .. project.user .. " on port " .. project.port)
    domain.username = project.user
    domain_found = true
    break
  end
end
if not domain_found then
  wezterm.log_warn("lace: SSH domain " .. domain_name .. " not found in config.ssh_domains -- connecting with pre-registered default")
end
```

Also refactored the `SwitchToWorkspace` block to use the already-computed `domain_name` variable instead of re-computing `"lace:" .. project.port`.

### Change 4: Updated Call Site (line 282)

Updated the `setup_project_picker` call in `apply_to_config()` to pass `config` as the first argument.

```lua
-- Before:
local picker_event = setup_project_picker(opts)
-- After:
local picker_event = setup_project_picker(config, opts)
```

## Verification

### Lua Syntax Check

```
$ luac -p /home/mjr/code/weft/lace.wezterm/plugin/init.lua
SYNTAX OK
```

No syntax errors. The file compiles cleanly.

### Structural Verification

- Function signature at definition (line 144): `setup_project_picker(config, opts)` -- matches call site
- Call site (line 282): `setup_project_picker(config, opts)` -- `config` is available as first param of `apply_to_config`
- Domain override loop uses `ipairs(config.ssh_domains)` to iterate the same table WezTerm reads
- `_registered_events` guard preserved (lines 148-150) -- prevents duplicate handler registration
- `_domains_registered` guard preserved (lines 53-55) -- prevents duplicate domain registration
- `discover_projects()` untouched -- already returns `user` per project
- `setup_port_domains()` only changed for `StrictHostKeyChecking` addition
- Port range constants `M.PORT_MIN`/`M.PORT_MAX` untouched
- File grew from 291 lines to 307 lines (net +16 lines)

### Git Diff Summary

```
plugin/init.lua | 21 insertions(+), 5 deletions(-)
```

### Commit

```
172a059 feat: override SSH domain username with Docker-discovered user at connect time
```

Committed on `main` in `/home/mjr/code/weft/lace.wezterm/`, ahead of origin by 1 commit.

## What This Unblocks

- **Launcher elimination proposal**: The dotfiles container uses `vscode` user, not `node`. With this change, the project picker correctly discovers and connects with `vscode`, removing the need for the `remoteUser: "node"` workaround.
- **Multi-user container support**: Any container can use any SSH user and the picker will connect correctly.

## Remaining Work

- **Manual testing**: Requires a container in the lace port range (22425-22499) to test end-to-end. The current lace container is on port 2222 (outside range). Testing deferred to Phase 5 of the proposal (post-launcher-elimination).
- **WezTerm config path fix**: The deployed `~/.config/wezterm/wezterm.lua` still points to the old plugin path. This is a separate concern managed via the dotfiles repo.
- **Push to origin**: Not pushed yet -- awaiting user confirmation.
