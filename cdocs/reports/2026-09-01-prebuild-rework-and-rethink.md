---
first_authored:
  by: "@claude-sonnet-5-20251101"
  at: 2026-09-01T00:00:00-07:00
task_list: devcontainer-decoupling/prebuild-rethink
type: report
state: live
status: review_ready
tags: [prebuild, architecture, future_work]
---

# Prebuild: Source Mutation Complaint and the Standing Removal Question

> BLUF: Both questions this report was asked to resolve were already answered by an accepted, `implementation_ready` proposal that this codebase has not finished executing.
> **Q1 (remove prebuild?): Yes.** [`2026-05-12-migrate-to-legacy-builder-cache.md`](../proposals/2026-05-12-migrate-to-legacy-builder-cache.md) is accepted (R2, 2026-05-05) and empirically validated: the legacy builder's local layer cache gives a 15x warm-build speedup (234s cold / 16s warm on weftwise), and the original cache-busting bug that motivated prebuild was fixed upstream in devcontainer-CLI 0.83.0.
> Deleting prebuild also deletes the FROM-rewriting mutation this report was asked to fix, for free, because the non-mutating design is a side effect of removal, not a separate feature to build.
> **The actual finding is that this migration stalled after Phase 2.** Weftwise was migrated on 2026-05-13 (warm build 20.4% of cold, under the 30% pass bar); no other project, including lace's own `.devcontainer/devcontainer.json`, has moved off `prebuildFeatures`, and Phase 4 (code deletion) has not started, three-plus months later.
> `packages/lace/src/lib/{prebuild,dockerfile,restore,status,metadata,lockfile}.ts` are all still present and load-bearing today.
> Recommendation: **resume the existing proposal at Phase 3, do not author a new one.** Section "Work Breakdown" below is that proposal's phases, re-scoped to what remains.

- Prior work this report synthesizes: [`2026-05-05-rfp-rethink-prebuild-cache.md`](../proposals/2026-05-05-rfp-rethink-prebuild-cache.md), [`2026-05-05-prebuild-cache-system-options.md`](2026-05-05-prebuild-cache-system-options.md), [`2026-05-05-prebuild-tag-collision-incident.md`](2026-05-05-prebuild-tag-collision-incident.md), [`2026-05-06-prebuild-original-rationale.md`](2026-05-06-prebuild-original-rationale.md), [`2026-05-06-prebuildfeatures-removal-impact-analysis.md`](2026-05-06-prebuildfeatures-removal-impact-analysis.md), [`2026-05-06-empirical-test-upstream-feature-cache.md`](../proposals/2026-05-06-empirical-test-upstream-feature-cache.md) (superseded), [`2026-05-12-migrate-to-legacy-builder-cache.md`](../proposals/2026-05-12-migrate-to-legacy-builder-cache.md), [`2026-05-13-migrate-weftwise-to-legacy-builder.md`](../devlogs/2026-05-13-migrate-weftwise-to-legacy-builder.md).

## Context / Background

Two complaints motivated this report:

1. **Source mutation.** `lace prebuild` rewrites the user's tracked `Dockerfile` `FROM` line (or `devcontainer.json` `image` field) to `lace.local/<base-image>:<tag>`, and requires a manual `lace restore` before committing.
   `packages/lace/README.md:407` documents this explicitly: "After building, lace rewrites the Dockerfile FROM or `image` field to point at it. Use `lace restore` before committing to revert the rewrite."
   This is unusual for a dev tool to do to version-controlled source and was flagged as "bad."
2. **A standing note**, `rethink_prebuild`, asking whether the whole mechanism should be deleted now that "the underlying bug was fixed."

Both questions turn out to be the same question, already investigated in depth in May 2026 by a five-week cdocs workstream (RFP -> options report -> historical-rationale audit -> source-impact analysis -> two empirical tests -> an accepted migration proposal -> one migrated project). This report's job was to independently verify that chain and determine whether it still holds, then recommend a path. It does hold; the gap is that the codebase never finished acting on it.

## Current State: Exactly How Prebuild Mutates Source

