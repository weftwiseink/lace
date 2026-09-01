---
review_of: cdocs/proposals/2026-09-01-lace-up-path-fixes.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-01T14:40:00-07:00
task_list: lace/up-path-fixes
type: review
state: live
status: done
tags: [lace_up, fresh_agent, bugfix, implementation_review, runtime_validated, behavior_change]
---

# Review: lace up path-fixes implementation (impl-1, round 1)

> BLUF: Accept.
> Both bugs are fixed correctly against the live code: Bug 1 canonicalizes `workspaceFolder` once at `runUp` entry and all three identity consumers read it, with a label-guarded name teardown; Bug 2 widens the fingerprint to `features`/`build` with a fail-safe hybrid response.
> Load-bearing bits are untouched, tests are genuine (the four exclusion assertions are inverted, not deleted), and the only test failures are the pre-existing environmental port-allocator EADDRINUSE cases (ports 22430-22432 are held by the live whelm/jif/clauthier containers; the test file is byte-identical to main).
> One consequence needs the user's eyes, non-blocking to merge: shape-1's single fingerprint makes the hybrid warn+reuse apply to runtime-key drift too, so a *running* container with env/mount drift now warns+reuses instead of auto-recreating. That is a fail-safe change beyond the two bugs' scope and the user should confirm they want it (or opt into shape-2).

## Summary Assessment

impl-1 implemented both phases of the accepted proposal and surfaced one honest deviation.
I verified every success criterion against the live code and ran the suite.
The implementation is faithful, well-commented, fail-safe on every ambiguous branch, and its tests genuinely exercise the risks the round-1 review flagged (the determinism guard drives the actual build path-rewrite across three runs, not just hash stability).
The single item worth the user's attention is a structural consequence of the proposal's own shape-1 recommendation, surfaced correctly by impl-1 in the devlog, not an implementation defect.

Verdict: **Accept.** No blocking findings. One user-confirmation item and two minor non-blocking notes.

## Evidence

- **Diff surface** (`git diff main...HEAD`): source changes confined to `project-name.ts` (+`canonicalizeWorkspaceFolder`), `config-drift.ts` (RUNTIME_KEYS + `features`/`build`, comments), `commands/up.ts` (canonicalize at command entry), `up.ts` (`probeContainerRunning`, `teardownStaleContainer`, canonicalize-once, hybrid drift block, teardown wiring). Tests in `project-name.test.ts`, `config-drift.test.ts`, `up-drift-hybrid.test.ts`, `up.integration.test.ts`.
- **typecheck**: `pnpm --filter lace typecheck` exit 0.
- **build**: `pnpm --filter lace build` exit 0.
- **full suite**: 897 passed, 4 failed, 3 errors. All failures/errors are in `port-allocator.test.ts` (EADDRINUSE on 22430-22432). `ss -ltn` + `podman ps` confirm those ports are published by live containers whelm (22429-22430), clauthier (22431), jif (22432-22433). `git diff main...HEAD -- .../port-allocator.*` is empty: the file is unchanged, so these are pre-existing and environmental, not a regression.
- **relevant files**: `config-drift`, `project-name`, `up-drift-hybrid`, `up.integration` -> 139 passed, 0 failed.

## Verification Against Success Criteria

### Bug 1 (Phase 1): all criteria met

- **Canonicalize once at entry.** `canonicalizeWorkspaceFolder` (`project-name.ts:19-25`) is `realpathSync` with a `resolve()` fallback in `catch`, exactly as specified. `runUp` (`up.ts:263`) canonicalizes `rawWorkspaceFolder -> workspaceFolder` before any identity derivation, and before `new RunLog(...)`.
- **All three identity consumers read the canonical value.** Confirmed by construction: `getContainerHostPorts` (label filter), `deriveProjectName`, and `runDevcontainerUp`'s `--workspace-folder` (`up.ts:1570`) all read the single `runUp`-local `workspaceFolder`, now canonical.
- **`commands/up.ts` canonicalized too** (`commands/up.ts:66-68`), so its `isContainerRunning` post-check and debug footer agree, addressing round-1 N1 (two edit sites, not one). It canonicalizes independently rather than threading through `UpResult`, which is the acceptable resolution N1 offered.
- **Label-guarded teardown.** `teardownStaleContainer` (`up.ts:164-207`) filters `name=^<name>$` AND `label=lace.project_name=<projectName>`, tolerates a missing container (empty filter result -> early return), swallows probe/rm failure, and WARNs only when it actually removes ids. Called at `up.ts:1116-1119` only when `rebuild || recreateContainer`, after the `skipDevcontainerUp` return, targeting `resolvedContainerName` (honors user `--name` via `resolveContainerName`) with a `sanitizeContainerName` fallback.
- **Hermetic identity test** (`project-name.test.ts:108-183`) builds the symlink inside its own temp dir (no host `/home` dependency), asserts one identity across all four consumers, covers trailing-slash / `..` / non-existent-fallback / relative-input.
- **Negative label-guard test** exists (`up-drift-hybrid.test.ts:101-112`): a same-named container lacking the label yields no `rm`.

