---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T12:00:00-07:00
task_list: lace/user-config-and-fundamentals
type: devlog
state: live
status: wip
tags: [lace, user_config, devcontainer_features, architecture]
---

# User-Level Config and Fundamentals Feature: Devlog

## Objective

Consolidate lace's proliferating per-feature config wrappers into two cohesive systems:
1. A user-level config mechanism for declaring prebuild features, universal mounts, default shell, and credentials across all projects.
2. A "fundamentals" devcontainer feature bundling sshd, git identity, screenshots, dotfiles setup, and other baseline tooling.

Additionally, produce a gap analysis comparing lace's developer experience against VS Code devcontainers.

## Context

Multiple RFPs have accumulated addressing individual config gaps:
- `2026-03-23-lace-git-credential-support.md` (git identity)
- `2026-03-24-lace-screenshot-sharing.md` (screenshot mounts)
- `2026-03-22-lace-sshd-feature-evolution.md` (sshd publishing)
- `2026-03-24-workspace-system-context.md` (agent context)
- `2026-02-06-rfp-claude-tools-lace-feature.md` (Claude tools as feature)

The user wants to avoid endless proliferation of minimal wrapper features.
Instead: a user-level config that applies across projects, and a single fundamentals feature for baseline tooling.

Key constraints:
- Mounts must be read-only for security (containerization boundary).
- Must play nice with chezmoi (dotfiles-managed config).
- Security scrutiny higher than usual: no compromising lace's container isolation.
- Research VS Code/devcontainer best practices for developer config sharing.

## Plan

### Phase 1: User-Level Config
1. Subagent /report on devcontainer best practices for user config, VS Code approaches, chezmoi integration, security model.
2. Subagent /propose user-level prebuild and mount config mechanism.
3. Run through nit-fix -> triage -> review pipeline.

### Phase 2: Fundamentals Feature
4. Subagent /propose a consolidated "fundamentals" lace feature (sshd, git, screenshots, dotfiles, etc.).
5. Run through review pipeline.

### Phase 3: Gap Analysis
6. Subagent /report on remaining gaps vs VS Code devcontainer ease-of-use.
7. Review the report.

## Testing Approach

This session is proposal/report authoring, not implementation.
Verification is through the cdocs review pipeline.

## Implementation Notes

### Exploration Findings

Existing lace mount/config architecture:
- `~/.config/lace/settings.json` provides user-level mount source overrides (but not feature declarations or universal mounts).
- `customizations.lace.mounts` in devcontainer.json declares project-level mounts with template variables.
- `customizations.lace.prebuildFeatures` caches slow features into `lace.local/*` images.
- Feature metadata (`devcontainer-feature.json`) declares mounts/ports that lace auto-injects.

The gap: no mechanism for a user to say "always install these features" or "always mount these directories" across all lace projects.

### Phase 1: User-Level Config (Complete)

Subagent produced research report and proposal.
Report accepted on round 1 review.
Proposal required round 1 revision (four blocking issues: pipeline numbering mismatch, namespace validation gap, denylist gaps, test plan security expansion).
All issues addressed; accepted on round 2 review.

Key design decisions:
- Separate `~/.config/lace/user.json` from `settings.json` (different concerns, different lifecycles).
- Git identity via env vars, not `.gitconfig` mount (prevents credential helper leakage).
- Read-only enforcement on all user mounts with no override.
- Path denylist blocks `~/`, `~/.ssh/`, `~/.gnupg/`, `~/.aws/`, Docker socket, etc.
- Symlink traversal protection via `realpath()` before denylist checking.
- `validateMountNamespaces()` must add `"user"` to valid namespace set (one-line change).

### Phase 2: Fundamentals Feature (Complete)

Subagent produced proposal for `ghcr.io/weftwiseink/devcontainer-features/lace-fundamentals`.
Required round 1 revision (two blocking issues: `AllowTcpForwarding no` breaking ssh -L, GIT_COMMITTER env var handling inconsistency).
Both issues addressed; accepted on round 2 review.

Key design decisions:
- Consolidated feature over composable micro-features (five capabilities always needed together).
- `dependsOn` sshd:1 (auto-installs upstream, consumers declare only fundamentals).
- SSH hardening: 7 directives including `AllowTcpForwarding local` (local forwarding allowed, remote blocked).
- Chezmoi installed at build time, applied at runtime via `lace-fundamentals-init` postCreateCommand.
- Git identity: env vars for `git commit`, init script also writes `git config --global` for tool compatibility.
- Screenshots delegated to `user.json` mounts (not a feature concern).

### Phase 3: Gap Analysis (Complete)

Subagent produced gap analysis report comparing lace vs VS Code devcontainers.

