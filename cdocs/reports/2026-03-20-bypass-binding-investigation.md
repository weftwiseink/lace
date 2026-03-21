---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-20T19:00:00-07:00
task_list: wezterm/split-pane-regression
type: report
state: live
status: done
tags: [wezterm, lace.wezterm, regression, investigation]
---

# Bypass Binding Investigation: Domain Override in ExecDomain Splits

> BLUF: WezTerm does not respect domain override when splitting from an ExecDomain pane.
> Four approaches were tested: `act.SplitPane` with three domain variants and `pane:split()` mux API.
> All produce container splits instead of host splits.
> The ExecDomain fixup always runs on child panes, overriding whatever domain was requested.
> The most viable workaround is modifying the ExecDomain fixup function to detect a bypass signal and skip SSH wrapping.

## Context

Container-aware split panes were implemented via ExecDomains (`lace:<port>`), where each domain's fixup wraps spawned commands with SSH into the container.
Splits inherit the ExecDomain via `CurrentPaneDomain`, so Alt+HJKL splits in container tabs correctly land in the container.

The complementary feature: Alt+Shift+HJKL "bypass" bindings should open a host shell split even inside a container tab.
This requires overriding the domain on a split to force the host domain instead of inheriting the ExecDomain.

## Environment

- WezTerm config uses `config.unix_domains = { { name = "unix" } }`
- All local panes are on the `unix` domain (not `local`)
- `config.default_gui_startup_args = { "connect", "unix" }` starts GUI via unix mux
- The built-in `local` domain exists but does not integrate with the unix mux GUI

## Approaches Tested

### 1. `act.SplitPane` with `command = { domain = "DefaultDomain" }`

The proposal's original approach.
Config validation passed, `show-keys` showed correct binding with `DefaultDomain`.

**Result:** Split opened container shell, not host shell.
The ExecDomain fixup ran on the child pane regardless.

### 2. `act.SplitPane` with `command = { domain = { DomainName = "local" } }`

Attempted to target the built-in `local` domain directly.

**Result:** Pane space was allocated but rendered transparent/bugged.
The `local` domain does not integrate with the unix mux GUI session.
WezTerm restart required to recover.

### 3. `act.SplitPane` with `command = { domain = { DomainName = "unix" } }`

Correct domain name for this setup.
Config validation passed, `show-keys` showed correct binding.

**Result:** Split opened container shell.
Same behavior as approach 1: the ExecDomain fixup still ran.

### 4. `pane:split()` mux API via `wezterm.action_callback`

Bypassed the key assignment layer entirely, using the mux-level API directly:

```lua
wezterm.action_callback(function(_, pane)
  pane:split({ direction = "Right", size = 0.5, domain = { DomainName = "unix" } })
end)
```

**Result:** Split opened container shell.
The mux API also does not override the ExecDomain on child panes.

## Analysis

Both the key assignment layer (`act.SplitPane`) and the mux API (`pane:split()`) ignore the domain parameter when splitting from an ExecDomain pane.
The split always uses `CurrentPaneDomain` regardless of what domain is specified.

This appears to be a WezTerm behavior where ExecDomain identity is always propagated to child panes.
WezTerm documentation for both `SplitPane.command.domain` and `pane:split({ domain = ... })` states domain override should work.
There is no documented limitation or known issue for domain override in ExecDomain splits.

The core mechanism: when a pane is in an ExecDomain, the ExecDomain fixup function runs on every spawn (including splits).
The fixup replaces `cmd.args` with SSH args, regardless of what domain was requested for the child pane.
The domain override in `SplitPane`/`pane:split()` may be setting the domain correctly, but the fixup still executes because the parent pane's ExecDomain context propagates.

## Viable Workarounds

### Option A: ExecDomain fixup bypass signal (recommended)

Modify the ExecDomain fixup function to detect a signal and skip SSH wrapping.
The bypass binding would set an environment variable or command arg that the fixup checks:

```lua
local function make_exec_fixup(port, default_user)
  return function(cmd)
    -- Check for bypass signal
    if cmd.set_environment_variables and cmd.set_environment_variables.LACE_BYPASS then
      cmd.set_environment_variables.LACE_BYPASS = nil
      return cmd  -- Skip SSH wrapping
    end
    -- Normal ExecDomain fixup: wrap with SSH
    ...
  end
end
```

The bypass binding would use:

```lua
act.SplitPane({
  direction = "Right",
  size = { Percent = 50 },
  command = { set_environment_variables = { LACE_BYPASS = "1" } },
})
```

This works within the existing ExecDomain mechanism: the fixup always runs, but it can choose to no-op.

### Option B: Spawn+move workaround

Use `wezterm.action_callback` to spawn a pane on the `unix` domain (as a new tab), then move it into the current tab as a split.
More complex and may not be supported by the WezTerm mux API.

### Option C: File a WezTerm upstream issue

Report that `SplitPane` and `pane:split()` do not respect domain override when the current pane is in an ExecDomain.
If this is unintentional behavior, an upstream fix would resolve the issue cleanly.

### Option D: Separate key table for host splits

Use a different mechanism entirely: `SpawnCommandInNewTab` with `unix` domain (opens a new tab instead of a split).
Functional but changes the UX (new tab vs split).

## Recommendation

Option A (fixup bypass signal) is the most pragmatic.
It works entirely within the plugin's control, requires no WezTerm behavioral changes, and preserves the split UX.
Filing an upstream issue (Option C) is worth doing in parallel as the behavior may be unintentional.

## References

- Implementation devlog: `cdocs/devlogs/2026-03-20-container-aware-split-panes-implementation.md`
- Proposal: `cdocs/proposals/2026-03-20-container-aware-split-panes.md`
- ExecDomain source: `~/code/weft/lace.wezterm/plugin/init.lua` (lines 230-243, `make_exec_fixup`)
