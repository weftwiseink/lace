---
first_authored:
  by: "@claude-opus-4-6-20250515"
  at: 2026-03-20T19:00:00-07:00
task_list: wezterm/split-pane-regression
type: proposal
state: deferred
status: request_for_proposal
tags: [wezterm, lace.wezterm, future_work]
---

# ExecDomain Bypass Bindings for Host Shell Splits

> BLUF: Alt+Shift+HJKL should open host shell splits in container tabs, but WezTerm does not respect domain override in ExecDomain panes.
> The recommended approach is a fixup bypass signal: the ExecDomain fixup checks for a marker env var and skips SSH wrapping when present.
> Deferred as non-blocking: the core container-aware split feature works without bypass bindings.

## Problem

When a pane is in an ExecDomain (`lace:<port>`), all splits inherit the ExecDomain and run its fixup.
Neither `act.SplitPane` nor `pane:split()` domain override parameters are respected.
See: `cdocs/reports/2026-03-20-bypass-binding-investigation.md`

## Proposed Approach

Modify `make_exec_fixup` in `lace.wezterm/plugin/init.lua` to detect a bypass signal:

```lua
local function make_exec_fixup(port, default_user)
  return function(cmd)
    if cmd.set_environment_variables and cmd.set_environment_variables.LACE_BYPASS then
      cmd.set_environment_variables.LACE_BYPASS = nil
      return cmd
    end
    -- Normal SSH wrapping...
  end
end
```

Bypass bindings in `wezterm.lua`:

```lua
{ key = "l", mods = "ALT|SHIFT", action = act.SplitPane({
  direction = "Right", size = { Percent = 50 },
  command = { set_environment_variables = { LACE_BYPASS = "1" } },
}) },
```

## Open Questions

1. Does `set_environment_variables` in `SpawnCommand` propagate to the ExecDomain fixup's `cmd` table?
   Needs verification: if not, an alternative signal mechanism is needed.
2. Should this be a plugin-level feature (bypass bindings registered by `apply_to_config`) or a user config concern?
3. Worth filing a WezTerm upstream issue for domain override not being respected in ExecDomain splits?

## Scope

- Plugin change: ~10 lines in `make_exec_fixup`
- Config change: 4 bypass binding entries in `wezterm.lua`
- Testing: verify bypass opens nushell on host, not container shell

## References

- Investigation report: `cdocs/reports/2026-03-20-bypass-binding-investigation.md`
- Parent proposal: `cdocs/proposals/2026-03-20-container-aware-split-panes.md`
