---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-01T00:00:00-07:00
task_list: lace/up-path-fixes
type: proposal
state: archived
status: implementation_accepted
last_reviewed:
  status: accepted
  by: "@claude-opus-4-8"
  at: 2026-09-01T13:45:00-07:00
  round: 1
tags: [lace_up, bugfix, architecture]
---

# lace up: path canonicalization and feature/build drift detection

> BLUF: `lace up` has two independent correctness bugs.
> (1) Container identity is derived from an un-canonicalized workspace path, so a `/home` vs `/var/home` symlink mismatch makes `--remove-existing-container` miss the stale container and the follow-up `podman run --name` collides.
> (2) The drift fingerprint keys only on runtime properties, so editing `features` or `build.*` reuses the stale container with no rebuild and no warning.
> Fix (1) by realpath-canonicalizing `workspaceFolder` once at the entry of `runUp`, so every downstream consumer of container identity agrees.
> Fix (2) by adding `features` and `build` to the fingerprint so a features/`FROM` change auto-recreates.
> Two phases, shipped together.

## Summary

Both bugs live in the `lace up` path and are verifiable directly against the code.

Bug 1 is a path-identity bug: `runUp` accepts `workspaceFolder` verbatim from `process.cwd()` or `--workspace-folder` and threads that exact string into three identity-bearing places: the `devcontainer.local_folder` label filter (`up.ts:100`, `commands/up.ts:17`), the `devcontainer up --workspace-folder` argument (`up.ts:1445`), and, transitively, the container name via `projectName`.
On a host where `/home` symlinks to `/var/home`, two invocations from paths that differ only by that symlink produce two different container identities, so `--remove-existing-container` fails to match the survivor and the subsequent `podman run --name <project>` collides.

Bug 2 is a drift-coverage bug: `computeRuntimeFingerprint` (`config-drift.ts:17-25,44-57`) hashes only `RUNTIME_KEYS` (containerEnv, mounts, workspaceMount, workspaceFolder, runArgs, remoteUser, postCreateCommand).
It deliberately excludes `features` and `build`, so a features or Dockerfile `FROM` edit does not flip `drift.drifted`, and `lace up` reuses the old container.

The two fixes are independent and each is small, but they share the `lace up` verification surface, so they ship together across two phases.
A hard constraint governs verification: four production containers (weftwise, clauthier, jif, whelm) are running and must not be rebuilt.
All verification uses throwaway fixtures.

## Objective

Make `lace up` behave correctly on the two axes where it currently misleads the user:

1. A first `lace up` after any config change must not fail with a container-name collision and then silently "self-heal" on the next run.
2. A `features` or `build` change must cause `lace up` to rebuild (or at minimum loudly refuse to reuse), rather than silently reusing a stale container.

## Background

### How the up/rebuild path works today

`runUp` (`up.ts:174`) runs a long pipeline: config read, workspace-layout classification, host validation, user-config merge, feature-metadata fetch, template resolution, extended-config generation, drift check, then `devcontainer up`.
Two outputs of that pipeline carry container identity:

- **Project name / container name.**
  `deriveProjectName` (`project-name.ts:13`) takes the workspace classification plus `workspaceFolder` and returns a repo basename.
  `generateExtendedConfig` (`up.ts:1360-1368`) sanitizes it and appends `--name <sanitized>` plus `--label lace.project_name=<name>` to `runArgs`, unless the user already set `--name`.

- **The devcontainer `local_folder` label.**
  The devcontainer CLI stamps `devcontainer.local_folder=<--workspace-folder>` on the container it creates.
  lace both reads this label (to find owned host ports at `up.ts:98-101`, and to answer "is a container running?" at `commands/up.ts:15-19`) and relies on the CLI's own use of it for `--remove-existing-container` matching.

The drift phase (`up.ts:950-990`) reads the generated `.lace/devcontainer.json`, computes `checkConfigDrift`, and sets `recreateContainer = drift.drifted`.
`runDevcontainerUp` (`up.ts:1407`) then passes `--remove-existing-container` when `rebuild || recreateContainer` (`up.ts:1006`).
On success, the new fingerprint is persisted (`up.ts:1030-1032`).

### Load-bearing bits that must not regress

