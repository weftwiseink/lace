---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T12:30:00-08:00
task_list: lace/mount-plugin-workstream
type: report
state: live
status: final
tags: [status, lace, plugins, claude-code, workstream-overview]
---

# Mount-Enabled Plugin Workstream: Status Report

> BLUF: Four research reports have been completed, reviewed, and refined covering the lace plugin system state, claude devcontainer bundling, claude-tools integration, and agent situational awareness. A synthesis agent is currently writing the mid-level implementation proposal and executive summary. The workstream is on track, with Phase 3 (synthesis) in progress and Phases 4-6 (clarification, detailed proposals, final iteration) remaining.

## Context / Background

This workstream was initiated to extend the lace devcontainer wrapper with managed mounting capabilities and write a first plugin using this API for fluid Claude Code access within lace containers. The work spans four research threads that build on each other, culminating in a vetted implementation plan.

The workstream follows a structured pipeline: research reports -> reviews -> feedback application -> synthesis -> proposal -> detailed implementation plans, with user checkpoints for clarification between phases.

## Workstream Pipeline

| Phase | Description | Status |
|-------|-------------|--------|
| 1. Research Reports | Four technical reports | **Complete** |
| 2. Review & Refine | /review each report, apply feedback | **Complete** |
| 3. Synthesis | Mid-level proposal + executive summary | **In Progress** |
| 4. User Clarification | Surface ambiguities via AskUserQuestion | Pending |
| 5. Detailed Proposals | Implementation & test proposals with sequencing | Pending |
| 6. Final Iteration | Last clarification round + proposal refinement | Pending |

## Phase 1 & 2: Research Reports (Complete)

### Report 1: Lace Plugin System State
- **File**: `cdocs/reports/2026-02-05-lace-plugin-system-state.md`
- **Review**: `cdocs/reviews/2026-02-05-review-of-lace-plugin-system-state.md`
- **Key findings**:
  - All 7 implementation phases from the original proposal are fully implemented across 8 modules
  - 23 exported functions, 12 exported types across the API surface
  - 6 extension points identified for downstream work (ResolvedPlugin interface, PluginOptions, PluginSettings, generateExtendedConfig, resolve pipeline, ensurePlugin)
  - 8 known gaps documented (always-empty errors field, synchronous git ops, no version pinning, etc.)
  - Both RFPs (conditional loading, host setup) remain at request_for_proposal status
- **Review verdict**: Revise -> feedback applied (test count corrections, line reference fixes)

### Report 2: Claude Devcontainer Bundling
- **File**: `cdocs/reports/2026-02-05-claude-devcontainer-bundling.md`
- **Review**: `cdocs/reviews/2026-02-05-review-of-claude-devcontainer-bundling.md`
- **Key findings**:
  - Three coordinated mechanisms needed: devcontainer feature (`ghcr.io/anthropics/devcontainer-features/claude-code:1`), bind mount for `~/.claude/`, and env var forwarding
  - Recommends `customizations.lace.claude: true` as a dedicated field (Option A) over extending the git-repo plugin system
  - Runtime user detection via `remoteUser` / `containerUser` fields with configurable override
  - `generateExtendedConfig` needs 3 new merge targets: features, containerEnv, remoteEnv
  - OAuth relies entirely on `~/.claude/` bind mount (no env var for token forwarding)
  - macOS Keychain limitation means API key is the recommended auth path for macOS users
- **Review verdict**: Accept with revisions -> feedback applied (removed fabricated env var, added security threat, fixed env var semantics)

