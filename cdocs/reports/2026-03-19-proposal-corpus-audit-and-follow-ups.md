---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-19T17:36:00-07:00
task_list: lace/corpus-maintenance
type: report
state: live
status: wip
tags: [audit, proposals, follow-ups, corpus-maintenance, architecture]
---

# Proposal Corpus Audit and Uncaptured Follow-Ups

> BLUF: Audited 88 proposals against devlogs.
> Archived 30 proposals (18 mechanical by status, 12 devlog-verified completions).
> Identified 24 uncaptured follow-up items across 10 topic areas, with 10 high-priority actionable items that have no existing proposal or RFP.
> Key systemic finding: proposal frontmatter statuses are routinely stale, with devlog `done`/`complete` status being the actual ground truth.

## Scope

This audit cross-referenced all non-archived proposals against devlogs to determine:
1. Which proposals were implemented but never status-updated or archived.
2. Which follow-up items, TODOs, and deferred work were called out but never captured as proposals or RFPs.

## Archival Summary

### Mechanical archivals (status-based): 18 proposals

All proposals with status `*_accepted`, `evolved`, `rejected`, `implemented`, or `implementation_complete` were archived.
These had clearly terminal statuses but `state: live`.

### Devlog-verified archivals: 12 proposals

Subagents cross-referenced proposal topics against devlog completion claims.
The following proposals had matching devlogs claiming `done`/`complete` but stale proposal statuses:

| Proposal | Was | Now | Evidence |
|----------|-----|-----|----------|
| post-container-git-verification | implementation_wip | archived | devlog done, 888 tests |
| devcontainer-tool-integration-docs | review_ready | archived | docs exist in README, troubleshooting.md |
| ssh-key-file-mount-and-validation | implementation_wip | archived | devlog E2E verified, 781 tests |
| wez-into-error-visibility-and-smart-retry | in_review | archived | devlog done, round 4 accepted |
| unify-worktree-project-identification | implementation_wip | archived | devlog accepted |
| rfp-worktrunk-project-naming | implementation_wip | archived | devlog review_ready |
| workspace-validation-and-layout | wip | archived | devlog complete, 4 phases done |
| mount-accessor-api | review_ready | archived | devlog accepted, 589 tests |
| remove-legacy-settings-path | review_ready | archived | trivially accepted, 4-line change |
| lace-mount-enabled-claude-plugin | review_ready | archived | superseded by rfp-claude-tools |
| lace-claude-access-detailed-implementation | review_ready | archived | superseded by rfp-claude-tools |
| lace-up-progress-output | review_ready | archived | superseded by lace-up-output-organization |

### Systemic finding: stale frontmatter

Proposal statuses are routinely not updated after implementation.
Devlog statuses (`done`, `complete`) are the actual ground truth for completion.
> TODO(opus/corpus-maintenance): Consider a hook or triage rule that auto-promotes proposal status when its implementing devlog reaches `done`.

## Remaining Live Proposals (Post-Audit)

After archival, these proposals remain live:

### RFPs (request_for_proposal): 7
| Proposal | Topic |
|----------|-------|
| remote-user-arg-resolution | `_REMOTE_USER` ARG variable parsing |
| lace-init-command | Project scaffolding |
| feature-install-context-dependency-safety | Lace-level dependency orchestration (short-term done) |
| feature-dockerfile-install-consistency | Dockerfile `apt-get` shadowing detection |
| rfp-claude-tools-lace-feature | Claude Code devcontainer feature |
| rfp-plugin-host-setup | Plugin host-side runtime scripts |
| rfp-plugin-conditional-loading | Plugin `when` clause evaluation |

### Active proposals: 9
| Proposal | Status | Notes |
|----------|--------|-------|
| lace-up-output-organization | review_ready | Supersedes lace-up-progress-output |
| host-proxy-project-domain-routing | review_ready | Accepted, unimplemented; depends on portless |
| wezterm-sidecar-workspace-manager | review_ready | Phase 0 spike never run |
| dotfiles-firefox-chezmoi-migration | review_ready | R1 revision requested, stalled |
| portless-devcontainer-feature | implementation_wip | Phases 1-4 done, test gap, GHCR deferred |
| secure-ssh-key-auto-management-lace-cli | wip-blocked | Architecture boundary issue |
| wez-into-container-restart-resilience | request_for_proposal | No investigation started |
| wezterm-window-sizing-and-rendering | request_for_proposal | No work started |
| deeper-wezterm-devcontainer-integration | request_for_proposal | Broad umbrella RFP |

