---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-06T16:53:30-07:00
task_list: lace/feature-id-collision
type: report
state: archived
status: done
last_reviewed:
  status: accepted
  by: "@micimize"
  at: 2026-05-06T17:30:22-07:00
  round: 1
tags: [incident, feature-collision, user-config, template-resolution, robustness, future_work]
---

# Feature Short-ID Collision Strands clauthier's First lace up

> BLUF: A `lace up` in `~/code/weft/clauthier/main` failed in the `templateResolution` phase with `Feature ID collision: "claude-code" matches both "ghcr.io/weftwiseink/devcontainer-features/claude-code:1" and "ghcr.io/anthropics/devcontainer-features/claude-code:1"`.
> Root cause: `user-config-merge.ts:54-76` dedupes user-injected features by *full* feature reference, while the downstream `buildFeatureIdMap` in `template-resolver.ts:131-147` enforces *short-ID* uniqueness across the merged set.
> Two registries shipping a feature named `claude-code` survive the merge and only collide one phase later, with an error message that puts the resolution work back on the user instead of letting the project layer win.
> Distinct from the 2026-05-05 prebuild-tag-collision incident: different code path, different phase, different fix surface, though both fall under "identity collision in lace's feature/image model."
> Resolved tactically by stripping clauthier's devcontainer.json to project-specific entries.
> Structural fix would dedupe by short ID at merge time and let project-layer choices override user-layer defaults.

## Context / Background

The user ran `lace up` in `~/code/weft/clauthier/main` on 2026-05-06.
This was the first run of clauthier's lace container.
The pipeline failed in `templateResolution` with a short-ID collision error.
A separate agent is concurrently working on prebuild-cache flakiness.
The user requested a fix scoped to clauthier's config (no lace code changes) and a report surfacing whether this is a separate concern from the 2026-05-05 reports.

clauthier was scaffolded on 2026-03-18 (commit `e738630`) with `ghcr.io/anthropics/devcontainer-features/claude-code:1` in `prebuildFeatures`.
The user-level `~/.config/lace/user.json` was created on 2026-03-25 with `ghcr.io/weftwiseink/devcontainer-features/claude-code:1` as a global default in `features`.
The two configs were on a collision course from 2026-03-25 onward.
The first `lace up` in clauthier after that date triggered the failure.

## Key Findings

- The failure is fully deterministic given the two configs. It does not depend on cache state, timing, or the prebuild image. `lace validate` reproduces it without invoking devcontainer at all.
- `user-config-merge.ts:54-76` (`mergeUserFeatures`) merges user-layer and project-layer features keyed on the full feature reference string. Two refs that differ in registry org but share the trailing path segment (`claude-code`) survive the merge as distinct entries.
- `template-resolver.ts:131-147` (`buildFeatureIdMap`) is invoked downstream with `{...features, ...prebuildFeatures}`. It rejects any short-ID duplication. The error names both refs and instructs the user to "rename one using a local feature wrapper to disambiguate" - heavyweight remediation that does not address the root mismatch in dedup semantics between the two layers.
- The user-config layer's intent is "default if the project has no opinion." Hardening that intent requires the merge layer to dedupe at the same granularity that downstream enforces (short ID), with project-layer entries winning on collision.
- The `weftwiseink/claude-code` and `anthropics/claude-code` features are not strict alternatives. Their metadata diverges:
  - `weftwiseink/claude-code` declares `customizations.lace.mounts` (auto-injects `claude-code/config` and `claude-code/config-json` bind mounts).
  - `anthropics/claude-code` declares `customizations.vscode.extensions` (installs the official VS Code extension) and has no lace mounts.
- clauthier's original devcontainer.json bypassed `weftwiseink/claude-code`'s auto-injection by declaring its own `claude-config` and `claude-config-json` mounts under `customizations.lace.mounts`, indicating an intentional choice to hand-roll mount targets rather than inherit from the wrapper feature.

## Symptom Detail

Tail of `~/code/weft/clauthier/main/.lace/logs/2026-05-06T23-26-46-f7e82a.log`:

```
Auto-injected mount templates for: project/bash-history, project/claude-config, project/claude-config-json, neovim/plugins, claude-code/config, claude-code/config-json, wezterm-server/authorized-keys
Template resolution failed: Feature ID collision: "claude-code" matches both "ghcr.io/weftwiseink/devcontainer-features/claude-code:1" and "ghcr.io/anthropics/devcontainer-features/claude-code:1". Rename one using a local feature wrapper to disambiguate.
```

LACE_RESULT:

```
{"exitCode":1,"failedPhase":"templateResolution","containerMayBeRunning":false}
```

The `Auto-injected mount templates` line is informative: the auto-injection step ran *before* the collision check, generating overlapping declarations (`project/claude-config` from clauthier's customizations and `claude-code/config` from `weftwiseink/claude-code`'s metadata) that target the same `/home/node/.claude` path.
This overlap was already wasteful before the collision became fatal.

## Analysis

### Cause: dedup-granularity mismatch between layers

`mergeUserFeatures` (user-config layer) treats `ghcr.io/weftwiseink/.../claude-code:1` and `ghcr.io/anthropics/.../claude-code:1` as distinct features.
`buildFeatureIdMap` (template-resolver layer) treats them as the same feature.
Both layers are individually defensible.
Merging by full ref preserves user intent on a per-source basis.
Validating short-ID uniqueness reflects how `devcontainer up` actually installs features (one short ID per resolved feature set).

The defect is the *combination*: there is no point in the pipeline where the user-layer's "default unless overridden" intent gets translated into the short-ID model that downstream enforces.
The user-layer entry survives merge as a phantom that downstream rejects.

### Why a "local feature wrapper" is not a real remediation here

The error suggests the user wrap one of the colliding features in a local feature with a different short ID.
This is workable when two genuinely-different features share a name (rare).
It is *not* workable when the user wants "any claude-code installer is fine" (common): renaming defeats the dedup goal.
The error message thus reads as design hand-waving in the common case.

### Why clauthier's hand-rolled mounts matter

clauthier's `customizations.lace.mounts.claude-config` and `claude-config-json` mounts target the same paths that `weftwiseink/claude-code`'s metadata auto-injects under different namespaces.
Once the user-config layer added `weftwiseink/claude-code`, clauthier was double-declaring the same mount targets via two namespaces (`project/claude-config*` and `claude-code/config*`).
The mount-target conflict check would have caught this if the feature-id check had not fired first.
The fix that removes the explicit anthropics ref also dissolves the duplicate-mount problem, because clauthier's project-layer mount declarations were redundant with the wrapper feature's auto-injection.

### How this manifested today and not earlier

clauthier was scaffolded 2026-03-18 with anthropics' claude-code.
The user-level `user.json` was authored 2026-03-25 with weftwiseink/claude-code.
Both files have not been edited since their creation dates (mtime checks).
The collision has been latent for ~6 weeks but only fires on `lace up`.
clauthier had not been brought up before today, so this is the first triggered run.

This is a slow-burn class of regression: any project that pre-dates the user.json and pinned a registry-prefixed feature ref will collide on the first run after `user.json` adds a default for the same short ID.

### Relationship to recent reports

- 2026-05-05-prebuild-tag-collision-incident.md (prebuild base image tag collision across projects sharing a `FROM`).
  Layer: prebuild image cache.
  Phase: `devcontainerUp`.
  Code site: `dockerfile.ts:116-140` (`generateTag`) and `prebuild.ts:206-254` (cache-hit branch).
- 2026-05-05-prebuild-cache-system-options.md (RFP-driven design exploration for the above).
- This report (feature short-ID collision in template resolution).
  Layer: devcontainer.json template resolution.
  Phase: `templateResolution`.
  Code site: `user-config-merge.ts:54-76` (merge granularity) and `template-resolver.ts:131-147` (collision check).

The two incidents are independent failures in independent code paths.
They share a thematic root: lace identifies "things" (prebuild images, features) by one key in one place and a different key in another, with no reconciliation.
Whether to address them under one design umbrella is a meta-question for the prebuild-cache RFP author.
This report does not block or merge with that workstream.

## Resolution Applied