`runDevcontainerUp` (`up.ts:1439-1444`) retains two deliberate workarounds that must stay intact:
`--buildkit never` (podman `/tmp` mode bug, cross-referenced in the code comment), and the pre-run cleanup of the `dev_container_feature_content_temp` image and its containers (stale `COPY --from` layers under BuildKit-never).
The fail-loud guard on the removed `customizations.lace.prebuildFeatures` key (`up.ts:237-254`) must also remain: it surfaces an actionable migration error instead of silently dropping features.
Neither fix touches these; this proposal calls them out so an implementer does not "tidy" them away.

### Environmental precondition for Bug 1

On this Fedora atomic host, `/home` is a symlink to `var/home` (confirmed: `/home -> var/home`).
`realpathSync` is already used as canonicalization precedent in `user-config.ts:283` (`resolveSourceForPolicy`).

## The Two Bugs

### Bug 1: container-name collision from `/home` vs `/var/home` path canonicalization

**Symptom.**
The first `lace up` (no `--rebuild`) after a config change fails with:

```
Error: creating container storage: the container name "<project>" is already in use ... use --replace
```

exit 1, `failedPhase: devcontainerUp`.
Yet a healthy container is left running, and a subsequent `lace up` reuses it and exits 0.
`--rebuild` sidesteps the failure entirely.
Observed evidence: an old `jif` container carries label `devcontainer.local_folder=/home/mjr/code/weft/jif/main` while current lace resolves the same tree to `/var/home/mjr/code/weft/jif/main`.

**Confirmed root cause (from the code).**
`workspaceFolder` is never canonicalized.
`commands/up.ts:66` sets it to `args["workspace-folder"] || process.cwd()` and passes it through unchanged; `runUp` (`up.ts:176`) defaults the same way.
That exact string becomes:
- the `--remove-existing-container` match key, via `devcontainer up --workspace-folder <workspaceFolder>` (`up.ts:1445`), which the CLI matches against the stored `devcontainer.local_folder` label;
- the label filter lace itself queries (`up.ts:100`, `commands/up.ts:17`).

When the stored label is `/home/mjr/...` and the current invocation resolves to `/var/home/mjr/...`, the two never match.
`--remove-existing-container` finds nothing to remove, then the CLI's `podman run --name <project>` hits the surviving `/home`-labeled container, which already holds that name.

> NOTE(claude-opus-4-8/lace/up-path-fixes): There is a second, subtler collision path noted in the bug report: the devcontainer CLI's two-pass feature resolution can `podman run --name <project>` twice within a single invocation and self-collide even without a stale-label survivor.
> Canonicalization does not address that intra-run case.
> See "Edge Cases" for why a name-based teardown is the belt-and-suspenders complement.

### Bug 2: runtime fingerprint ignores feature/build changes

**Symptom.**
After editing `devcontainer.json` `features` or the Dockerfile `FROM`, a plain `lace up` exits 0 in about one second, reusing the OLD container: no rebuild, no warning.
Only `--rebuild`, or a ports/mounts/env change, triggers a rebuild.

**Confirmed root cause (from the code).**
`RUNTIME_KEYS` (`config-drift.ts:17-25`) lists only runtime-affecting properties and deliberately omits `features` and `build`.
`computeRuntimeFingerprint` (`config-drift.ts:44-57`) hashes only that subset, so a `features`- or `build`-only change yields an identical fingerprint, `drift.drifted` stays false, `recreateContainer` stays false, and the container is reused.
The existing tests even assert this exclusion (`config-drift.test.ts:96-118`), so the tests encode the bug as intended behavior and must be updated alongside the fix.

## Proposed Solution

### Bug 1: canonicalize `workspaceFolder` once, at the entry of `runUp`

**Primary approach.**
Realpath-canonicalize `workspaceFolder` a single time at the top of `runUp`, before any identity is derived, and use the canonical value everywhere downstream.

```ts
// up.ts, first lines of runUp, before the try/RunLog:
const rawWorkspaceFolder = options.workspaceFolder ?? process.cwd();
let workspaceFolder: string;
try {
  workspaceFolder = realpathSync(rawWorkspaceFolder);
} catch {
  workspaceFolder = resolve(rawWorkspaceFolder); // non-existent path: fall back, let a later phase fail loudly
}
```

