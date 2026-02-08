---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T15:00:00-08:00
type: report
state: archived
status: done
tags: [status, architecture, api-redesign, features, plugins, ports, handoff]
references:
  - cdocs/reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md
  - cdocs/proposals/2026-02-06-lace-feature-awareness-redesign.md
  - cdocs/proposals/2026-02-06-rename-plugins-to-repo-mounts.md
  - cdocs/proposals/2026-02-06-rfp-claude-tools-lace-feature.md
  - cdocs/reports/2026-02-06-feature-manifest-fetching-options.md
  - cdocs/reports/2026-02-06-port-provisioning-assessment.md
  - cdocs/devlogs/2026-02-06-feature-overhaul-workstream.md
  - cdocs/devlogs/2026-02-06-lace-api-redesign-handoff.md
---

# Lace API Redesign Workstream Status

> **BLUF:** The lace API redesign workstream has completed its design phase and is ready for implementation. The central outcome: devcontainer features replace lace's ad-hoc "plugin" concept as the behavioral extensibility unit, and lace's role narrows to host-side orchestration -- repo cloning, dynamic port assignment, and template variable resolution. Two proposals are implementation-ready (Feature Awareness Redesign, accepted R2; Rename Plugins to RepoMounts, revisions applied, awaiting R2 confirmation). One proposal remains an RFP stub (Claude Tools as a devcontainer feature). The recommended path forward is to implement the Feature Awareness Redesign and Rename in parallel, then author the Claude Tools feature proposal.

## Context / Background

This report was written by a new overseer taking over the workstream via the handoff devlog (`cdocs/devlogs/2026-02-06-lace-api-redesign-handoff.md`). Its purpose is to synthesize all workstream documents into a single executive summary for orientation and implementation planning.

### What lace does today

Lace is a devcontainer orchestration CLI (`packages/lace/`). It preprocesses `devcontainer.json` into an extended `.lace/devcontainer.json` and passes it to `devcontainer up --config`. Three features:

1. **Repo mounting** (`customizations.lace.plugins`): shallow-clone git repos, mount into containers at `/mnt/lace/plugins/<name>`, with per-user local overrides via `~/.config/lace/settings.json`
2. **Port auto-assignment**: scan 22425-22499 for available host ports, inject into `appPort` as `hostPort:2222` for wezterm SSH access
3. **Prebuilds** (`customizations.lace.prebuildFeatures`): cache feature installations into local images to skip reinstallation on subsequent builds

### How the redesign was triggered

The mount-enabled plugin workstream attempted to add Claude Code access to lace containers via a "managed plugin" -- hardcoded lace logic that generates mounts, env vars, and features. Review identified this as architecturally suspect: it was not a plugin, just a built-in feature dressed in plugin vocabulary. Analysis of the devcontainer feature spec revealed it already provides mounts, env vars, lifecycle hooks, typed options, and OCI distribution. This led to the current redesign: features as the behavioral extensibility unit, lace as the host-side orchestration layer.

## Key Findings

- **The devcontainer feature spec covers container-side concerns well.** Mounts, env vars, lifecycle hooks, typed options, dependency resolution, and OCI distribution are all handled. The gap is host-side orchestration: repo cloning, dynamic port assignment, and template variable resolution.
- **Dynamic port assignment is a genuine gap in the spec.** `forwardPorts`, `portsAttributes`, and container labels are all static -- none can express "find me an available port." Lace must keep custom port management.
- **`appPort` is the correct output for SSH-type ports**, not `forwardPorts`. `appPort` publishes Docker ports for direct TCP access; `forwardPorts` creates tooling-level tunnels. Wezterm SSH clients need direct TCP. The R1 review caught and resolved this.
- **`devcontainer features info manifest --output-format json`** is the right tool for feature metadata fetching. Zero new dependencies, handles auth, <1s per feature. Metadata fetching is best-effort -- lace's core workflow does not require it.
- **The "plugin" terminology is misleading.** Current `customizations.lace.plugins` are mounted repos (data), not behavioral plugins (code). Renaming to `repoMounts` eliminates the conceptual mismatch.

## Document Inventory

### Anchor analysis

| Document | Status | Key conclusion |
|----------|--------|----------------|
| [Plugin Architecture Analysis](../reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md) | `review_ready` | Features are the extensibility unit; lace adds host-side orchestration on top |

### Active proposals

| Document | Status | Review state | Implementation ready? |
|----------|--------|-------------|----------------------|
| [Feature Awareness Redesign](../proposals/2026-02-06-lace-feature-awareness-redesign.md) | `review_ready` | Accepted at R2 | Yes |
| [Rename Plugins to RepoMounts](../proposals/2026-02-06-rename-plugins-to-repo-mounts.md) | `review_ready` | R1 revisions applied, no R2 | Needs R2 confirmation |
| [RFP: Claude Tools Feature](../proposals/2026-02-06-rfp-claude-tools-lace-feature.md) | `request_for_proposal` | Not reviewed | No -- still a stub |

### Research reports

| Document | Status | Key finding |
|----------|--------|-------------|
| [Feature Manifest Fetching Options](../reports/2026-02-06-feature-manifest-fetching-options.md) | `review_ready` | `devcontainer features info` CLI is the right tool |
| [Port Provisioning Assessment](../reports/2026-02-06-port-provisioning-assessment.md) | `review_ready` | Dynamic port assignment is a genuine gap; `${lace.port(label)}` recommended |

### Reviews