### Report 3: claude-tools Streamlining
- **File**: `cdocs/reports/2026-02-05-claude-tools-streamlining.md`
- **Review**: `cdocs/reviews/2026-02-05-review-of-claude-tools-streamlining.md`
- **Key findings**:
  - claude-tools provides 5 OCaml tools (`claude-ls`, `claude-cp`, `claude-mv`, `claude-rm`, `claude-clean`) with a planned 6th (`claude-search`)
  - Session portability's central challenge is path encoding: host `/var/home/mjr/code/weft/lace` encodes differently than container `/workspaces/lace`
  - Ghost directory support in claude-tools enables cross-context session copies without the source path existing
  - Symlink bridge (container encoding -> host encoding in `~/.claude/projects/`) is the recommended default
  - claude-tools does NOT fit the plugin abstraction (it's binaries, not a mountable repo) -- recommend postCreateCommand installation
  - Only macOS aarch64 binaries currently ship; Linux builds are missing
  - No additional mounts or env vars needed beyond what Report 2 covers
- **Review verdict**: Revise -> feedback applied (path encoding collision risk, reverse_project_path lossiness, claude-clean interaction)

### Report 4: Agent Situational Awareness
- **File**: `cdocs/reports/2026-02-05-agent-situational-awareness.md`
- **Review**: `cdocs/reviews/2026-02-05-review-of-agent-situational-awareness.md`
- **Key findings**:
  - Current CLAUDE.md is effectively empty (references nonexistent plugin rules file)
  - Four-layer solution: CLAUDE.md content, MCP server tools, environment markers, session portability mechanisms
  - CLAUDE.md content split into Tier A (implementable today, permanent facts) and Tier B (requires env markers first)
  - Three MCP tools designed: `lace_environment`, `lace_session_history`, `lace_worktrees`
  - 8 `LACE_*` environment variables proposed for injection via containerEnv
  - Session portability challenges cataloged (path encoding, MCP connections, stale paths, user identity)
  - 7 auto-detection patterns for agents to sense environment drift
- **Review verdict**: Accept with revisions -> feedback applied (heredoc quoting bug, MCP schema fix, bootstrapping problem separation)

## Phase 3: Synthesis (In Progress)

A background agent is currently:
1. Reading all 4 reviewed reports and the actual source code
2. Writing a mid-level implementation `/propose` at `cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md`
3. Self-reviewing and applying feedback
4. Writing an executive summary at `cdocs/reports/2026-02-05-mount-plugin-workstream-executive-summary.md`

The proposal will define:
- Managed plugin system extension architecture
- Claude access as the first managed plugin (vetting the API against a real use case)
- Implementation phases with success criteria
- Test plan

## Key Architectural Decisions Emerging

1. **Managed plugin concept**: Not all plugins are git repos. Claude access is a "managed plugin" that generates mounts, env vars, and feature references without cloning.
2. **Dedicated field over plugin reuse**: `customizations.lace.claude: true` rather than `"lace:claude": {}` in the plugins object.
3. **generateExtendedConfig as the integration point**: All new capabilities (features, containerEnv, remoteEnv) merge through the existing extended config generation.
4. **Symlink bridge for session portability**: Lightweight, automatic, no user action required.
5. **Layered agent awareness**: Start with env vars and CLAUDE.md (zero infrastructure), add MCP later.

## Risks and Open Items

| Risk | Severity | Mitigation |
|------|----------|------------|
| Feature injection may not work via extended config | Medium | Needs empirical testing with `devcontainer up` |
| macOS Keychain blocks OAuth forwarding | Medium | Document API key as recommended path for macOS |
| Linux binaries missing for claude-tools | Medium | File upstream issue; make installation optional |
| Path encoding collisions (theoretical) | Low | Inherent upstream limitation; document it |
| Field proliferation if more managed plugins added | Low | Revisit if a second managed integration arises |

## Artifacts Produced

| Type | Count | Location |
|------|-------|----------|
| Research reports | 4 | `cdocs/reports/2026-02-05-*.md` |
| Reviews | 4 | `cdocs/reviews/2026-02-05-*.md` |
| Devlog | 1 | `cdocs/devlogs/2026-02-05-lace-mount-plugin-workstream.md` |
| This status report | 1 | `cdocs/reports/2026-02-05-mount-plugin-workstream-status.md` |
| Proposal (in progress) | 1 | `cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md` |

## Next Steps

1. **Immediate**: Synthesis agent completes proposal and executive summary
2. **Next**: Review the proposal, surface clarification questions to user
3. **Then**: Break out detailed implementation & test proposals with sequencing
4. **Finally**: One more iteration round with user before implementation begins
