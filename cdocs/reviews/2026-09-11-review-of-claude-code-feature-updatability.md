---
review_of: cdocs/proposals/2026-09-11-claude-code-feature-updatability.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-11T15:30:00-07:00
task_list: devcontainer/claude-feature-updatability
type: review
state: live
status: done
tags: [fresh_agent, devcontainer, claude-code, feature-updatability, architecture, missing_validation]
---

# Review: Claude Code Feature Updatability

> BLUF: Revision requested. The core insight is correct and the constraint reasoning is sound: relocating the npm install out of the cached build layer into a create-time lifecycle hook is the right mechanism, and it satisfies the no-restart constraint by construction. But the proposal specifies the hook as an inline `postCreateCommand: npm install -g "@anthropic-ai/claude-code@${VERSION}"`, and there is no evidence (nor in-repo precedent) that a feature-declared lifecycle-command string receives the feature's `${VERSION}` option, nor that the build-time `VERSION` env survives to create time. As written, the primary mechanism would resolve `${VERSION}` to empty and fail. Two build-to-create bridges (the version value, and a user-writable prefix) must be specified concretely, not deferred to "Phase 1 smoke-tests." Fixes are mechanical; the architecture stands.

## Summary Assessment

The proposal diagnoses the staleness precisely and grounds it well: I confirmed the two freezes it names.
The build-layer freeze is real (`install.sh` runs `npm install -g @...@latest` and lace builds via `devcontainer up --buildkit never`, whose layer cache the report at `2026-05-12-experiment-legacy-builder-cache.md` measured caching all feature install scripts), and the digest-lock freeze is real (consumers pin the OCI artifact by sha256 in `devcontainer-lock.json`).
The chosen fix, a create-time lifecycle hook that re-resolves `@latest` on every recreate, defeats the dominant freeze structurally and satisfies the "do not restart active containers" constraint for free, because create-time hooks fire only on a new container.

The most important finding is a specification gap in the exact mechanism: the inline `${VERSION}` form the proposal writes in the Proposed Solution and Phase 1 is not a valid create-time construct.
Feature options are exposed as environment variables to `install.sh` at build time only; a lifecycle-command string declared in `devcontainer-feature.json` has no guaranteed access to them.
The proposal gestures at the fix ("or an installed script the feature points that command at") but does not adopt it as the design.
Combined with the parallel gap on the install prefix (asserted as a requirement, but the feature is not specified to establish it), these make the primary mechanism under-specified enough to warrant revision before implementation.

Verdict: **Revise (revision_requested).**
The two blockers are specification-level and easily closed; the design is fundamentally sound.

## Verification Performed

I inspected the live system rather than trusting the doc.

