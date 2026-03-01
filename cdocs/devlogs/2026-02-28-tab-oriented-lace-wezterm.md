---
first_authored:
  by: "@claude-opus-4-6"
  at: "2026-02-28T19:00:00-06:00"
task_list: lace/wezterm-tab-mode
type: devlog
state: live
status: review_ready
tags: [wezterm, lace.wezterm, implementation]
---

# Tab-Oriented lace.wezterm Implementation: Devlog

## Objective

Implement the accepted proposal at `cdocs/proposals/2026-02-28-tab-oriented-lace-wezterm.md`. Add `connection_mode = "tab"` to the lace.wezterm plugin, integrate `format-tab-title` into the user's wezterm config, and update the `wez-into` CLI to create tabs instead of windows.

## Plan

Following the proposal's three implementation phases:

1. **Phase 1: Plugin tab mode with title support** — Modify `plugin/init.lua` to add `connection_mode` option, branch picker callback, add duplicate detection, populate `wezterm.GLOBAL.lace_discovery_cache`, expose `M.format_tab_title()`, remove dead `update-status` handler.
2. **Phase 2: User config integration** — Add `format-tab-title` handler to dotfiles wezterm config calling the plugin helper.
3. **Phase 3: CLI update** — Modify `wez-into` `do_connect` to use `wezterm cli spawn` with fallback.

## Testing Approach

Live system validation against the running WezTerm instance:
- WezTerm config parse validation via `ls-fonts` stderr check
- Key table diff (before/after) to verify bindings aren't silently dropped
- `wezterm cli list` to confirm the mux is healthy after changes
- Bash syntax check on `wez-into`
- Dry-run output verification for CLI changes

## Implementation Notes

### Review-driven revisions before implementation

The proposal went through a subagent review round that identified two blocking issues:

1. **`mux-tab-added` does not exist** in WezTerm's event API. Replaced with `format-tab-title` handler that resolves project names from `wezterm.GLOBAL.lace_discovery_cache` at render time. This is simpler and more reliable — no need to intercept tab creation events.

2. **Module-level discovery cache is wiped on config reload.** Changed to `wezterm.GLOBAL.lace_discovery_cache`, consistent with existing `wezterm.GLOBAL.lace_picker_registered` pattern.

Additional non-blocking improvements incorporated:
- `format-tab-title` exposed as a helper function (`M.format_tab_title()`) rather than registered directly by the plugin, avoiding WezTerm's single-handler-per-event constraint.
- Removed the plugin's dead `update-status` handler (conflicted with user's handler; user's always won due to load order).
- CLI preserves `XKB_LOG_LEVEL`, PATH check, and dry-run ordering from the original `do_connect`.
- Cold-start fallback targets `--workspace main` explicitly.

### Deviation: `enable_status_bar` option removed

The proposal didn't explicitly call for removing the `enable_status_bar` default, but since we removed the handler it guarded, keeping the option would be misleading dead config. Removed it cleanly.

## Changes Made

| File | Description |
|------|-------------|
| `lace.wezterm/plugin/init.lua` | Add `connection_mode` option, tab/workspace branching in picker, duplicate tab detection, discovery cache in `wezterm.GLOBAL`, `M.format_tab_title()` helper, remove dead `update-status` handler |
| `dotfiles/dot_config/wezterm/wezterm.lua` | Set `connection_mode = "tab"`, add `format-tab-title` handler calling `lace_plugin.format_tab_title()` |
| `bin/wez-into` | Replace `wezterm connect` with `wezterm cli spawn --domain-name`, fallback to `wezterm connect --workspace main`, update dry-run output and help text |

## Verification

### Config Parse Check

```
$ wezterm --config-file dot_config/wezterm/wezterm.lua ls-fonts 2>/tmp/wez_stderr.txt 1>/dev/null
$ grep ERROR /tmp/wez_stderr.txt
(no output — config parsed OK)
```

### Key Binding Diff (before/after)

```
$ diff /tmp/wez_copy_mode_before.lua /tmp/wez_copy_mode_after.lua
(no diff — copy mode bindings unchanged)

$ diff /tmp/wez_keys_before.lua /tmp/wez_keys_after.lua
(no diff — main key bindings unchanged)
```

### Mux Health Check (post-deploy)

```
$ wezterm cli list
WINID TABID PANEID WORKSPACE SIZE   TITLE         CWD
    0     0      0 main      119x83 ⠐ Claude Code file://aurora/home/mjr/code/weft/lace/main
    0     0      2 main      119x83 ✳ Claude Code file://aurora/home/mjr/code/weft/lace/main
```

### WezTerm Log (post hot-reload)

```
$ tail -20 "$XDG_RUNTIME_DIR/wezterm/log" | grep -i error
(no output — no errors)
```

### Deployed Config Match

```
$ diff dot_config/wezterm/wezterm.lua ~/.config/wezterm/wezterm.lua
(no diff — deployed config matches source)
```

### CLI Syntax & Dry-Run

```
$ bash -n bin/wez-into
(exit 0 — syntax OK)

$ wez-into --start --dry-run lace
wez-into: starting lace via lace up --workspace-folder /var/home/mjr/code/weft/lace/main ...
lace up --workspace-folder /var/home/mjr/code/weft/lace/main
# then: wezterm cli spawn --domain-name lace:<port>
```

### Commits

1. `2ec8c78` (lace.wezterm) — `feat: add tab-oriented connection mode`
2. `0477744` (dotfiles) — `feat(wezterm): enable tab-oriented lace connection mode`
3. `697258a` (lace/main) — `feat(wez-into): use tab-oriented connection via wezterm cli spawn`

### Not Yet Verified (requires running devcontainer)

- Picker creating tabs instead of workspaces (container is stopped)
- Duplicate tab detection activating existing tab
- Tab title showing project name instead of pane title
- Tab title surviving OSC title changes from Claude Code TUI

These require a running devcontainer. The config infrastructure is validated; runtime behavior testing is deferred to next interactive session.