clauthier's `.devcontainer/devcontainer.json` was rewritten to mirror the minimal pattern used by `whelm` and `backup`:
- Project layer keeps only project-specific entries: `lace-fundamentals` (for git/sshd/dotfiles/screenshots/authorized-keys) and `opencode` (the project's reason for existing).
- Removed `anthropics/claude-code` (replaced by user-layer `weftwiseink/claude-code`).
- Removed `git`, `sshd`, `wezterm-server` explicit refs. `lace-fundamentals` brings in git and sshd via `dependsOn`. wezterm-server's `authorized-keys` mount conflicts with `lace-fundamentals/authorized-keys` on `/home/node/.ssh/authorized_keys` and is unnecessary for an opencode project.
- Removed `customizations.lace.mounts` redeclaration of `bash-history`, `claude-config`, `claude-config-json`. The user.json default plus `weftwiseink/claude-code`'s auto-injection covers claude mounts. bash-history was project-only and removable.
- Removed `customizations.vscode.settings` (`workspace-layout.ts` auto-injects `git.repositoryScanMaxDepth: 2` for `bare-worktree` projects).

`lace validate` now passes.
Container has not yet been brought up, per user request to defer that to the prebuild-cache agent's work.
The remaining warning (`relativeworktrees` git extension) is non-fatal and is addressed by `lace-fundamentals`'s `dependsOn: ghcr.io/devcontainers/features/git:1` once the user pins `version: latest` if desired.

## Recommendations

### Immediate (clauthier)

The minimization fix is in place. No further action.

### Short-term (lace, low risk)

Modify `mergeUserFeatures` to dedupe at short-ID granularity:
- When a project-layer feature has the same short ID as a user-layer feature with a different full ref, drop the user-layer entry and emit an info-level warning naming both refs.
- Document this behavior in the user-config docstring: "user-layer features yield to project-layer features that share a short ID."

This converts the latent collision into a benign default-override.
It does not change behavior for any project where user-layer and project-layer agree on the full ref (the common case).

### Short-term (lace, error-message quality)

The current `buildFeatureIdMap` error suggests a "local feature wrapper" remediation that is rarely the correct response.
Improve the message to distinguish two cases:
1. Both refs come from the merged user+project set with the user-layer entry being the loser.
   Suggest: "remove the user-layer entry from `~/.config/lace/user.json` features, or update the project to use the same registry."
2. Both refs come from the project set itself.
   Suggest: the existing local-wrapper guidance.

### Structural (lace, design)

A short-ID-aware merge layer raises the question of whether the user-config feature merge should be aware of feature *categories* (e.g., "claude-code is a singleton role").
Two adjacent design questions:
- Should `customizations.lace.features` accept role-based aliases (`claude-code: { ref: "ghcr.io/...", ... }`) so the role is explicit?
- Should the prebuild metadata cache embed the short ID so the merge layer can dedupe without fetching metadata?

These are out of scope for this report but worth surfacing to the user-config workstream.

## Out of Scope

- Whether the prebuild-cache work absorbs this fix or treats it independently.
- Migration guidance for other projects (whelm, backup, weftwise) - none currently pin registry-prefixed refs that collide with `user.json`, but a corpus check is prudent before shipping the merge change.
- The `wezterm-server/authorized-keys` versus `lace-fundamentals/authorized-keys` mount target overlap is a separate issue that surfaced during the minimization but was sidestepped by removing wezterm-server from clauthier. It remains live for any project that wants both.

## Evidence Trail

- Original failing run: `~/code/weft/clauthier/main/.lace/logs/2026-05-06T23-26-46-f7e82a.log`
- Resolved devcontainer.json after fix: `~/code/weft/clauthier/main/.lace/devcontainer.json`
- Source devcontainer.json after fix: `~/code/weft/clauthier/main/.devcontainer/devcontainer.json`
- User config: `~/.config/lace/user.json` (mtime 2026-03-25)
- clauthier scaffolding history: `git log --follow .devcontainer/devcontainer.json` in `/var/home/mjr/code/weft/clauthier/main`. Commits `e738630`, `d172a5f`, `67dcdc8`.
- Code sites:
  - `packages/lace/src/lib/user-config-merge.ts:54-76` (full-ref merge)
  - `packages/lace/src/lib/template-resolver.ts:131-147` (short-ID collision check)
  - `packages/lace/src/lib/template-resolver.ts:565-566` (`{...features, ...prebuildFeatures}` invocation)
