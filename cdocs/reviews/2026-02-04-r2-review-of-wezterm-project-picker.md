---
review_of: cdocs/proposals/2026-02-04-wezterm-project-picker.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T21:30:00-08:00
type: review
state: archived
status: done
tags: [rereview_agent, architecture, cli, wezterm, configuration_consolidation]
---

# Review Round 2: WezTerm Project Picker Feature

## Summary Assessment

The revised proposal addresses both blocking issues from round 1: configuration is now consolidated in `settings.json` under `wezterm.projects`, and SSH domain registration is explicitly documented with a multi-call `apply_to_config` approach. The proposal is now technically complete and internally consistent. One minor syntax error in the code example should be fixed, but overall the proposal is ready for implementation.

**Verdict: Accept** with one minor fix required.

## Prior Action Items Status

| # | Action Item | Status |
|---|-------------|--------|
| 1 | [blocking] Consolidate configuration in settings.json | **Addressed** - Now uses `settings.json` under `wezterm.projects` |
| 2 | [blocking] Clarify SSH domain registration | **Addressed** - Added "SSH Domain Registration" section with multi-call approach |
| 3 | [non-blocking] Specify wezterm picker behavior for stopped containers | **Addressed** - Added clarification that picker attempts connection, SSH failure surfaces the issue |
| 4 | [non-blocking] Document jq dependency | **Addressed** - CLI now includes installation guidance for jq |
| 5 | [non-blocking] Add edge case tests | Not addressed - acceptable, can be added during implementation |
| 6 | [non-blocking] Address picker latency | Not addressed - acceptable as a known limitation |

## Section-by-Section Findings

### BLUF and Scope Updates

**Finding**: The BLUF correctly reflects the new consolidated approach with `settings.json`. The scope bullet point is updated appropriately.

**Status**: Sound.

### Design Decision D1 (Project Registry Location)

**Finding**: Updated to reference `settings.json` under `wezterm.projects` with clear rationale about consolidation and avoiding sprawl.

**Status**: Sound. The revision directly addresses the round 1 blocking issue.

### Project Registry Format

**Finding**: The example JSON now shows both `plugins` (from Lace Plugins System) and `wezterm.projects` sections in the same file. This clearly demonstrates the consolidated approach. The schema correctly removes the `sshDomain` field and notes that the project key serves as the domain name.

**Status**: Sound.

### SSH Domain Registration Section (New)

**Finding**: This new section addresses the round 1 blocking issue about how domains get registered. The Lua code example demonstrates:
1. Loading `settings.json`
2. Iterating over `wezterm.projects`
3. Calling `apply_to_config` for each project

**Minor Issue**: Line 224 has a stray triple-backtick that appears to be a formatting error. The code block ends at line 223 but there's an extra closing fence.

**Status**: Sound overall. Minor formatting fix needed.

### CLI Implementation

**Finding**: Updated to read from `settings.json` instead of `projects.json`. The helper functions `get_projects()` and `get_project_field()` correctly navigate the `wezterm.projects` path. Installation guidance for jq is now included in the error message.

**Status**: Sound.

### WezTerm Plugin Integration

**Finding**: The Lua code correctly reads from `settings.json` and accesses `settings.wezterm.projects`. The stopped container behavior is now explicitly documented: "The wezterm picker always attempts connection on selection. If the container is stopped, the SSH connection will fail and wezterm displays an error."

**Status**: Sound.

### Q9: Relationship to Lace Plugins System (New)

**Finding**: This new resolution clearly explains the complementary relationship: `plugins` handles mount configuration, `wezterm.projects` handles terminal connection configuration.

**Status**: Sound.

### Test Plan

**Finding**: Updated to reference `settings.json` with `wezterm.projects`. Edge case tests were not added but this is acceptable for round 2.

**Status**: Acceptable.

## Verdict

**Accept** - All blocking issues from round 1 have been addressed. The proposal now has a clear, consolidated configuration approach that aligns with the Lace Plugins System. SSH domain registration is explicitly documented. The proposal is ready for implementation.

## Action Items

1. **[minor]** Fix formatting error on line 224 - remove stray triple-backtick after the SSH Domain Registration code block.

2. **[future/optional]** Add edge case tests during implementation for: empty config, missing prerequisites, SSH timeout scenarios.

3. **[future/optional]** Consider async status probing if picker latency becomes noticeable with many projects (2-5 projects is likely fine).