### Bug 2 (Phase 2): all criteria met

- **Fingerprint widened** (`config-drift.ts:30-41`): `features` and `build` added to `RUNTIME_KEYS`; comments renamed to "recreation fingerprint" with a NOTE recording the shape-2 `BUILD_KEYS` split as future work.
- **Hybrid response** (`up.ts:1070-1090`): on `drift.drifted`, `probeContainerRunning` (name-scoped + `status=running`) decides. `not-running` -> `recreateContainer = true` + log naming features/build/runtime. `running`/`unknown` -> `deferDriftFingerprint = true` + WARN + reuse. Fail-safe: any podman error or throw yields `unknown` -> warn path (`up.ts:130-146`).
- **Fingerprint not advanced on the deferred branch** (`up.ts:1150-1155`): `if (currentFingerprint && !deferDriftFingerprint)`, so the pending change stays detectable on the next idle run. Directly asserted by the integration test (`up.integration.test.ts:749-753`).
- **`--rebuild` still forces recreate.** Confirmed the mechanism: `--rebuild` deletes the fingerprint (`up.ts` drift block) so `checkConfigDrift` returns `drifted: false` (`config-drift.ts:135`, `previousFingerprint === null`); the probe therefore does not run on `--rebuild`, and recreate is forced via `removeExistingContainer: rebuild || recreateContainer` (`up.ts:1128`). Teardown still fires because `rebuild || recreateContainer` is true.
- **Four exclusion assertions genuinely inverted, not deleted** (`config-drift.test.ts`): features `.toBe -> .not.toBe`; build `.toBe -> .not.toBe`; the empty-vs-non-runtime test split into empty-vs-features and empty-vs-build, both `.not.toBe`; "does not report drift for non-runtime changes" inverted into two `drifted: true` cases. `forwardPorts`/`appPort` exclusion preserved by a new positive test (`:325-339`). The RUNTIME_KEYS enumeration test gains `features`/`build` (`:192-193`).
- **Determinism guard exercises the real rewrite** (`up.integration.test.ts:718-773`), addressing round-1 B2: it runs `runUp` (hence `generateExtendedConfig`'s `build.dockerfile`/`context` rewrite) twice from the same absolute path and a third time via a symlinked spelling, asserting the emitted `build` object and fingerprint are byte-identical each time and that the dockerfile is rewritten to `../.devcontainer/Dockerfile`. This is the rewrite-driving guard the round-1 review demanded, not a bare hash-twice check.
- **Hybrid branch tests stub podman** (`up-drift-hybrid.test.ts`, `up.integration.test.ts` `createMock`): every probe/teardown is a scripted stub; no live container is touched.

### Load-bearing bits: confirmed unchanged

`git diff` shows no change to `--buildkit never` (`up.ts:1564`), the `dev_container_feature_content_temp` `rm -f -a` / `rmi -f` cleanup (`up.ts:1568-1569`), the `--workspace-folder` push (`up.ts:1570`), or the `prebuildFeatures` fail-loud guard (`up.ts:319-336`). All outside the change surface.

## Adjudication of impl-1's Surfaced Deviation

**The deviation.** The proposal recommends shape-1 (one widened fingerprint) and separately frames the hybrid as "when features/build drift is detected." impl-1 correctly identified that a single stored hash cannot tell features/build drift apart from runtime-key drift, so the running-check hybrid necessarily governs *all* detected drift. Consequence: runtime-key drift (env, mounts, runArgs, remoteUser, postCreateCommand, workspaceFolder/Mount) on a **running** container now WARNs+reuses, whereas the pre-change behavior auto-recreated it. The idle path is unchanged.

**(a) Acceptable change or regression?** A fail-safe, defensible change, not a functional regression.
- It reintroduces neither bug: features/build are now detected (Bug 2 fixed), path identity is stable (Bug 1 fixed), and the idle auto-recreate path is fully preserved.
- The change is strictly *more* conservative: it never silently recreates a container that might be hosting a live session, it always WARNs, and `--rebuild` remains the explicit override.
- The prior behavior it replaces (silently recreating a *running* container on a mount/env edit) is arguably the exact live-session-disruption hazard this environment's standing directive warns against. So on the merits the new behavior is plausibly an improvement, not a loss.

**(b) Does applying the hybrid to runtime drift exceed approved scope?** Technically yes, but unavoidably so given the proposal's own shape-1 recommendation.
- The user's hybrid decision (recorded in the proposal's "Resolved Decisions" and the R1 review's B3) was explicitly about features/build. Runtime-drift-on-running semantics were never discussed.
- But "shape-1 single fingerprint" and "hybrid gated to features/build only" are mutually exclusive: you cannot separate the two drift sources from one hash. The proposal shipped a latent contradiction; impl-1 surfaced it honestly and chose the fail-safe horn (warn+reuse) rather than the disruptive horn (recreate the running container). Given the environment's live-container-safety constraint, that is the right horn to pick.

**(c) Would shape-2 be the correct fix?** Shape-2 (a separate `BUILD_KEYS` fingerprint) is the *only* way to gate the hybrid to features/build while keeping runtime-drift auto-recreate on running containers. It resolves the contradiction cleanly and preserves the established runtime-drift semantics exactly, at the cost of a second fingerprint file, a second drift check, and branch logic. The proposal explicitly deferred shape-2 as future work and recommended shape-1, and impl-1's NOTE (`config-drift.ts:19-24`) records the split as the future refactor.

**Recommendation.** Ship shape-1 as-is as the fail-safe default; it is the most defensible reading of a self-contradictory proposal and every criterion is met and tested. But the user should get a one-line heads-up on the specific consequence, because it changes a behavior neither bug covers and that the user, deciding "hybrid" about features/build, most likely did not picture: a running container with pure env/mount drift will no longer auto-recreate. If the user wants runtime-drift-on-running to keep auto-recreating, that is a fast-follow shape-2, not a blocker for this change set.

## Non-Blocking Findings

### N1. `deriveProjectName` for worktree layouts does not read the canonical path

Bug 1's canonicalization fixes the `normal-clone` path (`basename(workspacePath)`), which the hermetic test covers. For worktree/bare-repo classifications `deriveProjectName` derives the name from git metadata rather than the path spelling, so canonicalization is a no-op there. Not a defect (those layouts were never path-spelling-sensitive), but the "all identity consumers agree" claim is precisely true only for the path-derived case. Worth a one-line note; no code change needed.

### N2. The user-facing WARN text says "unknown" status in plain prose

The deferred-branch warning ("...the container is running (or its status is unknown)...", `up.ts:1084-1088`) is accurate but slightly buries that an ambiguous podman probe also lands here. Fine as-is; a future polish could distinguish "running" from "could not determine" for a sharper operator signal. Non-blocking.

## Action Items

1. [user-confirmation, non-blocking to merge] Surface to the user that shape-1 makes runtime-key drift on a *running* container warn+reuse instead of auto-recreate (a fail-safe change beyond the two bugs' scope). Confirm they accept it, or elect a shape-2 fast-follow to keep runtime-drift auto-recreate on running containers.
2. [non-blocking] Add a one-line note that canonicalization affects only path-derived (`normal-clone`) project names; worktree layouts derive identity from git metadata. (N1)
3. [non-blocking] Optionally split the deferred-branch WARN into distinct "running" vs "status unknown" wording. (N2)

## Questions for the User

1. **Runtime-drift-on-running behavior** (the deviation): do you accept the fail-safe shape-1 default (a running container with env/mount/runArgs drift warns+reuses, requiring `--rebuild` to apply), or do you want the shape-2 split so runtime drift keeps auto-recreating on running containers while only features/build get the hybrid warn?
   - (A) Accept shape-1 as-is (fail-safe, recommended: it never recreates a live container out from under a session).
   - (B) Fast-follow shape-2 (separate `BUILD_KEYS` fingerprint) to preserve runtime-drift auto-recreate on running containers.

## Verdict

**Accept.** Both bugs are fixed correctly and faithfully to the accepted proposal, load-bearing workarounds are untouched, the tests are genuine and cover the round-1 risks, and the only suite failures are pre-existing environmental port collisions on live-container ports. The one behavior consequence beyond the bugs' scope is fail-safe, honestly surfaced, and warrants a user confirmation but not a merge block.
