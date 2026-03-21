---
first_authored:
  by: "@claude-opus-4-6-20250515"
  at: 2026-03-20T15:00:00-07:00
task_list: wezterm/split-pane-regression
type: devlog
state: archived
status: done
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-20T17:45:00-07:00
  round: 2
tags: [wezterm, lace.wezterm, regression, implementation]
---

# Container-Aware Split Panes Implementation

> BLUF: Implemented ExecDomain-based container-aware split panes across 5 phases.
> Core mechanism verified: splits in container tabs land in the container (not host), confirmed via live testing against 2 running containers.
> Two runtime bugs found and fixed during testing: `wezterm.GLOBAL` requires string keys, and stale domain registrations persist across config reloads (one-time mux server restart needed after deployment).
> Bypass bindings deferred: WezTerm does not respect domain override in ExecDomain splits.
> See `cdocs/reports/2026-03-20-bypass-binding-investigation.md` and `cdocs/proposals/2026-03-20-exec-domain-bypass-bindings.md`.

## Objective

Implement the ExecDomain-based container-aware split panes proposal (`cdocs/proposals/2026-03-20-container-aware-split-panes.md`).

The goal: Alt-H/J/K/L splits in lace container tabs should open container shells instead of host shells.

The mechanism: ExecDomains provide pane-level domain identity that propagates to splits via `CurrentPaneDomain` inheritance.

## Plan

Five implementation phases per the proposal:

1. **ExecDomain registration** in `lace.wezterm/plugin/init.lua`: helper functions, `setup_exec_domains`, GLOBAL metadata, SSH domain rename.
2. **Picker and wez-into changes**: switch to ExecDomain-based spawn, update cold-start fallback.
3. **Bypass bindings** in `dot_config/wezterm/wezterm.lua`: Alt+Shift+HJKL with `domain = "DefaultDomain"`.
4. **Documentation**: connection mode architecture in plugin source.
5. **End-to-end testing**: full test plan against live WezTerm instances.

## Testing Approach

- WezTerm config validation per CLAUDE.md workflow (ls-fonts parse check, show-keys diff).
- Live verification against running WezTerm instances and devcontainers.
- Phase reviews via subagent after each phase.

## Implementation Notes

### Phase 1: ExecDomain Registration

Added to `lace.wezterm/plugin/init.lua`:

- Utility helpers: `shell_escape`, `nonempty`, `basename`, `extract_lace_port`
- ExecDomain infrastructure: `build_ssh_args`, `make_exec_fixup`, `setup_exec_domains`
- Workspace resolution: `resolve_port_workspaces` (docker inspect for CONTAINER_WORKSPACE_FOLDER)
- GLOBAL metadata: `lace_plugin_opts`, `lace_port_users`, `lace_port_workspaces`
- SSH domains renamed from `lace:<port>` to `lace-mux:<port>`
- `setup_port_domains` now returns `port_users, port_containers` for GLOBAL storage

Config validation: `ls-fonts` parse check passed.

### Phase 2: Picker and wez-into

Plugin picker tab mode: switched from `mux_win:spawn_tab({ args = ssh_args })` to `mux_win:spawn_tab({ domain = { DomainName = "lace:" .. port } })`.

Picker also updates `lace_port_users` in GLOBAL at selection time.

Added `M.get_connection_info(key)` public API.

wez-into `do_connect`: replaced raw SSH spawn with `wezterm cli spawn --domain-name "lace:$port"`.

Removed `workspace_dir` resolution (now handled by ExecDomain fixup).

Updated cold-start fallback to `lace-mux:$port`.

Updated help text and dry-run output.

### Phase 3: Bypass Bindings

> NOTE(opus/split-pane-regression): The proposal specified `domain = "DefaultDomain"` directly in `act.SplitPane`.
> This is wrong: `domain` is not a valid SplitPane field.
> The correct syntax is `command = { domain = "DefaultDomain" }` (domain goes in the SpawnCommand).
> The `ls-fonts` parse check caught this immediately.

Added Alt+Shift+HJKL bindings with `command = { domain = "DefaultDomain" }`.

Validated via:

- `ls-fonts` parse check: passed
- `show-keys` diff: exactly 4 new SplitPane entries with DefaultDomain
- `copy_mode` diff: no changes (no regressions)
- `chezmoi apply`: deployed successfully

### Phase 4: Documentation

Added Connection Domain Architecture block comment to `plugin/init.lua` (lines 50-79).

Documents all three domain types, their purposes, and current status.

### Phase 5: End-to-End Testing

#### Bug Fix: wezterm.GLOBAL String Key Requirement

> NOTE(opus/split-pane-regression): ExecDomain fixup crashed with "can only index objects using string values".
> `wezterm.GLOBAL` tables only accept string keys, but port numbers were stored as numeric keys.
> Fix: `tostring(port)` for all GLOBAL table access.
> This was not documented in WezTerm's Lua API and was only discoverable at runtime.

#### Stale Domain Registry After Config Reload

> NOTE(opus/split-pane-regression): WezTerm's mux server retains domain registrations across config reloads.
> After renaming SSH domains from `lace:<port>` to `lace-mux:<port>`, the old `lace:<port>` SSH domains
> persisted in the mux server's registry, shadowing the new ExecDomains with the same name.
> SIGHUP to the mux server (PID) cleared stale state; the GUI respawned it with fresh config.
> This is a one-time deployment requirement: existing WezTerm instances need a mux server restart
> after deploying the domain rename.

#### Test Results (Post-Fix)