### Special cases: 3
| Proposal | Status | Notes |
|----------|--------|-------|
| smart-prebuild-cache-busting | request_for_proposal | Stub, never elaborated |
| port-scanning-wezterm-discovery | implementation_ready | Code committed, E2E testing incomplete |
| wezterm-plugin-proper-packaging | deferred | Accepted as deferred |

## Uncaptured Follow-Up Items

Organized by priority tier.

### Tier 1: High-Priority (Actionable, No Coverage)

**1. Agent situational awareness / lace-introspection MCP server**
- Source: `cdocs/reports/2026-02-05-agent-situational-awareness.md`
- Detailed report accepted but no proposal exists.
- Proposes MCP server with `lace_environment`, `lace_session_history`, `lace_worktrees` tools.
- Agents have no reliable way to self-orient inside a lace devcontainer.

**2. Portless GHCR publication (Phase 5)**
- Source: `cdocs/devlogs/2026-02-26-portless-feature-implementation.md`
- Portless feature implemented locally but not published to GHCR.
- Blocks host-proxy-project-domain-routing proposal and real user consumption.

**3. wezterm-server v1.2.0 GHCR publish**
- Source: multiple devlogs (workspace-awareness, ssh-key-validation)
- Both proposals note that mount declaration validation is only active via `fileExists` fallback until v1.2.0 is published.
- Recurring item across 2+ workstreams.

**4. Prebuild features validation warning**
- Source: `cdocs/devlogs/2026-02-09-port-allocation-investigation.md`
- Warn when port-declaring features are placed in `prebuildFeatures`.
- Catches a known class of misconfiguration that caused real failures.

**5. resurrect.wezterm upstream PR merges (6 open PRs)**
- Source: `cdocs/reports/2026-03-01-pr-merge-attribution-strategy.md`
- Strategy documented, conflict map created, merges never executed.
- PRs include bug fixes relevant to the fork.

### Tier 2: Moderate Priority

**6. `lace resolve-user` subcommand (DRY user resolution)**
- Source: `cdocs/proposals/2026-03-07-remote-user-resolution-in-mount-targets.md`
- R1 review flagged as blocking: `lace-discover` and TypeScript use different defaults.
- Implementation done but DRY concern unclear.

**7. sshd wrapper feature (decouple SSH port from wezterm-server)**
- Source: multiple reports and proposals.
- Long-standing design debt; wezterm-server should not own SSH port metadata.

**8. WezTerm pane interaction MCP server**
- Source: `cdocs/reports/2026-03-07-wezterm-pane-interaction-skill.md`
- Research done, open questions remain, no proposal after report.

**9. `lace-discover --debug` / `--verbose` mode**
- Source: `cdocs/devlogs/2026-02-09-port-allocation-investigation.md`
- Useful for diagnosing silent port allocation failures.

**10. `lace dev` wrapper for portless service naming**
- Source: `cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md`
- Low-effort DX wrapper for portless naming conventions.

### Tier 3: Minor / Deferred

**11. `lace clean` for stale mount directories** - Quality-of-life cleanup tool.

**12. `wez-into --rebuild` without `--start` warning** - Trivial fix from recent review.

**13. RPM distro `su -c` behavior** - Only relevant when adding RPM container support.

**14. Docker Hub hostname normalization** - Only relevant if Docker Hub features added.

**15. Unit tests for `isContainerRunning` / LACE_RESULT** - Non-blocking per review.

**16. Full devcontainer.json schema validation** - Non-trivial scope increase.

**17. `null` vs absent RUNTIME_KEYS fingerprint edge case** - Testing edge case.

**18. Legacy bash file inlining** - Deferred to nushell migration.

**19. Firefox chezmoi `profiles.ini` template bug** - Lowest priority dotfiles item.

## Cross-Cutting Observations

### Overlapping proposals
`lace-up-progress-output` (Feb 16) and `lace-up-output-organization` (Mar 7) address the same domain.
The Feb proposal has been archived as `evolved`; the Mar proposal is the canonical one.

### Port-scanning discovery (UNCLEAR status)
`port-scanning-wezterm-discovery` has code committed (Phases 1-4) but E2E testing (Phase 5) was never completed.
The devlog had `revision_requested` and was never resolved.
This proposal is left live at `implementation_ready` but its actual implementation state is ambiguous.

### `open-lace-workspace` hardcoded port 2222
Two archived proposals reference this as an outstanding issue.
The script may still use hardcoded port 2222 instead of dynamic port discovery.
> TODO(opus/corpus-maintenance): Verify whether `open-lace-workspace` was updated to use dynamic discovery.