- `devcontainers/features/src/claude-code/install.sh` and `devcontainer-feature.json`: confirmed `version` option defaults to `latest`, `install.sh` runs `npm install -g "@anthropic-ai/claude-code@${VERSION}"` as root and creates `~/.claude`. The npm global prefix is not among the declared lace mounts (only `config` and `config-json`), confirming the "install lives in the ephemeral overlay" claim.
- `packages/lace/src/lib/up.ts`: confirmed `lace-fundamentals-init` is composed into the top-level `postCreateCommand` (lines 1036-1063), `--no-cache` flows only to `fetchAllFeatureMetadata` (lines 634-635, metadata cache only), `--rebuild` sets `removeExistingContainer` (line 1259) and recreates via `--remove-existing-container`, and `--buildkit never` is hardcoded (line 1695). Every cache-flag claim in the Background is accurate.
- `packages/lace/src/lib/template-resolver.ts` and `lib/`: found NO handling of feature-declared lifecycle hooks. lace neither preserves nor strips a feature `postCreateCommand`; it passes the feature OCI ref through and the devcontainer CLI does the merge at `up` time. This makes the proposal's "must verify the CLI honors it on the `--buildkit never` path" flag genuinely load-bearing, and the flag is honest.
- `.github/workflows/devcontainer-features-release.yaml`: confirmed it publishes on push to `main` touching `devcontainers/features/src/**` via `devcontainers/action@v1` with `publish-features: true` under namespace `weftwiseink/devcontainer-features`. Republish leg is accurate.
- Prior art `2026-07-18-portless-feature-version-pin-and-ingress-durability.md`: confirmed the two-leg model, but see Blocking finding B3 (this proposal mischaracterizes the immediate leg).
- Prior art `2026-05-12-migrate-to-legacy-builder-cache.md`: confirmed the "do not reboot running jif/clauthier/weftwise containers" constraint and that the four consumers were migrated off `prebuildFeatures` to top-level `features`.
- Repo report `2026-05-06-devcontainer-features-actual-behavior.md`: the lifecycle table and, critically, the note (citing vscode-remote-release #6336) that `onCreate`/`updateContent`/`postCreate` once did NOT re-run on recreation, fixed in CLI v0.223.0. Also confirms `postCreateCommand` is intentionally never baked into a prebuild snapshot, whereas `updateContentCommand`'s result can be. This directly informs the mechanism recommendation below.
- Existing features (`sprack`, `bash-history`) that use `containerEnv`: both use static values; neither interpolates a feature option. No in-repo precedent for option substitution into feature metadata beyond `install.sh` env.

## Blocking Findings

### B1. The create-time version value is not bridged from build to create; the inline `${VERSION}` form is broken

Sections: Proposed Solution step 1, Design Decisions ("Unified `version` spec"), Phase 1.

The proposal writes the hook as `postCreateCommand` running `npm install -g "@anthropic-ai/claude-code@${VERSION}"`.
Feature options reach `install.sh` as capitalized env vars at build time.
A lifecycle-command string in `devcontainer-feature.json` runs in the container at create time and is not documented to receive feature-option substitution, and the build-time `VERSION` env is not present in the created container unless the feature persists it.
The likely runtime result is `${VERSION}` expanding to empty, yielding `@anthropic-ai/claude-code@`, an npm error, which defeats the mechanism and (given the offline-degradation requirement) would silently fall back to the baseline forever.

Fix direction: adopt the "installed script" path as the design, not an aside.
`install.sh` (root, build time, where `VERSION` is known) writes a small wrapper (for example `/usr/local/bin/claude-code-refresh`) with the resolved spec baked in, or writes the spec to a file the wrapper reads, and the feature declares `postCreateCommand: "claude-code-refresh"`.
If `containerEnv` is chosen instead, the proposal must state that feature-option interpolation into `containerEnv` is verified (no in-repo precedent exists) before relying on it.
The "unified `version` spec across build and create" decision only holds once this bridge is concrete.

### B2. The user-writable prefix is asserted as a requirement but the feature is not specified to establish it

Sections: Proposed Solution step 1, Design Decisions ("User-writable install prefix"), Edge Cases, Investigation Requested.

The design correctly identifies that `install.sh` runs as root while the create-time hook runs as the remote user, so a root-owned npm global prefix breaks the create-time reinstall.
But the proposal leaves the resolution as three mutually-exclusive open alternatives (feature imposes a user-writable prefix / rely on the remote user already owning the prefix / elevate with `sudo`) and defers all of them to a Phase 1 smoke test.
That is a design hole, not just a verification gap: an implementer cannot build Phase 1 without a chosen mechanism.

Fix direction: pick one. The portable choice consistent with B1 is for `install.sh` to create and `chown` a user-writable prefix and export it via `containerEnv` (`NPM_CONFIG_PREFIX`), so both the root build-time install and the remote-user create-time reinstall target the same location.
Then the per-consumer question ("does weftwise's node-owned `NPM_CONFIG_PREFIX` collide or cooperate with the feature-imposed one?") becomes an empirical Phase-1 check against the real four configs, which IS acceptable to defer.
Distinguish clearly: the mechanism choice is a blocker; the per-consumer empirical confirmation is an acceptable Phase-1/Phase-3 risk given the consumer repos live outside this worktree.

### B3. The "two-leg delivery, reusing the portless pattern" framing over-borrows and misdescribes the immediate leg

Sections: Summary, Design Decisions ("Two-leg delivery").

The proposal claims "The immediate leg is a consumer-side lock refresh; the durable leg is the republished artifact ... the same adjudication accepted in the portless proposal and needs no re-litigation."
That is not what portless established.
Portless's immediate, zero-republish-latency leg was a consumer-side feature `version` option OVERRIDE that `install.sh` honored at build time against the OLD locked digest.
That leg does not transfer here: the fix in this proposal is a NEW feature capability (the lifecycle hook), which does not exist in the currently locked digest and cannot be conjured by an option override.
This proposal therefore has only the durable leg, republish then lock refresh, and there is no zero-latency path.

This is blocking only as an accuracy/reasoning defect, because the invocation of "needs no re-litigation" waves past a claim that is not actually inherited.
The phase dependencies are internally consistent (Phase 4 correctly depends on Phase 2), so no logic breaks; but the framing must be corrected so an implementer does not go looking for a nonexistent immediate override leg.
Fix direction: restate delivery as single-leg (republish plus per-consumer lock refresh), and drop the claim of inheritance from the portless immediate override.

## Non-Blocking Findings and Nits

### N1. Make the lifecycle-re-run-on-recreate assumption an explicit acceptance check

The entire mechanism depends on `postCreateCommand` re-running when `--remove-existing-container` recreates the container.
The repo's own report (`2026-05-06-devcontainer-features-actual-behavior.md`, citing vscode-remote-release #6336) documents a period where lifecycle commands did NOT re-run on recreation, fixed in CLI v0.223.0.
The Verification Methodology's before/after `claude --version` across a rebuild does cover this empirically, but Phase 1 or Phase 3 should name the devcontainer CLI version floor (or assert the re-run explicitly) so a stale toolchain does not silently reintroduce the freeze the proposal is removing.

### N2. Recommendation on `postCreateCommand` vs `updateContentCommand`: choose `postCreateCommand`

The proposal leaves this open (Investigation Requested, last bullet). Recommend deciding it in favor of `postCreateCommand`, with reasoning:

- Per the repo report, `postCreateCommand` is intentionally never baked into a prebuild/content snapshot, whereas `updateContentCommand`'s result CAN be baked into a prebuilt image. Since the whole objective is to escape a cached build artifact, the hook should be the one the spec guarantees is never cached. `updateContentCommand` reintroduces exactly the "result gets baked and refrozen" failure mode if any consumer ever adopts a prebuild/snapshot path.
- lace removed its prebuild flow, so on the current `--buildkit never` recreate path the two are functionally equivalent as an update trigger; there is no `updateContent`-only phase to gain from.
- `postCreateCommand` maps 1:1 to the proposal's own mental model ("create-time hook, fires only on a new container"), keeping the design legible.
- `updateContentCommand`'s only theoretical edge (running on prebuild/update as well) is a liability here, not a benefit.

Net: `postCreateCommand`. Fold this decision into the design and delete the open question.

### N3. "Deterministic no-op" overstates the pinned-version behavior

Design Decisions and Phase 5 describe a pinned `version` as making the hook "a deterministic no-op."
It is an idempotent reinstall of the same version, not a literal no-op: it re-runs `npm install` and hits the network on every create (and is subject to the same offline-degradation path).
Minor wording; prefer "idempotent reinstall" to avoid implying the hook is skipped for pinned consumers.

### N4. The `--build-no-cache` operator escape hatch is scope-adjacent

Phase 3 proposes adding a new lace flag distinct from `--no-cache` to force-refresh the baked baseline layer.
This is reasonable and the "do NOT alter existing `--no-cache` semantics" guard is good, but it is orthogonal to the core goal (the create-time hook already keeps things current) and enlarges the change surface.
Consider splitting it to a follow-up `/cdocs:rfp` so Phases 1-2 stay minimal, or explicitly mark it optional within Phase 3. Non-blocking.

### N5. Strengths worth preserving

- The Verification Methodology is genuinely strong: reproducing the freeze first, then before/after `claude --version` across a rebuild, plus a `podman ps` on a deliberately-untouched second container as direct proof of the no-restart constraint. Keep this intact.
- The offline/non-fatal degradation requirement and the baseline-install retention are correctly reasoned.
- The active-container-last sweep ordering (jif, whelm, clauthier, weftwise) with explicit authorization for weftwise correctly mirrors the prior migration's honored constraint.
- Per-phase "Do NOT" constraints are present and specific; this is above the usual bar.

## Action Items

```
1. [blocking] B1: Replace the inline ${VERSION} hook with a concrete build-to-create version bridge: install.sh bakes the resolved spec into an installed wrapper script (or a file the wrapper reads) that the feature's postCreateCommand invokes. Make this the design, not an alternative.
2. [blocking] B2: Choose the prefix mechanism (recommended: install.sh creates/chowns a user-writable prefix and exports NPM_CONFIG_PREFIX via containerEnv so root build-time and user create-time installs share it). Keep the per-consumer empirical confirmation as an acceptable Phase-1 risk.
3. [blocking] B3: Correct the delivery framing to single-leg (republish + per-consumer lock refresh); drop the claim that a portless-style immediate consumer-side override applies here.
4. [non-blocking] N1: Add an explicit devcontainer CLI version floor / lifecycle-re-run assertion to Phase 1 or 3 acceptance.
5. [non-blocking] N2: Decide postCreateCommand (recommended over updateContentCommand for cache-safety); remove the open question.
6. [non-blocking] N3: Reword "deterministic no-op" to "idempotent reinstall."
7. [non-blocking] N4: Consider splitting the --build-no-cache escape hatch to an RFP or marking it optional.
```

## Clarifications for the Author (multiple choice)

1. Version bridge mechanism (resolves B1):
   - (a) `install.sh` writes an installed wrapper script with the spec baked in; feature `postCreateCommand` calls it. (reviewer's recommendation)
   - (b) Feature `containerEnv: { CLAUDE_CODE_VERSION: "${VERSION}" }` plus a generic hook, contingent on verifying feature-option substitution into `containerEnv` (no in-repo precedent).
   - (c) Other (specify).

2. Install-prefix strategy (resolves B2):
   - (a) Feature imposes a user-writable prefix and exports `NPM_CONFIG_PREFIX` via `containerEnv`; both installs target it. (reviewer's recommendation)
   - (b) Rely on each consumer's remote user already owning the prefix (accept per-consumer variance).
   - (c) Elevate the hook with `sudo` (assumes passwordless sudo).

3. Lifecycle hook (resolves N2):
   - (a) `postCreateCommand` (reviewer's recommendation, cache-safe).
   - (b) `updateContentCommand`.

4. Operator escape hatch (N4):
   - (a) Keep the `--build-no-cache` passthrough in Phase 3.
   - (b) Split to a follow-up RFP; keep Phases 1-2 minimal.
