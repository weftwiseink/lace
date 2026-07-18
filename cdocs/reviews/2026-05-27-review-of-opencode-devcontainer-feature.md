---
review_of: cdocs/proposals/2026-05-27-opencode-devcontainer-feature.md
first_authored:
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:41:17.000Z
task_list: lace/opencode-devcontainer-feature/review
type: review
state: live
status: done
tags:
  - fresh_agent
  - opencode
  - devcontainer_features
  - architecture
guid: pMg5e5ofJB3M8
---

# Review: OpenCode Devcontainer Feature

## Summary Assessment

The proposal defines a new lace-aware `opencode` devcontainer feature that installs the OpenCode CLI and mounts the host state OpenCode needs for auth, global config, cache reuse, and possible session continuity. The proposal is accurate against the current OpenCode docs and aligns well with the existing `devcontainers/features/src/claude-code/` feature pattern while avoiding overbuilt session-bridge behavior. The main risks are already identified and deferred to empirical validation rather than solved speculatively. Verdict: **Accept**.

## Section-by-Section Findings

### BLUF and Objective

Clear and appropriately scoped. The BLUF correctly distinguishes OpenCode's XDG-style state layout from Claude Code's `~/.claude` and `~/.claude.json` mounts. The objective is implementation-sized: install the CLI, expose lace mounts, document risk, and validate behavior before adding bridge logic. No blocking issues.

### Background

The OpenCode documentation claims are accurate. Current docs state provider credentials from `/connect` are stored in `~/.local/share/opencode/auth.json`, logs and app/project/session data live under `~/.local/share/opencode/`, global config lives at `~/.config/opencode/opencode.json`, global plugins/agents/commands/skills/tools/themes live under plural subdirectories of `~/.config/opencode/`, and npm plugin dependencies are cached under `~/.cache/opencode/node_modules/`. The proposal also correctly separates project-local `opencode.json` and `.opencode/` from host-home state. No blocking issues.

**[non-blocking]** Line 36 says "global `.opencode` directories" live under `~/.config/opencode/`. The underlying path choice is correct, but the wording could be tightened in implementation docs to say "global OpenCode directories" or "global `agents/`, `commands/`, `plugins/`, `skills/`, `tools/`, and `themes/` directories" because the docs reserve `.opencode/` for project-local directories.

### Proposed Solution

The proposed `devcontainers/features/src/opencode/` shape matches the existing `claude-code` feature: a feature manifest with a `version` option, `ghcr.io/devcontainers/features/node:1` in `dependsOn`, npm-based global installation, lace mount declarations under `customizations.lace.mounts`, and an install script that creates state directories for the resolved remote user. `npm view opencode-ai` confirms the npm package exists and exposes the `opencode` binary, so the proposed first install path is sound.

The three mount categories are sensible. Keeping config, data, and cache separate gives users an escape hatch for the most sensitive category (`data`) without losing lower-risk cache reuse or global configuration. No blocking issues.

### Candidate Feature Metadata

The candidate metadata follows the `claude-code` metadata pattern closely, including `/home/${_REMOTE_USER}` target templates and `recommendedSource` values. The proposal also calls out the root-user path caveat, which matches the existing `claude-code/install.sh` behavior where metadata uses `/home/${_REMOTE_USER}` while the install script special-cases `/root`. No blocking issues.

**[non-blocking]** When implementing, include `documentationURL` for parity with `claude-code/devcontainer-feature.json`. This is not necessary for design acceptance, but it keeps published feature metadata consistent.

### Important Design Decisions

The state-category split, project-local configuration boundary, and "no session bridge first" decision are all appropriate. The proposal correctly treats session continuity as an empirical question because OpenCode's documented `project/` storage format may or may not be portable across host/container path differences. The choice to avoid global config mutation is also important because mounted `~/.config/opencode` can contain user-specific plugins, MCP servers, providers, and permissions. No blocking issues.

### Edge Cases and Risks

Security, auth, global config, cache, ownership, and session-continuity risks are covered enough for implementation readiness. The proposal explicitly identifies credential exposure through `~/.local/share/opencode/auth.json`, host-specific global config and MCP/plugin paths, cache architecture compatibility, bind-mount ownership, missing host directories, autoupdate behavior, and session storage validation. No blocking issues.

**[non-blocking]** The README should make the trust boundary concrete: enabling the data mount gives the container access to provider API keys and OAuth tokens. The proposal says this, but implementation should keep the warning near the usage example rather than only in an edge-case section.

### Test Plan and Verification Methodology

The plan is small and testable. It starts with manifest and install checks, then mount resolution, runtime startup/auth visibility, plugin/cache behavior, and finally session continuity. This sequence avoids coupling initial feature delivery to uncertain storage migration logic. No blocking issues.

**[non-blocking]** `opencode auth list` is proposed as an example non-mutating credential check. If that exact command is unavailable in the installed OpenCode version, replace it with `opencode models`, `opencode debug config`, or another verified non-mutating command during implementation.

### Implementation Phases

The phases are appropriately incremental and not overbuilt.
The first useful deliverable is a normal devcontainer feature with npm install, lace mounts, docs, and smoke tests.
Cache/session bridge behavior is deferred until tests prove a real need.
No blocking issues.

### Style and CDocs Conventions

The proposal is readable, structured in standard CDocs proposal sections, and uses direct acceptance criteria for each implementation phase. The BLUF is useful and the scope boundaries are explicit. No blocking issues.

## Verdict

**Accept.** The proposal is accurate enough against current OpenCode documentation, aligned with the existing `claude-code` devcontainer feature pattern, and appropriately conservative about auth, cache, global config, and session-continuity risks. It is ready for implementation.

## Action Items

1. [non-blocking] Tighten implementation docs to say global OpenCode directories under `~/.config/opencode/`, not global `.opencode` directories.
2. [non-blocking] Add `documentationURL` to the implemented feature metadata for parity with `claude-code`.
3. [non-blocking] Keep the data-mount credential warning near the README usage example.
4. [non-blocking] Verify the exact non-mutating auth/provider inspection command during implementation and avoid relying on `opencode auth list` unless it exists.