Rationale: a single canonical source eliminates the entire class of path-aliasing mismatches (symlinks, `..` segments, trailing slashes, relative inputs), not just `/home` vs `/var/home`.
Because `deriveProjectName`, the label filter, and `--workspace-folder` all read the same canonical string, they cannot disagree.
`realpathSync` is the established canonicalization primitive in this codebase (`user-config.ts:283`).
`commands/up.ts` also constructs a `label=devcontainer.local_folder=${workspaceFolder}` filter (`commands/up.ts:17`) for its `isContainerRunning` post-check; canonicalize there too, or (cleaner) have it reuse the canonical value that `runUp` already resolved.

> NOTE(claude-opus-4-8/lace/up-path-fixes): Node's `process.cwd()` already returns a symlink-resolved physical path, so the pure-cwd invocation is usually canonical on its own.
> The mismatch is introduced by (a) an explicit `--workspace-folder /home/...` argument, and (b) containers created by an older lace or a raw devcontainer invocation that stamped a `/home` label.
> Canonicalizing our side makes the current run agree with a canonically-labeled container; it cannot retro-fix a container already mislabeled `/home/...`.
> That residual is handled by the name-based teardown below and by a one-time migration note.

**Complementary approach (recommended, small): name-based teardown before create.**
Because a stale container can carry a non-canonical label that no amount of our-side canonicalization will match, add a name-based removal when we intend to recreate.
When `rebuild || recreateContainer`, before `devcontainer up`, remove any container already holding the target name, but only when it also carries lace's own `lace.project_name` label matching this project:

```
# resolve the exact name via resolveContainerName(projectName, extendedConfig) (project-name.ts:61)
# only tear down if the existing container is one lace created for THIS project
podman ps -aq --filter name=^<resolvedContainerName>$ --filter label=lace.project_name=<projectName> \
  | xargs -r podman rm -f
```

lace stamps `lace.project_name` on every container it creates (`up.ts:1362`), so this label guard loses no coverage of lace-managed containers while refusing to delete an unrelated container that merely shares the sanitized name.
This closes the stale-label survivor case and the intra-run self-collision (the name is the resource that actually collides) without the blast radius of an unconditional `rm -f` by name.

**Rejected / secondary alternatives.**

- *Rely on `--replace` semantics.*
  The error text suggests `--replace`, but the devcontainer CLI does not expose a passthrough for podman's `--replace`, and `runArgs` injection of `--replace` is brittle and changes create semantics for every run.
  Canonicalization plus name teardown is more targeted.
- *Canonicalize only inside `deriveProjectName`.*
  Insufficient: the label filter and `--workspace-folder` would still use the raw path, so the fix must live at the single entry point, not one derivation.
- *Match/remove the existing container by our own `lace.project_name` label instead of the CLI's `local_folder` label.*
  Viable and worth noting, but it duplicates identity logic the CLI already owns and does not help the intra-run case.
  Name-based teardown is simpler and covers both.

