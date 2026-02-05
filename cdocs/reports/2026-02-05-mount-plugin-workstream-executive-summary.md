---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T18:00:00-08:00
type: report
state: live
status: review_ready
tags: [executive-summary, workstream, claude-code, lace-plugins, managed-plugins, mount-enabled]
---

# Mount-Enabled Plugin Workstream: Executive Summary

> **BLUF:** Four research reports investigated how to extend the lace plugin system with Claude Code access, session portability, and agent awareness. The key finding across all four is that the existing plugin system provides strong foundations (mount resolution, extended config generation, settings override) but needs three targeted extensions: feature/env-var injection in `generateExtendedConfig`, a "managed plugin" concept for non-git integrations, and lightweight environment markers for agent orientation. A mid-level implementation proposal has been written (`cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md`) covering four phases that can be implemented incrementally, each validated against the Claude access use case.

---

## What Was Researched

This workstream produced four focused research reports, each investigating a specific aspect of bringing Claude Code access into lace-managed devcontainers:

| Report | Path | Focus |
|--------|------|-------|
| Plugin System State | `cdocs/reports/2026-02-05-lace-plugin-system-state.md` | Current architecture, extension points, test coverage |
| Claude Devcontainer Bundling | `cdocs/reports/2026-02-05-claude-devcontainer-bundling.md` | Installation, credential forwarding, mount design |
| Claude-Tools Streamlining | `cdocs/reports/2026-02-05-claude-tools-streamlining.md` | Session portability, path encoding, symlink bridges |
| Agent Situational Awareness | `cdocs/reports/2026-02-05-agent-situational-awareness.md` | Environment markers, CLAUDE.md, MCP introspection |

All four reports have been reviewed and revised.

## Key Findings Per Report

### Report 1: Plugin System State

- The plugin system is **fully implemented** across 7 phases with 254+ passing tests. No blocking gaps remain in the current scope.
- `generateExtendedConfig` (`up.ts:243-311`) is the central integration point but currently only merges `mounts`, `postCreateCommand`, and `appPort`. It does **not** support `features`, `containerEnv`, `remoteEnv`, or `postStartCommand`.
- The function is **module-private** -- it cannot be reached without going through `runUp`. Any new config generation must either extend this function or duplicate its logic.
- The `ResolvedPlugin` interface and the `extractPlugins` discriminated-union pattern are clean extension points for future work.
- Two RFPs (conditional loading, host setup) remain in `request_for_proposal` status. Neither is a prerequisite for the claude access work.

### Report 2: Claude Devcontainer Bundling

