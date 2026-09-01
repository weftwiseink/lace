---
review_of: cdocs/proposals/2026-09-01-lace-up-path-fixes.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-01T13:04:25-07:00
task_list: lace/up-path-fixes
type: review
state: live
status: done
tags: [lace_up, fresh_agent, bugfix, test_plan, architecture, runtime_validated]
---

# Review: lace up path canonicalization and feature/build drift detection

> BLUF: Accept-with-revisions.
> Both root causes are correct and verified line-by-line against the code, and both fixes are structurally sound.
> Two blocking gaps: the Test Plan enumerates only two of the four tests that encode the Bug 2 exclusion (two more will fail after the fix and are unaddressed), and the auto-rebuild default (Open Question a) is a behavior-policy decision that needs the user's sign-off given this environment's hard "do not rebuild live containers" constraint.
> The design's honesty about the intra-run self-collision limitation is a strength, not a defect.

## Summary Assessment

The proposal fixes two independent `lace up` correctness bugs: container-identity mismatch from an un-canonicalized workspace path, and a drift fingerprint that ignores `features`/`build`.
I verified every cited file:line against the actual code; the root-cause analysis is accurate throughout.
The core fixes (one `realpathSync` at `runUp` entry; widen the hashed key set) are correct and each rides existing, load-bearing wiring without touching the retained prebuild-removal workarounds.
The proposal is unusually candid about what its fixes cannot cover (pre-existing mislabels, intra-run CLI self-collision), which is the right posture.
The weaknesses are all in the Test Plan and one unresolved policy question, not in the design.

Verdict: **Revise** (light). All blocking items are mechanical or a single user decision; none require design rework.

## Verification of Claims

### Root causes (all confirmed)

- **Bug 1 un-canonicalized path.** `commands/up.ts:66` is exactly `args["workspace-folder"] || process.cwd()`, threaded unchanged into `UpOptions`.
  `runUp` re-defaults identically (`up.ts:176`).
  The raw string reaches all three in-`runUp` identity consumers: the `devcontainer.local_folder` label filter via `getContainerHostPorts` (`up.ts:100`, called at `up.ts:644` and `:876`), `deriveProjectName` (`up.ts:283`, `:288`), and `--workspace-folder` in `runDevcontainerUp` (`up.ts:1445`).
  `deriveProjectName` (`project-name.ts:13-28`) does `basename(workspacePath)` for non-worktree layouts, so the derived name is path-spelling-sensitive.
- **Bug 2 fingerprint exclusion.** `RUNTIME_KEYS` (`config-drift.ts:17-25`) lists seven runtime keys and omits `features`/`build`; `computeRuntimeFingerprint` hashes only that subset (`config-drift.ts:44-57`).
  Confirmed the exclusion flows through `checkConfigDrift` -> `drift.drifted` (`config-drift.ts:117`) -> `recreateContainer` (`up.ts:972-973`) -> `removeExistingContainer: rebuild || recreateContainer` (`up.ts:1006`).

### Fix soundness

- **Single `realpathSync` reaches the three in-`runUp` consumers: confirmed.** Because `getContainerHostPorts`, `deriveProjectName`, and `runDevcontainerUp` all read the `runUp`-local `workspaceFolder`, canonicalizing it once at entry aligns them.
  `resolve`/`relative` are already imported (`up.ts:3`); `realpathSync` is not yet imported but is trivially addable and has precedent (`user-config.ts:283`).
- **Name-based teardown is feasible and targets the right resource.** `resolveContainerName` is already imported (`up.ts:58`) and honors user `--name` (`project-name.ts:61-77`).
  The name is the resource that actually collides (`up.ts:1364-1366` pushes `--name <sanitized>`), so teardown-by-name is the correct complement.
- **Fingerprint widening rides existing wiring: confirmed.** No new plumbing needed; `drift.drifted` already reaches `--remove-existing-container`.

### Retained load-bearing bits are untouched: confirmed

