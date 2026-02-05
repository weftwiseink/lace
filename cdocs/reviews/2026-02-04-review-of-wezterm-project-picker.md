---
review_of: cdocs/proposals/2026-02-04-wezterm-project-picker.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T21:00:00-08:00
type: review
state: live
status: done
tags: [fresh_agent, architecture, cli, wezterm, test_plan]
---

# Review: WezTerm Project Picker Feature

## Summary Assessment

This proposal transforms an incomplete RFP into a comprehensive specification for a project picker with two entry points: a wezterm-native InputSelector UI (Leader+P) and a CLI command (`wez-lace-into`). The design is well-structured with clear decisions, explicit rationales, and a practical implementation approach. The key concern is duplication with the recently-approved Lace Plugins System which defines `~/.config/lace/settings.json`; introducing a separate `projects.json` creates configuration sprawl. Otherwise, the proposal is technically sound and ready for implementation with minor revisions.

**Verdict: Revise** - Consolidate with the Lace Plugins System settings file and clarify SSH domain registration.

## Section-by-Section Findings

### BLUF and Objective

**Finding**: The BLUF effectively summarizes the dual entry points and registry-based approach. The objective clearly states the user need (avoiding keybinding collisions, providing CLI alternative).

**Status**: Sound.

### Design Decisions (D1-D6)

**Finding (D1 - blocking)**: The proposal introduces `~/.config/lace/projects.json` for project registration. However, the Lace Plugins System (approved, implementation in progress) already defines `~/.config/lace/settings.json` as the consolidated user configuration location. Having both `settings.json` and `projects.json` fragments user configuration.

**Recommendation**: Extend `settings.json` with a `projects` key rather than creating a separate file. This maintains the "single source of truth" principle established in the plugins system.

**Finding (D2)**: The explicit registration approach is appropriate. Automatic discovery via filesystem scanning would be slow and unbounded.

**Status**: Sound.

**Finding (D5)**: The connection flow for stopped containers is underspecified. The wezterm picker shows a "toast notification offering to start" but cannot actually start containers (no CLI mechanism from within Lua). The CLI handles this correctly with interactive prompting.

**Status**: Non-blocking, but the wezterm picker behavior should be clarified. Consider always attempting connection and letting SSH failure surface the issue.

### Project Registry Format (Specification)

**Finding (blocking)**: The schema includes `sshDomain` and `sshKey` fields, but it is unclear how SSH domains get registered in wezterm.lua. The picker assumes domains already exist in the wezterm config. The proposal should clarify whether:
- Users must manually add each project's SSH domain to wezterm.lua, or
- The picker dynamically creates domains, or
- The lace-plugin's `apply_to_config` is called multiple times (once per project)

The current lace-plugin is called once in wezterm.lua with specific options. Multi-project support requires either multiple `apply_to_config` calls or a new mechanism.

**Recommendation**: Add a section explaining SSH domain registration. One option: iterate over projects.json in wezterm.lua and call `apply_to_config` for each, or have the picker use `wezterm connect` with inline SSH options rather than named domains.

**Finding (non-blocking)**: The `sshKey` field duplicates information that may be in the wezterm SSH domain config. Consider whether this field is needed or if it can be inferred from the domain.

### CLI Command Implementation

**Finding**: The bash implementation sketch is thorough with proper error handling, fzf/select fallback, container status detection, and known_hosts management. The implementation reuses patterns from `bin/open-lace-workspace`.

**Status**: Sound.

**Finding (non-blocking)**: The CLI depends on `jq` for JSON parsing. While jq is common, it is not always installed. Consider adding installation guidance or a fallback parser.

### WezTerm Plugin Integration (Lua Code)

**Finding**: The Lua implementation has a potential performance issue. The `setup_project_picker` function probes each project's SSH port synchronously when the picker opens. With many projects, this could cause noticeable delay.

**Recommendation (non-blocking)**: Consider either:
- Caching status with a short TTL
- Showing the picker immediately with "[?]" status, then updating asynchronously
- Accepting the latency as acceptable for typical project counts (2-5)

**Finding**: The picker uses `wezterm.run_child_process` for SSH probing with `BatchMode=yes`. However, `BatchMode` may cause issues if the SSH key has a passphrase. The CLI uses the same approach but interacts with the user directly.

**Status**: Acceptable. The current lace devcontainer workflow assumes passphraseless keys.

### Test Plan

**Finding**: The test plan is adequate for unit and integration testing but lacks edge case coverage:
- What happens when projects.json is empty?
- What happens when wezterm is not installed (for CLI)?
- What happens when SSH probe times out (slow network)?

**Recommendation (non-blocking)**: Add edge case tests for empty config, missing prerequisites, and timeout scenarios.

### Implementation Phases

**Finding**: The phases are logical (registry -> picker UI -> CLI -> polish). The success criteria are measurable.

**Status**: Sound.

### Relationship to Lace Plugins System

**Finding (blocking)**: The proposal references `cdocs/proposals/2026-02-04-lace-plugins-system.md` in Related Documents but does not explain how project picker projects relate to lace plugins. Both involve:
- User configuration in `~/.config/lace/`
- Per-project SSH/connection settings
- Container detection

This overlap should be reconciled. Specifically:
- Should wezterm-specific project configuration be part of `settings.json` plugins, or a separate `projects` section?
- If a project declares lace plugins, should it automatically appear in the project picker?

**Recommendation**: Add a design decision explaining the relationship. Suggested approach: add `wezterm` section to `settings.json` for picker-specific overrides while deriving the project list from either declared plugins or explicit `wezterm.projects` entries.

## Verdict

**Revise** - The proposal is technically sound and well-specified, but requires consolidation with the Lace Plugins System to avoid configuration fragmentation. The SSH domain registration mechanism also needs clarification.

## Action Items

1. **[blocking]** Consolidate configuration: Replace `projects.json` with a `wezterm` or `projects` section in `~/.config/lace/settings.json`. Align with the Lace Plugins System pattern.

2. **[blocking]** Clarify SSH domain registration: Add a section explaining how SSH domains for each project are registered in wezterm.lua. Either document multi-call `apply_to_config` or propose a different mechanism.

3. **[non-blocking]** Specify wezterm picker behavior for stopped containers: Clarify that the picker will attempt connection anyway (letting SSH failure surface the issue) rather than attempting to start containers from Lua.

4. **[non-blocking]** Document jq dependency: Add jq to prerequisites and suggest installation methods (or consider a fallback for simple JSON extraction).

5. **[non-blocking]** Add edge case tests: Extend the test plan to cover empty config, missing wezterm, and SSH timeout scenarios.

6. **[non-blocking]** Address potential picker latency: Note that SSH probing is synchronous and may cause brief delay with many projects. Accept as a known limitation or suggest async approach for future optimization.