- `packages/lace/src/lib/dockerfile.ts:116-140` (`generateTag`): derives the cache tag **solely from the original `FROM` image**, e.g. `lace.local/node:24-bookworm`. Feature set is not part of the tag. This is the root cause of the 2026-05-05 cross-project collision (below).
- `packages/lace/src/lib/dockerfile.ts:182-199` (`rewriteFrom`): rewrites the first `FROM` line in-place, byte-preserving everything else.
- `packages/lace/src/lib/prebuild.ts:370-379` (`runPrebuild`, Step 7): after a successful `devcontainer build`, calls `writeFileSync` directly on the user's `Dockerfile` (or `devcontainer.json`, via `rewriteImageField`) to point `FROM`/`image` at the `lace.local/*` tag. The cache-hit "reactivation" path does the same write at `prebuild.ts:228-243`.
- `packages/lace/src/lib/restore.ts` (`runRestore`, `restoreDockerfile`/`restoreImage`, lines 60-152): the inverse `writeFileSync`, invoked by the separate `lace restore` subcommand. It derives the original `FROM` by parsing the `lace.local/*` tag back out (`parseTag`), falling back to `.lace/prebuild/metadata.json` if that fails.
- `packages/lace/src/lib/up.ts:945-1030` wires `runPrebuild` into the `lace up` pipeline (guarded by `hasPrebuildFeatures` at line 421) *before* `devcontainer up`, so every `lace up` on a project with `prebuildFeatures` mutates tracked source as a side effect of a routine command.
- `packages/lace/README.md:732-744` codifies the resulting workflow: users are told to add `.lace/` to `.gitignore` and to run `lace restore` "before committing (if using prebuilds)": the mutation is a known, documented, permanent tax on every commit touching a devcontainer config.

### The collision bug (the "underlying bug" in the standing note)

[`2026-05-05-prebuild-tag-collision-incident.md`](2026-05-05-prebuild-tag-collision-incident.md) documents a real production incident: two projects (`whelm`, `weftwise`) both build `FROM node:24-bookworm` with different `prebuildFeatures` sets. Because `generateTag` keys only on the base image, both bake to the identical tag `lace.local/node:24-bookworm`, and whichever project rebuilds last silently overwrites the other's image. `whelm`'s next `lace up` ran the wrong project's feature set and failed at `postCreateCommand` with `lace-fundamentals-init: not found` (exit 127): a working container that was silently unprovisioned.
This is a structural flaw in the tag identity scheme, not a one-off. [`2026-05-05-prebuild-cache-system-options.md`](2026-05-05-prebuild-cache-system-options.md) enumerates the fix space in full (its Axis A, "tag identity") and finds every in-scheme fix (per-project tag, content-hashed tag) trades cost or complexity for correctness with no clean answer: one of the inputs that tipped the eventual recommendation toward removing the scheme entirely rather than patching it.

## Q1: Should Prebuild Be Removed? Yes, and It Was Already Decided

This is not an open design question this report needs to adjudicate; it is a decision this codebase already made and partially executed.

**The chain of evidence:**