`--buildkit never` (`up.ts:1439`), the `dev_container_feature_content_temp` `rm`/`rmi` cleanup (`up.ts:1443-1444`), and the `prebuildFeatures` fail-loud guard (`up.ts:237-254`) are all outside the change surface of both fixes.
The proposal's explicit "do not tidy these" constraint (Constraints section) is well-placed.

### Determinism

The `build.dockerfile`/`context` rewrite (`up.ts:1265-1286`) uses `relative(laceDir, resolve(devcontainerDir, ...))`, both pure path functions.
For a byte-identical source config and fixed `workspaceFolder`, the rewritten `build` object is deterministic, so the spurious-drift risk is real only if an input path's absolute-vs-relative form changes between runs.
The risk is genuine but low; see blocking finding B2 for why the proposed guard does not actually exercise it.

## Blocking Findings

### B1. Test Plan misses two of the four tests that encode the Bug 2 exclusion

The proposal says only `config-drift.test.ts:96-106` and `:108-118` "assert the bug" and names `:175-191` for the enumeration update.
Two more tests also encode the exclusion and **will fail** once `features`/`build` are hashed, yet are unlisted:

- `config-drift.test.ts:136-143` ("produces same hash for empty config and config with only non-runtime keys") asserts `fp({})` equals `fp({ features, build })`. After the fix these differ.
- `config-drift.test.ts:261-271` ("does not report drift for non-runtime property changes") writes a fingerprint, adds `features`, and asserts `drifted: false`. After the fix this becomes `true`.

An implementer following the Test Plan literally will hit two unexpected red tests.
The plan must enumerate all four bug-encoding tests and specify the intended post-fix behavior for each (`136-143` should split into a features-differ and a build-differ case; `261-271` should invert to assert drift).

### B2. The determinism guard does not exercise the risk it names

The Test Plan's determinism guard is "a byte-identical generated config hashed twice yields an identical fingerprint."
That only re-tests `sortedStringify` hash stability, already covered by `config-drift.test.ts:29-58`.
The risk the proposal itself raises (`up.ts:1265-1286` rewrite flipping the `build` hash across runs) lives in the path-rewrite step, not the hash step.
To actually guard it, the test must run the rewrite (or `generateExtendedConfig`) twice from the same source config and assert the emitted `build` object is byte-identical, then fingerprint both.
As written, the guard would pass even if the rewrite were non-deterministic.
Either strengthen the guard to cover the rewrite, or downgrade the stated risk to "low: rewrite is pure" and drop the claim that the test pins it.

### B3. Open Question (a) auto-rebuild-vs-warn needs the user's decision, not the implementer's

This is a tool-behavior policy call, and this environment carries a hard constraint that raises the stakes: four production containers (weftwise, clauthier, jif, whelm) must never be rebuilt, and the operator's standing directive is to avoid disrupting live sessions.
Auto-rebuild on any `features`/`build` edit means a plain `lace up` (often run to re-attach) can now trigger an unrequested image rebuild.
The proposal's reasoning for auto-rebuild (correctness first, mirrors `--rebuild`) is sound in the abstract, but the blast-radius here is a live-session-disruption question the maintainer should own.
Recommend the user explicitly picks auto-rebuild vs warn-only before Phase 2 lands.
See Recommendations for my leaning.

## Non-Blocking Findings

### N1. "Single realpathSync" is slightly overstated: `commands/up.ts` needs its own canonicalization

`commands/up.ts` computes its own `workspaceFolder` (`:66`) and reuses it for the `isContainerRunning` post-check (`:17`, `:116`) and the debug footer (`:132`).
`runUp`'s internal canonicalization does not reach these, and `UpResult` does not currently expose the canonical value, so "reuse the canonical value that `runUp` already resolved" requires either adding the resolved path to `UpResult` or canonicalizing independently in `commands/up.ts`.
The proposal acknowledges this and Phase 1's success criteria list `commands/up.ts:17`, so it is captured, but the "single" framing undersells that it is two edit sites.
Impact if missed: the `containerMayBeRunning` failure annotation (consumed by lace-into) returns a false negative when the container is canonically labeled but the command-level path is raw. Low severity, worth naming precisely.

### N2. Name-teardown from within `runDevcontainerUp` needs projectName/extendedConfig plumbed

