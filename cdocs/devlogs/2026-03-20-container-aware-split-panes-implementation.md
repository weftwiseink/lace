---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-20T15:00:00-07:00
task_list: wezterm/split-pane-regression
type: devlog
state: live
status: wip
tags: [wezterm, lace.wezterm, regression, implementation]
---

# Container-Aware Split Panes Implementation

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

(updated as work proceeds)

### Phase 2: Picker and wez-into

(updated as work proceeds)

### Phase 3: Bypass Bindings

(updated as work proceeds)

### Phase 4: Documentation

(updated as work proceeds)

### Phase 5: End-to-End Testing

(updated as work proceeds)

## Changes Made

| File | Change |
|------|--------|
| (updated as work proceeds) | |

## Verification

(updated with evidence as phases complete)
