---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T16:30:00-08:00
task_list: lace/dotfiles-migration
type: devlog
state: live
status: done
tags: [coordinator, implementation, dotfiles, archive, nushell, plugin, launcher]
---

# Dotfiles Modernization Implementation: Coordinator Devlog

## Objective

Coordinate implementation of four accepted proposals in sequence:
1. **Archive Migration** (dotfiles repo) -- R1 accepted
2. **Nushell Setup** (dotfiles repo) -- R3 accepted
3. **Plugin Docker User Lookup** (lace.wezterm repo) -- R1 accepted
4. **Launcher Elimination** (dotfiles repo) -- amended

Each phase runs as a background agent with its own devlog, commits, and review cycles. This devlog tracks coordination, validation, and cross-phase issues.

Reference: [Project Assessment](../reports/2026-02-05-dotfiles-modernization-project-assessment.md)

## Plan

1. Launch Phase 1 (archive) + Phase 3 (plugin) in parallel -- different repos
2. Validate Phase 1 and Phase 3 results
3. Launch Phase 2 (nushell) + Phase 4 (launcher elimination) in parallel
4. Validate Phase 2 and Phase 4 results
5. Produce implementation summary report via subagent

## Testing Approach

Coordinator validates each phase via:
- Git log review (commits match proposal phases)
- File structure verification (expected files exist/removed)
- Runtime checks where safe (shell sourcing, config loading)
- Devlog review (success criteria documented with evidence)

## Implementation Notes

### Phase Dispatch Log

| Phase | Agent | Status | Notes |
|-------|-------|--------|-------|
| 1: Archive | a0ac422 | **done** | 2 commits: `2ef5d95`, `a61ba74` |
| 2: Nushell | a04e6e0 | **done** | 2 commits: `de01d5e`, `b2da41b`. 3 nushell v0.110 compat fixes |
| 3: Plugin | a549671 | **done** | 1 commit: `172a059` (lace.wezterm) |
| 4: Launcher | a584120 | **done** | 1 commit: `67c0ea8` |

### Parallelization Strategy

- **Wave 1**: Phase 1 (archive, dotfiles repo) + Phase 3 (plugin, lace.wezterm repo) -- no dependency between them, different repos
- **Wave 2**: Phase 2 (nushell, dotfiles repo) + Phase 4 (launcher, dotfiles repo) -- Phase 2 depended on Phase 1, Phase 4 depended on Phase 3. Both could run in parallel since they touch different files in the dotfiles repo.

### Pre-Implementation State

**Dotfiles repo** (`/home/mjr/code/personal/dotfiles/`):
- Branch: `weztime`
- Uncommitted: renamed `archive/setup.sh.archive` and modified `dot_config/wezterm/wezterm.lua` (plugin path fix from earlier session)
- These changes are unrelated to archive work and left as-is

**lace.wezterm repo** (`/home/mjr/code/weft/lace.wezterm/`):
- Branch: `main`, clean working tree
- `plugin/init.lua`: 291 lines, current code hardcodes `username = "node"`

### Cross-Phase Issues Found

**Nushell v0.110.0 compat**: The nushell proposal had 3 code snippets with outdated syntax:
1. `char escape` -> `ansi escape` (7 occurrences in env.nu)
2. `get -i` -> `get -o` (1 occurrence in completions.nu)
3. `2>` -> `err>` (3 occurrences in utils.nu)

The implementing agent fixed these during implementation. These should be noted in the proposal for future reference.

**`nu -c` skips config**: Running `nu -c 'command'` does NOT load config by default. Must use `nu -l -c` or `nu --config ... --env-config ...` to get config-aware execution. This is different from `bash -c` behavior.

## Changes Made

### Dotfiles Repo (`/home/mjr/code/personal/dotfiles/`, branch `weztime`)

| Commit | Files | Description |
|--------|-------|-------------|
| `2ef5d95` | archive/legacy/* | Copy legacy files to archive structure |
| `a61ba74` | bash/, vscode/, blackbox/, dot_bashrc, etc. | Delete originals, reroute bashrc paths |
| `67c0ea8` | .devcontainer/devcontainer.json, bin/open-dotfiles-workspace | Port 22426, lace key, delete launcher |
| `de01d5e` | dot_config/nushell/*, run_once_before_30-install-carapace.sh | Full nushell config (9 files + carapace installer) |
| `b2da41b` | dot_config/wezterm/wezterm.lua | Set default_prog to nushell, plugin path fix |

### lace.wezterm Repo (`/home/mjr/code/weft/lace.wezterm/`, branch `main`)

| Commit | Files | Description |
|--------|-------|-------------|
| `172a059` | plugin/init.lua | Domain username override + StrictHostKeyChecking |

### Lace Repo (`/var/home/mjr/code/weft/lace/`)

Devlogs and reviews created (not yet committed as a batch):
- `cdocs/devlogs/2026-02-05-archive-migration-implementation.md`
- `cdocs/devlogs/2026-02-05-plugin-docker-user-lookup-implementation.md`
- `cdocs/devlogs/2026-02-05-nushell-setup-implementation.md`
- `cdocs/devlogs/2026-02-05-launcher-elimination-implementation.md`
- `cdocs/reviews/` -- 4 self-review files (all accepted)

## Verification

### Phase 1: Archive Migration

```
=== Legacy dirs gone ===
bash: removed OK
vscode: removed OK
blackbox: removed OK
=== Out-of-scope dirs ===
firefox: present OK
tridactyl: present OK
btrfs: present OK
macos: present OK
=== Starship preserved ===
starship.toml: OK
starship run_once: OK
=== Bashrc rerouted ===
BASHFILES_DIR=/home/mjr/code/personal/dotfiles/archive/legacy/bash
```

### Phase 2: Nushell Setup

```
| test              | result                       |
| edit_mode         | vi                           |
| EDITOR            | nvim                         |
| history_format    | sqlite                       |
| STARSHIP_SHELL    | nu                           |
| color_header      | {fg: "#b58900", attr: b}     |
| completions_ext   | true                         |
| vim_alias         | 1                            |
| showip_cmd        | 1                            |
| startup_time      | 93ms (target: <500ms)        |
```

### Phase 3: Plugin Docker User Lookup

- `luac -p` syntax check: SYNTAX OK
- Signature consistency (definition + call site): verified
- Guards preserved (`_registered_events`, `_domains_registered`): verified
- `StrictHostKeyChecking = "accept-new"` added to ssh_option: verified
- Domain override loop with logging: verified

### Phase 4: Launcher Elimination

- Port: 22426 (in lace range 22425-22499): verified
- SSH key: lace_devcontainer.pub: verified
- Mount target: /home/vscode/ (native user preserved): verified
- Launcher deleted: verified (373 lines removed)
- No stale references found: verified

### Deferred Verifications

- Container rebuild + end-to-end discovery test (Phase 4 -- cannot rebuild during session)
- Plugin picker test with `vscode` user container (requires rebuilt container)
- WezTerm restart to pick up `default_prog` change (user action)