**ExecDomain spawn (lace container, port 22427):**
```
SOCKET=UNSET          # Confirms ExecDomain, not SSH mux
HOST=f73e84ead1d8     # In container
CWD=/workspaces/lace/main
USER=node
```

**Split pane inheritance (split from lace pane):**
```
SOCKET=UNSET          # Split also uses ExecDomain
HOST=f73e84ead1d8     # Same container as parent
CWD=/workspaces/lace/main
USER=node
```

**ExecDomain spawn (clauthier container, port 22426):**
```
SOCKET=UNSET
HOST=e7a6dbd82eb6     # Different container
CWD=/workspace/lace/main
USER=node
```

**Cross-container split isolation (split from clauthier pane):**
```
SOCKET=UNSET
HOST=e7a6dbd82eb6     # Stays in clauthier, not lace
CWD=/workspace/lace/main
```

**Config reload resilience:** All 5 panes survived config file touch + reload.

**Bypass bindings (show-keys output):**
```
{ key = 'H', mods = 'ALT', action = act.SplitPane{ command = { domain = 'DefaultDomain' }, ... } }
{ key = 'h', mods = 'ALT', action = act.SplitPane{ command = { domain = 'CurrentPaneDomain' }, ... } }
```
Both regular (`CurrentPaneDomain`) and bypass (`DefaultDomain`) bindings coexist correctly.

> NOTE(opus/split-pane-regression): Bypass bindings (Alt+Shift+HJKL opening host shell in container tab) require manual keyboard testing, which cannot be automated via `wezterm cli`.

**wez-into dry-run output:**
```
wezterm cli spawn --domain-name "lace:$port"
# Fallback (no mux): wezterm connect "lace-mux:$port" --workspace main
```

## Debugging Process

### Phase 1: Root Cause Investigation

Initial ExecDomain spawn returned SSH mux socket evidence (`WEZTERM_UNIX_SOCKET` set in pane).

`wezterm cli spawn --domain-name "lace-mux:22427"` returned "invalid domain name" listing only `lace:*` names.

This confirmed stale SSH domain registrations shadowing new ExecDomains.

### Phase 2: Pattern Analysis

- Stale domains: old `lace:<port>` SSH domains from pre-rename config
- New `lace-mux:<port>` SSH domains not visible in mux server registry
- New `lace:<port>` ExecDomains shadowed by old SSH domains of same name

### Phase 3: Hypothesis Tested

Hypothesis: SIGHUP to mux server clears stale domain state.

Result: mux server terminated; GUI respawned it with fresh config.

Post-restart spawn correctly used ExecDomain (SOCKET=UNSET).

Second issue: ExecDomain fixup Lua error "can only index objects using string values".

Hypothesis: `wezterm.GLOBAL` serializes tables with string-only keys.

Fix: `tostring(port)` for all GLOBAL table indexing.

Result: ExecDomain fixup works correctly.

### Phase 4: Fix Implemented

Two fixes applied:

1. SIGHUP mux server restart (one-time deployment step)
2. `tostring(port)` for all `wezterm.GLOBAL` table access (commit `2609c3c`)

## Changes Made

| File | Change |
|------|--------|
| `lace.wezterm/plugin/init.lua` | ExecDomain registration, GLOBAL metadata, SSH domain rename, string key fix |
| `bin/wez-into` | Switched to ExecDomain spawn, three-tier fallback chain, removed dead code |
| `dotfiles/dot_config/wezterm/wezterm.lua` | Updated split binding comments for ExecDomain context (bypass bindings deferred) |

## Commits

| Repo | Hash | Description |
|------|------|-------------|
| lace.wezterm | `6e694ae` | Phase 1: ExecDomain registration |
| lace.wezterm | `ae61d55` | Phase 2: Picker ExecDomain spawn |
| lace.wezterm | `8286def` | Phase 4: Connection domain docs |
| lace.wezterm | `2609c3c` | Fix: string keys for GLOBAL tables |
| lace/main | `c157a15` | Devlog/proposal status |
| lace/main | `529debe` | Phase 2: wez-into ExecDomain spawn |
| lace/main | `03e7966` | Fix: dead code removal, raw SSH fallback, BLUF |
| dotfiles | `c282fe5` | Updated split comments, bypass bindings deferred |

## Verification

**ExecDomain mechanism:** Verified via `WEZTERM_UNIX_SOCKET=UNSET` in spawned panes (5 panes tested across 2 containers).

**Split inheritance:** Splits from container panes land in the same container (verified hostname match, ExecDomain confirmation).

**Multi-container isolation:** Splits in lace tab stay in lace.

Splits in clauthier tab stay in clauthier.

**Config validation:**

- `ls-fonts` parse check: no errors on stderr
- `show-keys` diff: 8 SplitPane bindings (4 CurrentPaneDomain + 4 DefaultDomain)
- Config reload: all panes survived

**Remaining manual testing:**

- Picker tab creation flow requires GUI interaction
- `wez-into` from host shell (requires TTY)

## Deferred: Bypass Bindings (Alt+Shift+HJKL)

> NOTE(opus/split-pane-regression): Bypass bindings deferred to future work.
> WezTerm does not respect domain override in ExecDomain splits (4 approaches tested, all failed).
> Full investigation: `cdocs/reports/2026-03-20-bypass-binding-investigation.md`
> Follow-up RFP: `cdocs/proposals/2026-03-20-exec-domain-bypass-bindings.md`
> Bypass binding code removed from wezterm.lua (dotfiles commit `c282fe5`).
