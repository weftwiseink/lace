---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T11:30:00-08:00
type: devlog
state: archived
status: done
tags: [handoff, architecture, plugins, features, port-management, api-redesign]
---

# Lace API Redesign: Handoff Devlog

## Objective

This is a **handoff devlog** for a new overseer to take over the lace API redesign workstream. The focus is on better organizing and clarifying the lace API, aligning it more closely with devcontainer specs. The overseer should:

1. Find any WIP docs created by background agents since this handoff was written
2. Prepare an executive summary /report synthesizing the current state for a fresh start

## Background

Lace is a devcontainer orchestration CLI (`packages/lace/`). It preprocesses `devcontainer.json` into an extended `.lace/devcontainer.json` and passes it to `devcontainer up --config`. Its current features are:

- **Repo mounting** (`customizations.lace.plugins`): shallow-clone git repos, mount into containers at `/mnt/lace/plugins/<name>`
- **Port auto-assignment**: scan 22425-22499 for available ports, inject into `appPort` for wezterm SSH
- **Prebuilds** (`customizations.lace.prebuildFeatures`): cache feature installations into local images

### How we got here

A workstream to add Claude Code access to lace containers revealed that the "plugin" abstraction was insufficient. The proposed "managed plugin" concept (hardcoded lace logic that generates mounts/env vars/features) was architecturally suspect -- it wasn't really a plugin, just a built-in feature dressed in plugin vocabulary.

Analysis of the devcontainer feature spec showed that it already provides most of what we need: mounts, env vars, lifecycle hooks, typed options, OCI distribution. This led to a reframing: devcontainer features should be the behavioral extensibility unit, and lace's role should narrow to host-side orchestration that features can't do (repo cloning, dynamic port assignment, template variable resolution).

## Key Documents

### Anchor document (read this first)

| Document | Path | Status |
|----------|------|--------|
| Plugin Architecture Analysis | `cdocs/reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md` | `review_ready` |

This report contains the core analysis, the "Themes of Lace's Value-Add" section (with critical NOTE assessments against the devcontainer spec), and the recommendations that drove the proposals below.

### Active proposals (likely WIP from background agents)

| Document | Path | Status | Notes |
|----------|------|--------|-------|
| Feature Awareness Redesign | `cdocs/proposals/2026-02-06-lace-feature-awareness-redesign.md` | `review_ready` | Synthesizes manifest fetching + port refactor into a `customizations.lace.features` design with template vars |
| Rename Plugins to RepoMounts | `cdocs/proposals/2026-02-06-rename-plugins-to-repo-mounts.md` | `review_ready` | Renames `plugins` -> `repoMounts`, mount path `/mnt/lace/repos/`, `overrideMounts` -> `overrides` |
| RFP: Claude Tools Feature | `cdocs/proposals/2026-02-06-rfp-claude-tools-lace-feature.md` | `request_for_proposal` | Repackage Claude access as a devcontainer feature, not hardcoded lace logic |

### Research reports feeding the proposals

| Document | Path | Key finding |
|----------|------|-------------|
| Feature Manifest Fetching Options | `cdocs/reports/2026-02-06-feature-manifest-fetching-options.md` | `devcontainer features info` CLI is the right tool -- no external dependencies needed |
| Port Provisioning Assessment | `cdocs/reports/2026-02-06-port-provisioning-assessment.md` | Dynamic port assignment is a genuine gap; recommends `${lace.port(label)}` templating, migrate from `appPort` to `forwardPorts` |

### Superseded proposals (context only, do not implement)

| Document | Path | Superseded by |
|----------|------|---------------|
| Mount-Enabled Claude Plugin | `cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md` | RFP above |
| Claude Access Detailed Implementation | `cdocs/proposals/2026-02-05-lace-claude-access-detailed-implementation.md` | RFP above |

### Active devlog from background agent

| Document | Path |
|----------|------|
| Feature Overhaul Workstream | `cdocs/devlogs/2026-02-06-feature-overhaul-workstream.md` |

### Reviews (may have been created by background agents)

Check `cdocs/reviews/2026-02-06-*.md` for reviews of the proposals above. Background agents were instructed to write reviews and apply blocking feedback.

## Key Decisions Already Made

1. **Devcontainer features are the behavioral extensibility unit.** Don't build a parallel "managed plugin" or "logic plugin" system.
2. **`customizations.lace.plugins` is being renamed** to something like `repoMounts`. These are data (mounted repos), not behavioral plugins.
3. **`customizations.lace.features`** is the proposed section for features needing lace template variable resolution before being promoted into the standard `features` object.
4. **`appPort` is non-idiomatic** -- the spec recommends `forwardPorts`. But dynamic port assignment is a genuine gap the spec doesn't address.
5. **Container-side user detection** is already handled by `_REMOTE_USER` in features. Lace only needs user detection for host-side decisions (e.g., wezterm SSH URIs).
6. **`devcontainer features info manifest`** returns full feature metadata via OCI annotations -- no external tools (oras, etc.) needed for metadata fetching.

## Workstream Themes

The overseer should frame all work against three themes (detailed in the analysis report):

1. **Performance** -- prebuilds and caching
2. **Cross-project coordination** -- repo mounting with clone-on-demand and per-user overrides
3. **Automation affordances** -- eliminating manual config via template variables, port discovery, user detection

## Plan for Overseer

1. **Discover WIP docs**: `ls cdocs/{proposals,reports,reviews}/2026-02-06*.md` -- background agents may have created additional docs after this handoff was written
2. **Read the anchor document** first (plugin architecture analysis report)
3. **Skim each active proposal's BLUF and status** -- some may have had review feedback applied
4. **Write an executive summary /report** synthesizing:
   - What lace does today (3 features)
   - What's changing and why (feature-centric extensibility)
   - Status of each proposal
   - Recommended next steps / implementation order
5. **Proceed with implementation** or further proposal iteration based on user direction