Key findings:
- 5 capabilities fully covered (features, lifecycle hooks, file sync, terminal integration, multi-root workspaces).
- 5 partially covered with pending proposals (dotfiles, settings sync, extensions, port forwarding, git integration).
- 3 gaps by design (credential forwarding, GPU passthrough, Docker Compose).
- 2 addressable gaps: clipboard sharing (OSC 52 config), debugging (neovim DAP preconfiguration).
- Terminal integration is lace's strongest area (tmux copy mode, session persistence, multiplexing).

### Cross-document fix

Reviewer caught nushell binary path discrepancy: user config proposal used `/usr/bin/nushell`, fundamentals proposal used `/usr/bin/nu`.
The correct binary name is `nu`.
Fixed in user config proposal.

## Changes Made

| File | Description |
|------|-------------|
| `cdocs/devlogs/2026-03-24-user-config-and-fundamentals-feature.md` | This devlog |
| `cdocs/reports/2026-03-24-user-level-devcontainer-config-approaches.md` | Research report: user-level config approaches (accepted) |
| `cdocs/proposals/2026-03-24-lace-user-level-config.md` | Proposal: user-level config mechanism (accepted, round 2) |
| `cdocs/reviews/2026-03-24-review-of-user-level-devcontainer-config-approaches.md` | Review of research report |
| `cdocs/reviews/2026-03-24-review-of-lace-user-level-config.md` | Review of user config proposal (round 1) |
| `cdocs/reviews/2026-03-24-review-r2-of-lace-user-level-config.md` | Review of user config proposal (round 2) |
| `cdocs/proposals/2026-03-24-lace-fundamentals-feature.md` | Proposal: fundamentals feature (accepted, round 2) |
| `cdocs/reviews/2026-03-24-review-of-lace-fundamentals-feature.md` | Review of fundamentals proposal (round 1) |
| `cdocs/reviews/2026-03-24-r2-review-of-lace-fundamentals-feature.md` | Review of fundamentals proposal (round 2) |
| `cdocs/reports/2026-03-24-lace-vs-vscode-devcontainer-gap-analysis.md` | Gap analysis: lace vs VS Code devcontainers |
| `cdocs/reports/2026-03-24-user-config-fundamentals-design-decisions.md` | Supplemental design decisions report |

### Phase 4: User REVIEW_NOTEs Revision (Complete)

User reviewed both proposals and left 9 REVIEW_NOTEs requesting changes.
Single subagent revised both proposals in unison and produced a supplemental design decisions report.
All REVIEW_NOTEs removed.

Major changes:
- **Configurable mount policy**: replaced hardcoded `DENIED_MOUNT_SOURCES` array with `~/.config/lace/mount-policy` file using `.gitignore`-style format with `!`-prefix exceptions and last-match-wins semantics. Default policy ships with lace.
- **Home directory constraint removed**: mounts allowed from any path. Mount policy handles protection.
- **Project-aware git identity**: changed from "always from user.json, cannot be overridden" to two-layer system. User.json provides default via `~/.gitconfig`. Projects override via git's native `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*` env vars (available since git 2.31).
- **Feature mount requests**: fundamentals feature now declares `dotfiles` and `screenshots` as requested mounts in `customizations.lace.mounts` with `recommendedSource` and `hint`. Lace prompts user to configure.
- **install.sh decomposition**: restructured into thin orchestrator sourcing `steps/ssh-hardening.sh`, `steps/chezmoi.sh`, `steps/git-identity.sh`, `steps/shell.sh`, `steps/staples.sh`.
- **Git as dependency**: added `ghcr.io/devcontainers/features/git:1` to `dependsOn`.
- **Staple tools**: added `steps/staples.sh` installing curl, jq, less if missing.

## Verification

All deliverables completed:
- User-level config proposal: accepted (round 2), then revised per user REVIEW_NOTEs
- Fundamentals feature proposal: accepted (round 2), then revised per user REVIEW_NOTEs
- Gap analysis report: complete (review_ready), recommendation: defer
- Supplemental design decisions report: complete

### Phase 5: Post-REVIEW_NOTE Reviews (Complete)

Both proposals went through round 3 and round 4 reviews after the REVIEW_NOTE revisions.
Both accepted on round 4.

Round 3 blocking issues found and fixed:
- User config: mount policy prefix-matching ambiguity (`~/.ssh` vs `~/.sshrc`), `mergeUserGitIdentity()` contradicting two-layer identity, Phase 4 variable name error.
- Fundamentals: screenshots mount target conflict with user.json, dead `dotfilesPath` option.

### Phase 6: Implementation Handoff (Complete)

Handoff devlog and implementer prompt prepared:
- `cdocs/devlogs/2026-03-24-user-config-fundamentals-handoff.md`: document map, build/test workflow, critical gotchas.
- `cdocs/devlogs/2026-03-24-implementer-prompt.md`: standalone prompt for the implementation agent with test-first workflow, verification checklist, and anti-patterns.

VS Code gap analysis: recommended defer. Addressable gaps (clipboard, DAP) are dotfiles config concerns addressed by chezmoi integration.