1. [`2026-05-06-prebuild-original-rationale.md`](2026-05-06-prebuild-original-rationale.md): the original case for prebuild (`2026-01-30-packages-lace-devcontainer-wrapper.md`) was "thin and unfalsifiable": one hypothetical sentence ("can add minutes"), one uncited "90+ seconds" claim, zero measurements, zero comparison against alternatives (`postStartCommand`, runtime install, manual `RUN`). The recollection that features were "cache-busted overly aggressively" is not what the original proposal argued; it argued features simply weren't cached at all pre-prebuild.
2. The devcontainer-CLI cache-busting bug (`devcontainers/cli#313`) that prebuild worked around was substantially fixed upstream by 2023's PR #382 and fully addressed for feature paths in CLI 0.83.0 (Jan 2026): this is the "underlying bug" the standing note refers to, and it is confirmed fixed.
3. [`2026-05-06-prebuildfeatures-removal-impact-analysis.md`](2026-05-06-prebuildfeatures-removal-impact-analysis.md): source-level audit found prebuild is "broad but shallow": six lace-owned files delete outright, `up.ts`/`template-resolver.ts` strip cleanly, and `customizations.lace.{mounts,ports,workspace,validate,repoMounts}` all work identically whether a feature sits in `features` or `prebuildFeatures`. The one real entanglement (asymmetric `appPort` injection for `wezterm-server`'s `hostSshPort`) is now moot: `wezterm-server` was deleted from lace's feature tree (per the migration proposal's initial-scoping NOTE), and the 2026-05-13 weftwise devlog confirms the regular ports allocator already handles the equivalent case via `lace-fundamentals`'s `sshPort` metadata with no lace-side extension needed.
4. Two upstream-cache replacement paths were empirically tested. [`2026-05-06-empirical-test-upstream-feature-cache.md`](../proposals/2026-05-06-empirical-test-upstream-feature-cache.md) (BuildKit + `BUILDKIT_INLINE_CACHE` + registry `cacheFrom`) was ruled **infeasible**: `containers/buildah#6503` corrupts `/tmp` permissions under rootless podman's `RUN --mount=type=bind` at every feature-install layer, and neither `chmod 1777 /tmp` alone, fuse-overlayfs, nor a podman 5.6 downgrade fixed it. The legacy builder (`--buildkit never`, already lace's flag) is structurally immune because it uses `COPY --from` instead. [`2026-05-12-experiment-legacy-builder-cache.md`](2026-05-12-experiment-legacy-builder-cache.md) measured it directly on weftwise: cold build 234s, warm build 16s, 15x speedup, 57/63 instruction steps cached, all seven feature install scripts cached.
5. [`2026-05-12-migrate-to-legacy-builder-cache.md`](../proposals/2026-05-12-migrate-to-legacy-builder-cache.md) turns that result into a proposal: delete `lace prebuild` entirely, keep `--buildkit never` (durably load-bearing for the `#6503` workaround) and the pre-existing `dev_container_feature_content_temp` cleanup (a separate, unrelated caching bug), and let the legacy builder's local layer cache do the job prebuild used to do. **Status: `implementation_ready`, accepted at Round 2 (2026-05-05 review timestamp, reviewed after the R1 revision).**

The collision bug this report was asked to weigh disappears as a side effect of this recommendation (no shared `lace.local/*` tag exists post-removal), not because a separate fix was applied to it.

**On the source-mutation complaint specifically:** the migration proposal's post-deletion pipeline never rewrites the Dockerfile or `devcontainer.json` at all: `devcontainer up --buildkit never` runs directly against the user's file as authored, with feature install happening at ordinary `devcontainer up` time and cached by podman's own layer store. There is no `lace.local/*` tag, no `FROM` rewrite, no `lace restore` step, because there is no separate bake phase to reference. **Q2 (the non-mutating design) is therefore not a live design problem under the recommended path: it is resolved by deletion, not by a parallel "keep prebuild but stop it mutating source" redesign.** See "Q2" below for why a keep-but-fix branch was evaluated and rejected as the wrong target of effort.

### What this recommendation costs

Not free. The migration proposal itself is honest about two real prices, and this report adds a third (state of stall):

1. **Cross-machine and cross-project image sharing are forfeited.** The legacy builder's cache is local-only, per (project, machine) pair. The proposal's options-report ancestor ([`2026-05-05-prebuild-cache-system-options.md`](2026-05-05-prebuild-cache-system-options.md)) frames this explicitly as acceptable *because sharing was "coincidence, not goal" for a solo-dev audience*, not because sharing doesn't matter in general.
2. **One user-facing behavioral change**: features now install *after* the user's Dockerfile `ENV`/`RUN` directives, not before (prebuild's install-before-user-Dockerfile ordering was an emergent property of the flow, not a designed guarantee). The validating experiment found exactly one real conflict (weftwise's `NPM_CONFIG_PREFIX` vs. the `node` feature's nvm install), remediated by moving the ENV to `containerEnv`. This is a per-project migration cost, not a structural blocker, but it is not zero.
3. **The migration has been dormant since 2026-05-13.** See next section: this is new information from this report's own verification, not carried over from the May corpus.

## Migration Status: Stalled at Phase 2 of 7

This is the most important operational finding in this report and was not something the May 2026 corpus could know, since it postdates all of it.

Checked directly against the current tree (2026-09-01, `main` @ `61ec1ec`):