**Tradeoff.**
The `lace.project_name` label guard makes teardown safe against an unrelated same-named container: lace only removes containers it created for this project.
The residual sharp edge is narrow (a container a user manually stamped with lace's label), so a WARN in the implementation when a teardown actually fires is still warranted for traceability.

### Bug 2: include `features` and `build` in the fingerprint

**Decided approach: hybrid, warn a live session and auto-rebuild an idle one.**
Add `features` and `build` to the fingerprinted subset so a change flips `drift.drifted`, then branch on whether the project's container is currently running:

- **Container running:** do NOT recreate it.
  Emit a clear warning naming features/build as the changed trigger and reuse the container, so an in-flight session is never rebuilt out from under the user.
- **No running container (fresh, stopped, or removed):** proceed through the existing `recreateContainer` -> `--remove-existing-container` path so the change is applied automatically.

Detect "running" with a name-scoped `podman ps --filter name=<resolvedContainerName> --filter status=running` (the same resolved name Bug 1's teardown targets).
Treat any podman error conservatively as "not clearly running" and fall through to the warn path rather than rebuilding: never rebuild on an ambiguous signal.

> NOTE(claude-opus-4-8/lace/up-path-fixes): This hybrid is the user's decision, chosen over both always-auto-rebuild and always-warn.
> Rationale: the actual bug is the *silent* no-op, and the hybrid fixes the silence in both states (an idle container is corrected automatically, a live one is loudly flagged) without ever disrupting a running session.
> `lace up --rebuild` remains the explicit override that rebuilds regardless of running state.

Fingerprint shape, two options:

1. Extend `RUNTIME_KEYS` with `"features"` and `"build"`.
   Simplest, but conflates "runtime-affecting" (needs only container recreate) with "image-affecting" (needs an image rebuild).
   The current `recreateContainer` path already passes `--remove-existing-container`, which recreates the container and, with the retained cleanup, rebuilds the image, so a single fingerprint is behaviorally sufficient today.
2. Introduce a separate `BUILD_KEYS = ["features", "build"]` and a second fingerprint, so the code distinguishes "recreate container" from "rebuild image."
   Cleaner separation and future-proof if lace ever wants a lighter recreate that skips image rebuild, but more surface area.

Recommendation: shape (1) for this fix (extend the hashed set), with a NOTE pointing at shape (2) as the refactor if a recreate-vs-rebuild split is ever needed.
Rename the concept in comments from "runtime fingerprint" to "recreation fingerprint" to match the widened meaning; keep the file/function names to avoid churn, or rename with a NOTE.
Extend the existing recreation log line ("Runtime config changed; container will be recreated." at `up.ts:972-983`) to name features/build as the trigger on the auto-rebuild branch, and add the distinct warn line for the running-container branch.

**Risk: over-triggering rebuilds.**
The fingerprint is computed over the *generated* `.lace/devcontainer.json`, which lace mutates every run (port allocation, mount injection, `lace.project_name` label, `CONTAINER_WORKSPACE_FOLDER`, `LACE_DOTFILES_PATH`, dockerfile/context path rewrites at `up.ts:1257-1286`).
`features` and `build` are comparatively stable, but the `build` object specifically has its `dockerfile` and `context` rewritten to be relative to `.lace/` on every run (`up.ts:1265-1286`).
If those rewrites are ever non-deterministic (for example, an absolute vs relative input path that resolves differently across invocations), the `build` hash would flip spuriously and rebuild every run.
The regression tests must pin this down (see Test Plan): a byte-identical config across two runs must produce a stable fingerprint.

## Important Design Decisions

- **Canonicalize at one choke point, not per-derivation.**
  Container identity has three consumers; fixing them independently invites the next drift.
  A single `realpathSync` at `runUp` entry is the invariant.
- **Keep the CLI's `local_folder` label as the source of truth, add a label-guarded name safety net.**
  Do not reimplement the CLI's container matching.
  Canonicalization aligns our input to the CLI; the `lace.project_name`-guarded name teardown covers what canonicalization structurally cannot (pre-existing mislabels, intra-run self-collision) without deleting a container lace did not create.
- **One fingerprint, widened.**
  Recreate already implies image rebuild on this path, so a second fingerprint is premature.
  Note the split as future work.
- **Hybrid drift response: warn a live session, auto-rebuild an idle one.**
  The bug is the silent no-op; the hybrid removes the silence in both states while honoring the standing "never disrupt a live container session" constraint.
  `--rebuild` stays the explicit override for a running container.

## Edge Cases / Challenging Scenarios

- **Pre-existing `/home`-labeled container.**
  Our-side canonicalization alone will not match it.
  Name-based teardown removes it on the next recreate; document a one-time `podman rm -f <name>` for users who hit it before upgrading.
- **Intra-run double `podman run --name`.**
  The CLI's two-pass feature resolution can self-collide within one invocation.
  Name teardown before create mitigates; if the CLI itself issues the second `run`, teardown cannot interpose, and this remains a known upstream limitation to flag.
- **Non-existent `--workspace-folder`.**
  `realpathSync` throws; fall back to `resolve()` so a later phase produces the real, actionable error rather than masking it with a canonicalization stack trace.
- **User-supplied `--name` in `runArgs`.**
  `resolveContainerName` already honors it; name teardown must target the resolved name, not the sanitized project name, so a custom `--name` is respected.
- **Spurious build-hash drift.**
  Covered under Bug 2 risk; the determinism regression test is the guard.
- **Fingerprint of a config that fails to generate.**
  The drift phase already swallows read errors (`up.ts:984-989`) and skips fingerprint writes; widening the key set does not change that path.

## Test Plan

All unit tests are pure and use temp dirs or in-memory fixtures.
No test may invoke `podman`/`devcontainer` against the four live containers.

### Bug 1 regression tests (container-identity, no live-symlink dependency)

Add a path-canonicalization-invariant identity test that does not depend on a real `/home` symlink at test time.
Construct the symlink inside the test's temp dir so the test is hermetic:

- Create `tmp/real/proj` and a symlink `tmp/link -> tmp/real`.
- Assert that the canonicalized identity derived from `tmp/link/proj` equals the identity from `tmp/real/proj`: same canonical `workspaceFolder`, same `deriveProjectName`, same resolved container name, same `devcontainer.local_folder` filter string.
- Cover trailing-slash and `..`-segment inputs resolving to the same identity.
- Assert the fallback: a non-existent path canonicalizes via `resolve()` without throwing.

This isolates the invariant (aliased paths yield one identity) from the host's actual `/home` layout.

### Bug 2 regression tests (fingerprint coverage)

Extend `config-drift.test.ts`:

- **Rewrite every assertion that currently encodes the exclusion.**
  Four sites in `config-drift.test.ts` assert today that `features`/`build` do NOT drift and will fail after the fix; all four must be inverted or removed, not just the first two: `:96-106` (features excluded), `:108-118` (build excluded), `:136-143`, and `:261-271`.
  Audit the file for any other case asserting features/build stability before landing.
- **features-only change marks drift.**
  Two configs identical except `features` (for example `:1` vs `:2`) must produce different fingerprints, and `checkConfigDrift` must report `drifted: true`.
- **build/FROM-only change marks drift.**
  Two configs differing only in `build.dockerfile` (and separately a Dockerfile-content proxy such as `build.args`) must produce different fingerprints and `drifted: true`.
- **Determinism guard against the `build` path rewrite (not just hash stability).**
  The risk is specifically that `up.ts:1265-1286` rewrites `build.dockerfile`/`build.context` to paths relative to `.lace/` on every run.
  The test must drive that rewrite twice from the same workspace input (absolute and relative spellings, and a symlinked path) and assert the resulting `build` object, and therefore the fingerprint, is byte-identical across runs.
  A plain "hash the same object twice" check does not exercise the rewrite and does not pin this risk.
- **Existing runtime-key coverage preserved.**
  The `RUNTIME_KEYS` change-detection test (`config-drift.test.ts:175-191`) still passes; add `features`/`build` to the enumerated set it iterates.
- **Port derived-state still ignored.**
  `forwardPorts`/`appPort` remain excluded (`config-drift.test.ts:153-173`) so port reallocation does not rebuild.
- **Hybrid branch coverage.**
  Unit-test the running-vs-idle decision: given features/build drift, a "container running" signal yields warn-and-reuse (no `--remove-existing-container`), and a "not running" signal yields recreate. Stub the podman `ps` probe; do not touch a live container.

## Verification Methodology

The implementer must produce, for each bug, at least one concrete "failure picture" from a throwaway fixture, then show it resolved after the fix.
Never target weftwise, clauthier, jif, or whelm.

**Fixture.**
Create a scratch workspace (for example under the scratchpad dir) with a minimal `.devcontainer/devcontainer.json` and a trivial Dockerfile, and a throwaway project name that cannot collide with the four live containers.
Prefer `--skip-devcontainer-up` for pipeline-level assertions that do not need a real container; use a genuinely disposable container name only where an actual `devcontainer up` is required, and `podman rm -f` it explicitly afterward.

**Bug 1 failure picture (before the fix).**
From the fixture, run `lace up` once via a path spelled `/home/...` to seed a `/home`-labeled container (or fabricate the label directly on a throwaway container with `podman run --label devcontainer.local_folder=/home/...`), then run `lace up` again via the `/var/home/...` spelling.
Capture the `Error: ... container name "<project>" is already in use ... use --replace`, exit 1, `failedPhase: devcontainerUp`, and the surviving healthy container.
After the fix: the second run canonicalizes, the name teardown removes the survivor, and `lace up` exits 0 with no collision.

**Bug 2 failure picture (before the fix).**
From the fixture, `lace up` to create the container and persist a fingerprint, then edit `features` (or the Dockerfile `FROM`) and `lace up` again.
Capture the ~1s exit-0 reuse with no rebuild log line.
After the fix: the second run logs the features/build-triggered recreation and rebuilds.

**Unit-level verification.**
`npm test` (or the package's vitest invocation) for `config-drift.test.ts` and `project-name.test.ts` must pass, including the rewritten Bug 2 assertions and the new hermetic Bug 1 identity test.

## Implementation Phases

Bug 1 and Bug 2 are independent and are separate phases, shipped together in one change set.
Neither phase modifies `runDevcontainerUp`'s `--buildkit never`, the `dev_container_feature_content_temp` cleanup, or the `prebuildFeatures` fail-loud guard.

### Phase 1: Path canonicalization + name-based teardown (Bug 1)

Success criteria:
- `workspaceFolder` is realpath-canonicalized once at `runUp` entry, with a `resolve()` fallback for non-existent paths.
- All three identity consumers (label filter at `up.ts:100`/`commands/up.ts:17`, `--workspace-folder` at `up.ts:1445`, `deriveProjectName`) read the canonical value.
- On `rebuild || recreateContainer`, a label-guarded name teardown runs before `devcontainer up`: it removes the container holding the `resolveContainerName` result (honoring user `--name`) only when that container also carries `label=lace.project_name=<projectName>`, and tolerates "no such container".
- Hermetic Bug 1 identity test passes (temp-dir symlink, no dependency on the host `/home`).
- A test asserts the teardown does NOT remove a same-named container lacking the `lace.project_name` label.
- WARN callout in code fires when a teardown actually removes a container.

Dependencies: none.

### Phase 2: Widen the recreation fingerprint (Bug 2)

Success criteria:
- `features` and `build` are included in the fingerprinted subset.
- A features-only and a build/FROM-only change each mark `drift.drifted: true`.
- Hybrid response: when features/build drift is detected, a running container is warned-and-reused (no `--remove-existing-container`) while an idle/absent one is auto-recreated; the running check is a name-scoped podman `ps` probe that fails safe to warn.
- The recreation log line names features/build as the trigger on the auto-rebuild branch; a distinct warn line covers the running-container branch.
- Determinism guard test passes, exercising the `build` path rewrite (not just hash stability): identical workspace input yields a byte-identical `build` object and fingerprint across runs.
- All four exclusion-encoding `config-drift.test.ts` assertions (`:96-106`, `:108-118`, `:136-143`, `:261-271`) are rewritten; `forwardPorts`/`appPort` exclusion preserved.
- Comment/naming updated to reflect the widened meaning (or a NOTE explaining the retained "runtime" name), with the separate-`BUILD_KEYS` split recorded as future work.

Dependencies: none on Phase 1; both land together.

### Constraints (what NOT to change)

- Do not remove or reorder `--buildkit never` or the `dev_container_feature_content_temp` `rm`/`rmi` cleanup in `runDevcontainerUp` (`up.ts:1439-1444`).
- Do not weaken the `prebuildFeatures` fail-loud guard (`up.ts:237-254`).
- Do not rebuild or `rm` weftwise, clauthier, jif, or whelm during verification; use throwaway fixtures and disposable container names only.
- Do not reimplement the devcontainer CLI's container matching; align inputs to it and add the name-based safety net only.

## Resolved Decisions (round 1 review)

- **Bug 2 drift response: hybrid (warn a live session, auto-rebuild an idle one).**
  Decided by the user over both always-auto-rebuild and always-warn.
  Implemented via a name-scoped running-container probe that fails safe to warn.
- **Name-teardown blast radius: require a matching `lace.project_name` label.**
  Adopted from the round-1 review: teardown removes only containers lace created for this project, with zero coverage loss (lace stamps that label at `up.ts:1362`).
- **Intra-run CLI self-collision: mitigate now, report upstream as a non-blocking follow-up.**
  The label-guarded name teardown covers the common case; where the second `podman run` originates inside the devcontainer CLI, file a lightweight upstream note for traceability.
  This does not block the fix.
