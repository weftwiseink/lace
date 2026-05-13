---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-06T17:31:00-07:00
task_list: lace/user-config-feature-merge
type: proposal
state: live
status: request_for_proposal
tags: [user-config, feature-merge, template-resolution, error-messaging, future_work]
---

# Short-ID-Aware User-Config Feature Merge with Project Precedence

> BLUF(opus/lace/user-config-feature-merge): Make `mergeUserFeatures` dedupe at short-ID granularity (matching `buildFeatureIdMap`'s downstream check), with project-layer entries winning, so a user-layer default like `weftwiseink/claude-code` no longer turns into a hard error when a project explicitly pins `anthropics/claude-code`.
> Motivated By: `cdocs/reports/2026-05-06-feature-id-short-id-collision-incident.md`

## Objective

Eliminate the latent class of failures where `user.json` defaults collide on short ID with project-layer feature pins.
Today, `mergeUserFeatures` (`packages/lace/src/lib/user-config-merge.ts:54-76`) dedupes by full feature ref while `buildFeatureIdMap` (`packages/lace/src/lib/template-resolver.ts:131-147`) enforces short-ID uniqueness.
Two layers, two granularities, with no reconciliation - the user-layer default survives merge as a phantom that downstream rejects with a "rename via local feature wrapper" suggestion that is rarely the right remediation.

The desired behavior: a user-layer feature should yield to a project-layer feature that shares its short ID, with an info-level warning naming both refs.
This makes `user.json` the safe place to declare "default unless overridden" without turning every project that pins a different registry into a config-error landmine.

## Scope

The proposal should cover:

- The merge algorithm change in `mergeUserFeatures`: short-ID-aware dedup with project precedence, including how to handle the case where multiple user-layer entries share a short ID (early validation versus tolerated).
- Whether the merge should warn or be silent when a user-layer entry is dropped. If warning, what level (info, warning) and how it surfaces in the lace up output.
- What the `buildFeatureIdMap` error should say when a true collision occurs after the dedup pass. The current message points to the local-feature-wrapper remedy; the post-merge collision is a project-internal problem and the message should reflect that.
- Whether `customizations.lace.features` should accept role-based aliases (`{ "claude-code": { ref: "ghcr.io/...", ... } }`) so the role is explicit in user config instead of inferred from the path segment. This is a larger design question and may belong in a follow-up proposal.
- Migration: any existing user.json or project devcontainer.json configurations in the corpus (whelm, weftwise, backup, lace itself) that would change behavior under the new merge. A corpus check should precede the merge change.

Adjacent issues surfaced during the motivating incident, scoped out unless the proposal author chooses to bundle:

- `lace-fundamentals` depends on `ghcr.io/devcontainers/features/git:1` with no `version` pin. Bookworm hosts default to git 2.39.5, which fails containerVerification when the workspace repo uses extensions like `relativeworktrees` (requires git 2.48+). The fix is either pinning `version: latest` in lace-fundamentals' `dependsOn`, or surfacing a clearer hint in the containerVerification error directing the user to add an explicit override.
- `wezterm-server` and `lace-fundamentals` both declare `authorized-keys` mounts targeting `/home/${_REMOTE_USER}/.ssh/authorized_keys`. Any project wanting both features hits a mount-target conflict. Resolution belongs in feature-side design (one feature should defer authorized_keys ownership to the other, or both should consume a shared mount declaration).

## Open Questions

- Should the user-config merge dedup happen before or after metadata fetch? Pre-fetch saves a network call when a user-layer entry is dropped, but post-fetch may be needed if dedup logic should consider feature `installsAfter` or `dependsOn` graphs.
- Is "short ID" the right canonical identity for dedup, or should lace adopt a richer feature-identity model (registry-prefixed canonical ID, role-based, etc)? Tying dedup to short ID hardcodes today's devcontainer-features convention.
- How should the dedup interact with `prebuildFeatures` versus `features` blocks? If a user-layer entry collides on short ID with a project entry in a *different* block, should it dedupe across blocks or within a block? `buildFeatureIdMap` is invoked on the cross-block union, so cross-block dedup at merge time would match downstream behavior.
- What is the right warning surface for "user-layer default suppressed by project"? Stdout line during `lace up`? Devcontainer log entry? `.lace/up-log` only? The user should know this happened without it being noisy.
- Does the proposal need to cover a deprecation/transition path for users who currently rely on the collision to detect config drift? The motivating incident suggests no users do, but the corpus check should confirm.

## Prior Art

- `cdocs/reports/2026-05-06-feature-id-short-id-collision-incident.md` (the incident that motivates this RFP, including the resolution applied to clauthier).
- `cdocs/proposals/2026-02-06-lace-feature-awareness-v2.md` (introduces the `buildFeatureIdMap` short-ID collision check; the present gap is that the user-config merge layer was added later without aligning to its dedup granularity).
- `packages/lace/src/lib/user-config-merge.ts:54-76` (current `mergeUserFeatures`).
- `packages/lace/src/lib/template-resolver.ts:131-147` (current `buildFeatureIdMap`).
- `packages/lace/src/lib/template-resolver.ts:565-566` (the `{...features, ...prebuildFeatures}` invocation site).