- `packages/lace/src/lib/prebuild.ts`, `dockerfile.ts`, `restore.ts`, `status.ts`, `metadata.ts`, `lockfile.ts` and `packages/lace/src/commands/{prebuild,restore,status}.ts` **all still exist and are wired into `up.ts`** (`hasPrebuildFeatures` gate at `up.ts:421`, `runPrebuild` call at `up.ts:963`). None of Phase 4's deletions have happened.
- **Lace's own `.devcontainer/devcontainer.json` still declares `customizations.lace.prebuildFeatures`** (`lace-fundamentals`, `git`, `rust`, `./features/sprack`): the project has not even dogfooded its own accepted proposal (Phase 7).
- `git log` shows only one project migrated: weftwise, on 2026-05-13 ([`2026-05-13-migrate-weftwise-to-legacy-builder.md`](../devlogs/2026-05-13-migrate-weftwise-to-legacy-builder.md)), with results that cleared the proposal's own pass bar (warm build 20.4% of cold, vs. a <30% requirement). That devlog's own "Verification gaps surfaced" section flags container-side SSH and in-container tool functionality as **not actually exercised end-to-end**: the migration passed on wall-clock and `lace validate` output, not on a live SSH/tool smoke test.
- The commit that landed the entire May cdocs corpus (`b7290248` "prebuild rethink claudin", 2026-05-13) touched `prebuild.ts` and `up.ts` by only 11 and 14 lines respectively: consistent with landing the weftwise-migration-adjacent groundwork, not with any part of Phase 4's code deletion.
- Two later commits (`4e868ed`, `1162b99`) touch unrelated portless/lifecycle work; nothing since 2026-05-13 references prebuild removal.

**Read plainly: the decision was made, validated on real hardware against the heaviest real project in the ecosystem, and then the work stopped**, not because it failed, but because Phases 3 (remaining-project migration) and 4 (code deletion) were never picked back up. The mutation this report was asked to fix has therefore been live and un-remediated in production for over three months after the fix was already designed, reviewed, and partially proven.

## Q2: If Prebuild Were Kept, How Would It Stop Mutating Source? (Evaluated, Not Recommended)

Given Q1's answer, this section exists to satisfy the requested analysis and to document why a parallel "keep prebuild, fix the mutation" track is not worth building alongside the resume-migration path, not because the design is bad, but because it duplicates work the deletion already subsumes.

If a keep-but-fix branch were pursued (e.g., because Phase 3/4 hit an unexpected blocker and the org needed a stopgap), the shape would be:

- **Reference the cache image only from the generated config, never from tracked source.** Lace already generates `.lace/devcontainer.json` and hands it to `devcontainer up` (`up.ts` `generateConfig` phase, `packages/lace/README.md:19`). The prebuild tag could be injected into that generated config's `build.dockerfile`/`image` field the same way ports and mounts are already injected, instead of via `writeFileSync` onto the user's own `Dockerfile`. The user's tracked `Dockerfile`/`devcontainer.json` would never be touched; `lace restore` would become structurally unnecessary because there is nothing to restore.
- **Surface the base image identity as a Dockerfile `ARG` for humans, not as a rewritten `FROM`.** The user's stated idea: something like `ARG LACE_BASE_IMAGE=node:24-bookworm` (or a comment/label) that a person can read to know what's actually running and how to rebuild by hand, decoupled from lace's internal cache key. This solves the "docs/rebuild" need without lace ever mutating the `FROM` line to point at a cache artifact.
- **Namespace the `lace.local/*` tag** to eliminate the collision class independent of the mutation fix: per-project (`lace.local/<projectName>/<image>:<tag>`) is the cheapest structural fix per [`2026-05-05-prebuild-cache-system-options.md`](2026-05-05-prebuild-cache-system-options.md) Axis A2, though that report's own recommendation explicitly steers away from investing further in the tag-identity axis at all ("Lens 2… under 'best design by default' the right move is to reconsider the model itself, not refine its identity scheme").

**Why this report does not recommend building this:** every piece of it (generated-config-only referencing, no `lace restore`, no `lace.local/*` namespace) is achieved automatically and for free by finishing the already-accepted removal proposal. Building a parallel non-mutating prebuild would mean doing real engineering work (rerouting the tag through `.lace/devcontainer.json`, adding an `ARG` injection mechanism, redesigning tag namespacing) to preserve a caching mechanism whose own removal proposal already passed review and already forfeits the one thing (cross-project sharing) that Q2's design would have partially preserved. That is strictly more work for a worse outcome than resuming Phase 3.

The one scenario where Q2's design becomes load-bearing: if Phase 3/4 uncovers a project where the legacy builder's local-cache-only, forfeit-cross-machine-sharing model is genuinely unacceptable (not yet observed in any of the seven surveyed projects). In that case Q2's sketch is the fallback shape, not the destination.

## Risks and Open Questions

