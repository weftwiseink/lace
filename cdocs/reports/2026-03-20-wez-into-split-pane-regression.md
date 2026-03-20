---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-20T12:00:00-07:00
task_list: wezterm/split-pane-regression
type: report
state: live
status: wip
tags: [wezterm, regression, architecture]
---

# Split Pane Regression in Lace Container Tabs

> BLUF: Alt-H/J/K/L split panes in lace container tabs open local host shells instead of container shells.
> This is a consequence of switching from workspace mode (SSH domain-attached panes) to tab mode (raw SSH subprocess panes) in commit `0477744` (Feb 28, 2026).
> The fix requires container-aware split logic: detect lace tabs at split time and spawn the new pane with the same SSH connection.

## Context

The lace.wezterm plugin supports two connection modes for devcontainer tabs:

- **Workspace mode** (default in plugin, not currently used): `SwitchToWorkspace` with `domain = { DomainName = "lace:<port>" }`.
  Panes are attached to the WezTerm SSH domain.
  Splits inherit the domain and create new remote panes inside the container.
- **Tab mode** (currently active): `mux_win:spawn_tab({ args = ssh_args })` with direct SSH subprocess.
  Panes are attached to the local unix mux domain.
  Splits inherit the local domain and create host shells.

Tab mode was adopted to avoid SSH domain hot-reload reliability issues (key paths not picked up after config changes).
The `wez-into` script uses the same direct-SSH pattern via `wezterm cli spawn -- ssh ...`.

## Key Findings

### The regression mechanism

The split pane bindings in `wezterm.lua:302-306` are plain `act.SplitPane` with no domain or command override:

```lua
{ key = "j", mods = "ALT", action = act.SplitPane({ direction = "Down", size = { Percent = 50 } }) },
```

`SplitPane` with no `command` field inherits `CurrentPaneDomain`.
In tab mode, the current pane's domain is the local unix mux, not `lace:<port>`.
The new split pane opens the host's default shell (nushell), not a container shell.

### What worked before

Before commit `0477744`, the plugin defaulted to workspace mode.
In workspace mode, panes attach to the `lace:<port>` SSH domain (with `multiplexing = "WezTerm"`).
`SplitPane` on an SSH domain pane creates a new remote pane on the container's mux server.
This is the WezTerm-native way to get container splits, but it was abandoned due to SSH domain config reload bugs.

### Two tab creation paths

Both paths produce the same problem:

1. **Plugin picker** (Leader+W): `mux_win:spawn_tab({ args = ssh_args })`, sets tab title via `new_tab:set_title(project.name)`.
2. **wez-into script** (CLI): `wezterm cli spawn -- ssh ...`, sets tab title via `wezterm cli set-tab-title`.

Both create local-domain panes running SSH as a subprocess.
Neither stores connection metadata that split logic could use.

### Available context at split time

When Alt-J is pressed in a lace tab, these signals are available:

| Signal | Source | Reliability |
|--------|--------|-------------|
| Tab title | `tab:get_title()` | High: set by both plugin and wez-into |
| Discovery cache | `wezterm.GLOBAL.lace_discovery_cache` | Medium: only populated on picker open |
| Pane foreground process | `pane:get_foreground_process_name()` | Low: shows innermost process, not SSH |
| Pane user vars | `pane:get_user_vars()` | Not currently set by either path |
| SSH domain config | `config.ssh_domains` | Always available: port range pre-registered |

## Relevant Sources

### Repositories

| Repo | Path | Role |
|------|------|------|
| lace (this repo) | `bin/wez-into` | CLI tab creation via direct SSH |
| lace.wezterm | `~/code/weft/lace.wezterm/plugin/init.lua` | WezTerm plugin: picker, domains, tab title |
| dotfiles | `~/code/personal/dotfiles/dot_config/wezterm/wezterm.lua` | WezTerm config: keybindings, split logic |

### Prior CDocs

| Document | Relevance |
|----------|-----------|
| `cdocs/reports/2026-02-28-tab-oriented-wezterm-integration.md` | Explains the workspace-vs-tab tradeoff. Split inheritance noted as known gap. |
| `cdocs/reports/2026-02-26-wezterm-connectivity-mechanism-investigation.md` | Full SSH+mux connectivity chain analysis. |
| `cdocs/reports/2026-03-07-wezterm-pane-interaction-skill.md` | Pane metadata analysis. Discusses split-pane as MCP tool. |

### WezTerm APIs in use

- **`act.SplitPane({ direction, size, command?, domain? })`**: Creates a split pane.
  Without `command`, inherits `CurrentPaneDomain`.
  With `command = { args = {...} }`, runs specific program in the new pane.
- **`mux_win:spawn_tab({ args?, domain? })`**: Creates a new tab (Lua mux API).
- **`wezterm.action_callback(fn)`**: Wraps a Lua function as a key action.
  Receives `(window, pane)`.
  Errors only surface at keypress time, not config load.
- **`pane:get_user_vars()`**: Returns table of OSC 1337-set user variables.
- **`tab:get_title()` / `tab:set_title()`**: Tab title get/set.
- **`wezterm.GLOBAL`**: Process-scoped global state, persists across config reloads.

## Fix Approaches

### A: action_callback with discovery cache lookup

Replace plain `act.SplitPane` with `action_callback` that checks tab title against `wezterm.GLOBAL.lace_discovery_cache` (reverse lookup: name -> port), reconstructs SSH args, and passes them as `command` to `SplitPane`.

Pros: No changes to wez-into or plugin tab creation.
Cons: Cache only populated on picker open; wez-into tabs may not be in cache.

### B: Store connection info in GLOBAL at tab creation time

Both plugin and wez-into store `{ port, user, ssh_key }` in `wezterm.GLOBAL.lace_tab_connections[tab_title]` when creating tabs.
Split callback looks up by tab title.

Pros: Reliable for both paths.
Cons: wez-into needs a way to write to GLOBAL (possible via `wezterm cli` user-var IPC).

### C: Pane user variables via OSC 1337

Set `LACE_PORT` and `LACE_USER` as pane user vars from within the SSH session.
Split callback reads source pane's user vars and reconstructs SSH args.

Pros: Per-pane (not per-tab), works even if tab title changes.
Cons: Requires modifying the SSH command or container shell init.

### D: Populate discovery cache at config load time

Extend `setup_port_domains` to also query project names and populate `lace_discovery_cache` during config evaluation (not just picker open).
Split callback then always has cache available.

Pros: No wez-into changes needed. Cache always fresh at config load.
Cons: Adds Docker queries to config evaluation (already happens for user resolution). Cache goes stale between reloads.

## Recommendation

Approach B+D combined: store connection info in GLOBAL at plugin tab creation, populate discovery cache at config load (for wez-into tabs), and export a split helper from the plugin.
The split helper falls back through: GLOBAL tab info -> discovery cache -> plain local split.