- Claude Code access requires **three coordinated mechanisms**: the official `ghcr.io/anthropics/devcontainer-features/claude-code:1` devcontainer feature, a **read-write** `~/.claude/` bind mount, and environment variable forwarding (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY`).
- The recommended approach is a **dedicated `customizations.lace.claude` field** (not a git-repo plugin) because Claude access generates features and env vars, not just mounts.
- **Runtime user detection** is required because mount targets must reference the container user's home directory (e.g., `/home/node/.claude`), which varies by project.
- **macOS hosts** have a Keychain limitation: OAuth credentials are not stored in `~/.claude/.credentials.json`, so bind mounting alone is insufficient. The recommended workaround is `ANTHROPIC_API_KEY`.
- A **security concern** exists: any project can mount the user's Claude credentials by setting `customizations.lace.claude: true`. A global opt-in requirement was recommended but deferred.

### Report 3: Claude-Tools Streamlining

- Session portability between host and container is blocked by **path encoding mismatch**: the host path `/var/home/mjr/code/weft/lace` encodes to `-var-home-mjr-code-weft-lace` while the container path `/workspaces/lace` encodes to `-workspaces-lace`.
- The recommended solution is a **symlink bridge** created in `postStartCommand` that maps the container encoding to the host encoding. This is low-cost, idempotent, and does not require modifying claude-tools.
- claude-tools installation in containers is **currently impractical** due to missing Linux x86_64 binaries. This should be deferred until upstream provides them.
- The `lace session` subcommand concept is deferred to user feedback -- the symlink bridge provides 80% of the value.

### Report 4: Agent Situational Awareness

- Agents currently receive **no lace-specific orientation context**. The CLAUDE.md only references cdocs rules.
- The highest-leverage change is **injecting `LACE_*` environment variables** via `containerEnv` (~15 lines of code) and **generating `.claude.local.md`** with runtime context via `postStartCommand`.
- An MCP server for introspection was proposed but deferred to Tier 3 (medium-term) due to implementation effort. A shell-based `lace-env` script is recommended as a bridge.
- Environment markers should be split into two tiers: **Tier A** (permanent project facts, implementable today) and **Tier B** (runtime detection, requires the markers to exist first).

## What Is Being Proposed

The implementation proposal (`cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md`) covers:

1. **Extending `generateExtendedConfig`** to merge `features`, `containerEnv`, `remoteEnv`, and `postStartCommand` alongside the existing `mounts`, `postCreateCommand`, and `appPort`. This is the generic API improvement that benefits all future integrations.

2. **A `customizations.lace.claude` managed plugin** that bundles: the devcontainer feature, `~/.claude/` bind mount, `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY` forwarding, and runtime user detection. One line in devcontainer.json gives developers Claude Code access.

3. **A session bridge symlink** created in `postStartCommand` for host/container session portability.

4. **`LACE_*` environment variables and `.claude.local.md`** for agent situational awareness.

## Recommended Implementation Sequence

| Phase | Description | Estimated Tests |
|-------|-------------|-----------------|
| 1 | Config generation API extension + Claude extraction utilities | ~21 unit |
| 2 | Claude access managed plugin (end-to-end) | ~12 unit + 4 integration |
| 3 | Session bridge + LACE_* environment variables | ~7 unit |
| 4 | `.claude.local.md` agent context generation | ~5 unit |

Each phase validates the API against the Claude access use case before proceeding. Phase 2 is the critical milestone: after it, `"customizations.lace.claude": true` produces a working container with Claude Code.

## Key Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Injected features not processed by `devcontainer up --config` | High | Empirical verification is the first task of Phase 2. Fallback: require user to add feature to base config. |
| Credential exposure via untrusted project configs | Medium | Accepted for Phase 1 (analogous to standard devcontainer mounts). Global opt-in deferred to follow-up. |
| macOS OAuth credential forwarding failure | Medium | Documented limitation. Recommend `ANTHROPIC_API_KEY` for macOS users. |
| `remoteUser` detection defaults to `root` incorrectly | Low | Prominent warning + settings override (`claude.remoteUser`). |
| `postStartCommand` format handling complexity | Low | Always normalize to object format to avoid string concatenation quoting issues. |

## Open Questions Requiring User Input

1. **Global opt-in for credential mounting?** Should `settings.json` require `"claude": { "enabled": true }` before any project-level `customizations.lace.claude` takes effect? More secure but adds a setup step.

2. **Agent awareness for non-claude containers?** Should `LACE_*` environment variables and `.claude.local.md` be generated for all lace containers, or only when claude access is enabled? Currently bundled with claude access for pragmatism.

3. **claude-tools installation timeline?** The `installClaudeTools` flag is defined but not implemented. Should this be tracked as a separate RFP or left dormant until Linux binaries are available upstream?

4. **Feature injection verification approach?** Should the empirical test of feature injection from extended configs be done as a standalone spike before implementation, or as the first step of Phase 2?

## Related Documents

- **Implementation Proposal:** `cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md`
- **Proposal Review:** `cdocs/reviews/2026-02-05-review-of-lace-mount-enabled-claude-plugin.md`
- **Plugin System Proposal:** `cdocs/proposals/2026-02-04-lace-plugins-system.md`
- **RFP: Plugin Host Setup:** `cdocs/proposals/2026-02-04-rfp-plugin-host-setup.md`
- **RFP: Plugin Conditional Loading:** `cdocs/proposals/2026-02-04-rfp-plugin-conditional-loading.md`