- **Verification debt inherited from the weftwise migration.** Container-side SSH and in-container tool functionality were never smoke-tested post-migration (devlog's own "Verification gaps surfaced" section). Any resume-work should close this gap before treating weftwise as a template for the remaining projects, or a second silent regression (structurally similar to the original collision incident) could ship.
- **`sshd:1`'s post-migration necessity is unresolved.** The weftwise devlog flags that `sshd:1` is no longer declared anywhere after the flip, and whether the container-side sshd daemon (distinct from `lace-fundamentals`' authorized-keys mount) is still needed is an open item the devlog itself defers.
- **Cache-hygiene under partial edits was never measured** (late-Dockerfile-edit / early-Dockerfile-edit / `COPY . .`-bust scenarios): only cold-vs-warm was captured. A regression here would surface as "warm builds got slow again" with no diagnostic trail, since lace's `up` command suppresses `devcontainer build`'s verbose cache-hit output (noted in the weftwise devlog as a follow-up need, possibly a `--verbose` flag).
- **This report cannot independently re-verify the empirical timing claims** (234s/16s on weftwise, 130s/26.5s on the actual migration): they are taken from the cited experiment report and devlog, not re-run as part of this analysis. If hardware or podman/buildah versions have drifted since May, a spot re-check before resuming Phase 3 is cheap insurance.
- **Portless integration and the container-side wezterm-server-equivalent service are explicitly out of scope** for the initial migration per its own scoping report and remain a follow-up workstream, not something this report's recommendation resolves.

## Recommendations / Work Breakdown

**Do not author a new proposal.** [`2026-05-12-migrate-to-legacy-builder-cache.md`](../proposals/2026-05-12-migrate-to-legacy-builder-cache.md) is accepted and its Phase 1 (wezterm-server port handling) is moot by subsequent feature deletion, and Phase 2 (weftwise) is done. Resume at Phase 3.

1. **Close the weftwise verification gap** (small, precedes further migration). SSH into the migrated weftwise container at its allocated port; confirm `nu`, `nvim`, `claude` are on `PATH` and functional; resolve whether `sshd:1` needs to be re-declared. Success criteria: the three items in the weftwise devlog's "Verification gaps surfaced" section are closed and documented.
2. **Phase 3 - survey and migrate remaining projects** (per the proposal's own Phase 3, unchanged): survey all `~/code/*/main` and worktree devcontainer configs for `prebuildFeatures`, migrate each (`backup`, `clauthier`, `dotfiles`, `whelm`, and lace's own `.devcontainer/devcontainer.json`), applying the same env-order-conflict audit weftwise needed. Success criteria: every surveyed project's `lace up` works with `prebuildFeatures` removed; no `lace.local/*` images created during any of their builds.
3. **Phase 4 - lace code deletion** (per the proposal's own Phase 4, unchanged, ~800-1000 LoC source + 200-300 LoC tests): delete `commands/{prebuild,restore,status}.ts` and `lib/{prebuild,restore,status,dockerfile,metadata,lockfile}.ts`; strip the enumerated branches from `up.ts`, `template-resolver.ts`, `validation.ts`, `user-config-merge.ts`, `user-config.ts`, `devcontainer.ts`, `index.ts`. Do this on a branch, gated behind Phase 5's test pass, not incrementally on `main`. Success criteria: build passes; `BUILDAH_LAYERS=false` appears nowhere in source; no `prebuildFeatures` references remain.
4. **Phase 5 - test surface update** (per proposal): delete the seven prebuild-only test files, trim the eight partially-prebuild test files, add the one new "warm build < 30% of cold" cache-reuse scenario. Success criteria: full suite green on the post-deletion binary.
5. **Phase 6 - documentation update** (per proposal): rewrite `docs/prebuild.md` as a migration note, strip `README.md`'s prebuild sections and example config, add the migration section to `docs/migration.md`.
6. **Phase 7 - dogfood and ship** (per proposal, currently blocking on step 2 above since lace's own config still uses `prebuildFeatures`): migrate lace's own devcontainer, run the full suite, verify all three flagship projects (lace, weftwise, whelm) on the post-deletion binary, then run the one-time cleanup (`podman rmi lace.local/*`, `rm -rf .lace/prebuild` per project).

If a genuine blocker surfaces during Phase 3 that makes local-cache-only unacceptable for some project, fall back to the Q2 sketch above (generated-config-only tag reference, `ARG`-for-docs, per-project tag namespace) as a stopgap for that project specifically, not as a reason to restart the whole rethink from scratch.