| Document | Verdict | Blocking issues resolved? |
|----------|---------|--------------------------|
| [Review: Feature Awareness Redesign R1](../reviews/2026-02-06-review-of-lace-feature-awareness-redesign.md) | Revise (3 blocking) | Yes -- all 3 resolved in R2 revision |
| [Review: Rename Plugins R1](../reviews/2026-02-06-review-of-rename-plugins-to-repo-mounts.md) | Revise (3 blocking) | Yes -- revisions applied, but no R2 review |

### Superseded proposals (context only)

| Document | Superseded by |
|----------|---------------|
| [Mount-Enabled Claude Plugin](../proposals/2026-02-05-lace-mount-enabled-claude-plugin.md) | Claude Tools RFP |
| [Claude Access Detailed Implementation](../proposals/2026-02-05-lace-claude-access-detailed-implementation.md) | Claude Tools RFP |

### Devlogs

| Document | Status |
|----------|--------|
| [Feature Overhaul Workstream](../devlogs/2026-02-06-feature-overhaul-workstream.md) | `complete` |
| [API Redesign Handoff](../devlogs/2026-02-06-lace-api-redesign-handoff.md) | `handoff` |

## Architectural Decisions (Locked)

These decisions are settled across the reviewed and accepted proposals:

1. **Devcontainer features are the behavioral extensibility unit.** No parallel "managed plugin" or "logic plugin" system.
2. **`customizations.lace.features`** is the declaration surface for features needing lace template variable resolution before promotion into the standard `features` object.
3. **`${lace.port(label, containerPort)}`** for dynamic host-port allocation. Two arguments: label for stable identification, container port for the `appPort` mapping. Side-effectful (scans ports, persists assignment).
4. **Keep `appPort` for direct TCP access.** SSH clients connect via raw TCP, not devcontainer CLI tunnels. Add `portsAttributes` for labeling and `requireLocalPort: true` as a safety net.
5. **`customizations.lace.repoMounts`** replaces `plugins`. Mount path changes from `/mnt/lace/plugins/` to `/mnt/lace/repos/`. Settings key changes from `plugins` to `repoMounts`, nested `overrideMount` to `localMount`.
6. **`devcontainer features info manifest`** for metadata fetching. Best-effort, non-blocking. Two-tier cache (in-memory + filesystem).
7. **Template resolution scoped to `customizations.lace.features` option values only.** Spec-native `${localEnv:...}` and `${containerEnv:...}` pass through unchanged.
8. **Backwards-compatibility bridge** for legacy port assignments during the transition period.

## Implementation Readiness Assessment

### Ready to implement

**Feature Awareness Redesign** (accepted R2) -- 4 phases with clear file lists and success criteria:

| Phase | Scope | Dependencies |
|-------|-------|-------------|
| Phase 1 | Template resolver + port allocator | None |
| Phase 2 | Feature metadata + validation | Phase 1 |
| Phase 3 | Rename plugins to repos | **None (independent)** |
| Phase 4 | Migration + cleanup (remove old port-manager) | Phases 1 + 3 |

**Rename Plugins to RepoMounts** -- 5 phases, single atomic commit. All R1 blocking feedback applied. Awaiting R2 review confirmation, but the revisions directly address the blocking issues (BLUF accuracy, `repoMounts` key name, Out of Scope section for non-lace "plugin" references).

### Needs further work

**Claude Tools Feature** -- still an RFP stub with open questions (mount declaration ownership, feature self-sufficiency without lace, settings override granularity). Depends on the Feature Awareness Redesign being implemented first (needs the template variable system). Not on the critical path for the core API redesign.

**Research reports** -- not formally reviewed, but their findings are incorporated into the accepted Feature Awareness proposal. Formal review would be nice-to-have but is not blocking.

## Open Risks

1. **Prebuild + lace features dual declaration.** When a feature appears in both `prebuildFeatures` and `customizations.lace.features`, the devcontainer CLI may re-run `install.sh` when options differ from the prebuild, negating the caching benefit. Flagged as an open question, not blocking Phase 1.
2. **`${lace.containerUser}` is best-effort.** Lace does not replicate the full devcontainer CLI user resolution order (`remoteUser` > feature-declared `remoteUser` > `containerUser` > image default). Sufficient for host-side decisions like SSH URIs; not authoritative. Features should use `_REMOTE_USER` inside the container.
3. **Existing clone directories on disk.** After the rename, `~/.config/lace/<project>/plugins/` directories become orphaned. Users must manually delete them. Re-cloning is cheap (shallow clones).

## Recommendations

1. **Conduct R2 review of the Rename proposal** to confirm acceptance. The revisions directly address all three blocking issues.
2. **Implement Feature Awareness Phase 1 and Rename in parallel.** They are independent -- Phase 1 adds new modules (`template-resolver.ts`, `port-allocator.ts`); Rename touches existing modules. No conflicts.
3. **Implement Feature Awareness Phase 2** (metadata fetching) after Phase 1 stabilizes.
4. **Author the full Claude Tools feature proposal** from the RFP after the template variable system is implemented and tested. Having a working `customizations.lace.features` pipeline will ground the proposal in concrete experience.
5. **Defer Phase 4 cleanup** (remove old `port-manager.ts`) until the lace.wezterm plugin is also updated to declare `"port": "${lace.port(ssh, 2222)}"` in its feature options.
6. **Do not formally review the research reports** unless implementation reveals questions the accepted proposal does not answer. The proposals already synthesize the research findings.