`runDevcontainerUp` currently receives only `workspaceFolder` (`up.ts:1396-1402`); it has neither `projectName` nor the extended config to feed `resolveContainerName`.
The teardown either needs those passed in, or must re-read `.lace/devcontainer.json` for `runArgs`.
Minor, but the proposal's code sketch implies the resolved name is readily in hand where it is not.

### N3. Intra-run self-collision coverage claim is correctly hedged

The proposal does not overclaim: it states name-teardown mitigates a prior-run survivor but cannot interpose if the devcontainer CLI issues a second `podman run --name` within a single invocation (Edge Cases; Open Question c).
This matches reality: teardown runs once before `devcontainer up` (`up.ts:1443-1448` region), so a within-CLI double-run is out of reach.
No change needed; flagging that the honest framing is correct and should be preserved verbatim in the devlog.

## Recommendations on the Open Questions

### (a) Auto-rebuild vs warn: escalate to the user; my leaning is warn-first, then auto-rebuild

I recommend the user decide (B3).
My leaning: given the environment's live-container-safety constraint, ship **warn-only as the conservative default is defensible**, but the proposal's auto-rebuild is the more correct end state.
A middle path worth offering the user: auto-rebuild, but keep the explicit recreation log line the proposal already commits to (`up.ts:972-983` extension) so the rebuild is never silent.
The deciding factor is whether the operator considers "a config edit followed by `lace up`" an unambiguous rebuild intent. That is their call, not the implementer's.

### (b) Name-teardown blast radius: yes, require a matching `lace.project_name` label

I recommend gating `podman rm -f` on the target container also carrying `lace.project_name=<projectName>` (or the resolved name).
This is strictly safer and does not lose coverage: lace stamps `--label lace.project_name=<name>` on every container it creates (`up.ts:1362`), so both the stale-`/home`-labeled survivor and the CLI's own intra-run container carry it.
The only case the label-guard excludes is a container that holds the name but was **not** created by lace, which lace should never destroy.
This is implementer-actionable (no user sign-off needed) and I would fold it into Phase 1's success criteria.

### (c) Intra-run CLI self-collision: file a lightweight upstream note, do not block on it

The name-teardown mitigation covers the observed failure pictures; the residual within-CLI double-run is rare and upstream-owned.
A short upstream report is worth filing for traceability, but this work should not depend on it.
Implementer/maintainer-actionable.

## Action Items

1. [blocking] Enumerate all four Bug 2 exclusion tests in the Test Plan, including `config-drift.test.ts:136-143` and `:261-271`, and specify each one's intended post-fix assertion. (B1)
2. [blocking] Rework the determinism guard to exercise the `build` path-rewrite (`up.ts:1265-1286`) across two runs, or downgrade the stated risk and drop the claim that the current guard pins it. (B2)
3. [blocking] Obtain the user's decision on auto-rebuild vs warn-only for Bug 2 before Phase 2 lands; wire the explicit recreation log line either way. (B3)
4. [non-blocking] State plainly that Bug 1 requires edits at two sites (`runUp` entry and `commands/up.ts`), and specify the mechanism to share the canonical value (expose it on `UpResult` or canonicalize in `commands/up.ts`). (N1)
5. [non-blocking] Note that `runDevcontainerUp` needs `projectName`/extended config plumbed (or a re-read) to resolve the teardown name. (N2)
6. [non-blocking] Adopt the `lace.project_name` label-guard on name-teardown and add it to Phase 1 success criteria. (Open Question b)

## Questions for the User

1. **Bug 2 default behavior** (blocks Phase 2):
   - (A) Auto-rebuild on any `features`/`build` edit, with an explicit recreation log line (proposal's recommendation, most correct).
   - (B) Warn-only: log that a rebuild is needed and reuse the container until `--rebuild` (most conservative given live-container safety).
   - (C) Auto-rebuild, but only when no other lace-managed container for the project is currently running (hybrid).
2. **Name-teardown safety**: adopt the `lace.project_name` label-guard before `rm -f` (my recommendation, safer, no coverage loss), or keep the simpler name-only teardown the proposal sketches?
