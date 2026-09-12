---
review_of: cdocs/proposals/2026-09-12-feature-version-update-sweep.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-12T07:24:00-07:00
task_list: devcontainer/feature-update-sweep
type: review
state: live
status: done
tags: [fresh_agent, devcontainer, feature_versioning, dependency_pinning, missing_validation]
---

# Review: Feature Version Update Sweep (R1)

## Summary Assessment

The proposal is a well-scoped, honest attempt at the deliberately shallow unblock: bump stale feature digests, republish via the existing workflow, relock consumers, restart nothing.
The core factual claims check out against the live system: the inventory table is accurate, the release workflow triggers on `devcontainers/features/src/**` -> `main`, `claude-code` genuinely bakes `@latest` and needs a fresh digest to escape the build-layer cache, and `lace-fundamentals` 2.0.0 really was the SSH-decoupling break.
Two blocking issues stop acceptance.
First, the relock mechanism (`devcontainer upgrade --workspace-folder <consumer>`) is under-specified and, as literally written and inherited from the portless precedent, targets the wrong file: the authoritative config+lock for these consumers is `.lace/`, not `.devcontainer/`, and the two diverge in feature set for most consumers.
Second, the `lace-fundamentals` `:1` -> `:2` migration is a breaking dependency-chain change that silently removes `sshd` from 3 of 4 consumers, and the gate that is supposed to protect against that is not operationalized.
Verdict: **Revise**. The goal and the shallow framing are right; the delivery mechanism and the fundamentals scoping need to be pinned down before implementation.

## Verification Performed

Checked against the live worktrees, not just the doc:

- Inventory table (source versions, tool pins, locked `:N`): confirmed accurate for all 7 features. `claude-code` 1.0.1 with `install.sh` running `npm install -g "@anthropic-ai/claude-code@${VERSION}"` (VERSION default `latest`); `lace-fundamentals` 2.1.0 in source, consumers locked `:1` at 1.0.2 (digest `sha256:163a6a60...`); `claude-code` `:1` locked at 1.0.1 (digest `sha256:95eabba1...`, matches the Test Plan).
- `lace-fundamentals` history: commit `4e11ac3` = "remove SSH from the default dependency chain" bumped the feature to 2.0.0 (dropped `sshd:1` from `dependsOn`); `43e330f` = `$USER` profile.d guard bumped to 2.1.0. Framing is correct.
- Release workflow: triggers on `devcontainers/features/src/**` push to `main`, publishes namespace `weftwiseink/devcontainer-features` with `permissions: packages: write`. Correct.
- Cache-digest claim: cross-checked against `2026-09-11-claude-code-feature-updatability.md` and the `2026-05-12-experiment-legacy-builder-cache.md` report it cites. The legacy builder caches the feature-install layer; a same-digest rebuild never re-resolves `@latest`; a new digest changes the layer cache key and forces `install.sh` to re-run. The proposal's claim holds.
- Consumer configs and locks read directly for jif, whelm, clauthier, weftwise (see findings below).

## Blocking Findings

### B1. The relock command targets `.devcontainer/`, but the authoritative config+lock is `.lace/` (systemic, not weftwise-only)

This is the most important finding and it undercuts the whole delivery mechanism.

Evidence from the live system:

- `lace up` builds with `--config <consumer>/.lace/devcontainer.json` (`packages/lace/src/lib/up.ts:1679`, `args.push("--config", extendedPath)` where `extendedPath` is `.lace/devcontainer.json`). The devcontainer CLI reads and writes the lock adjacent to the `--config` it is given, so the lock that lace's build actually consumes is `.lace/devcontainer-lock.json`.
- jif, clauthier, and whelm have **only** `.lace/devcontainer-lock.json`; there is no `.devcontainer/devcontainer-lock.json`. weftwise is the only consumer with both.
- The on-disk `.devcontainer/devcontainer.json` and `.lace/devcontainer.json` **diverge in feature set**. For example clauthier's `.devcontainer/devcontainer.json` references only `opencode`, `git`, `lace-fundamentals` and does **not** reference `claude-code`, `blesh`, or `neovim` at all, while its `.lace/devcontainer.json` references the full set. whelm's `.devcontainer/devcontainer.json` references only `lace-fundamentals` and `portless`.

Consequence: `devcontainer upgrade --workspace-folder <consumer>` with no `--config` reads `.devcontainer/devcontainer.json` and writes/creates `.devcontainer/devcontainer-lock.json`. For clauthier and whelm that config does not even mention `claude-code`, so the command **cannot relock the feature the sweep exists to refresh**, and it writes a lock the build never consumes. The sweep would run green and deliver nothing.

This is almost certainly what already happened with the portless precedent: weftwise's `.devcontainer/devcontainer-lock.json` shows portless `1.0.1` (the relock target) while its `.lace/devcontainer-lock.json` still shows portless `1.0.0`. The proposal cites this divergence as a weftwise quirk, but it is actually evidence that the inherited relock command wrote a non-authoritative lock. The problem generalizes to every leg.

**Fix:** Specify the relock command as `devcontainer upgrade --workspace-folder <consumer> --config <consumer>/.lace/devcontainer.json` (or whatever `lace`-native invocation resolves the extended config), and add a Phase-1 step to confirm, per consumer, which lock file lace's build consumes. Re-verify the portless precedent's own relock landed in `.lace/`, since the evidence says it did not. Reframe "weftwise dual lock files" as an instance of this systemic authority question, not a weftwise-specific one.

### B2. The `lace-fundamentals` `:1` -> `:2` migration silently drops `sshd` from 3 of 4 consumers; the gate is not operationalized

The proposal correctly identifies `:2` as the one non-mechanical, behavioral change and gates it on the consumer being "already SSH-decoupled at the config level." But that condition is never defined, and the live data shows the gate matters for most consumers:

- Every consumer's `lace-fundamentals:1` lock entry carries `dependsOn: [sshd:1, git:1]`, so today all four pull `sshd` transitively through fundamentals.
- Direct `sshd:1` declaration in `.lace/devcontainer.json`: **jif declares it directly**; **clauthier, whelm, and weftwise do not**.

So migrating clauthier, whelm, or weftwise to `:2` removes `sshd` from their effective feature set entirely, landing on the next rebuild. That is exactly the kind of behavioral change a "shallow sweep" is defined to exclude. jif is safe because it declares `sshd` itself.

Whether SSH *should* go away is the decoupling workstream's call (and MEMORY suggests SSH is being deprecated in favor of `podman exec`), but "eventually intended" is not the same as "safe to land silently via a lock refresh in a sweep whose contract is no-behavior-change."

**Fix:** Either (a) defer the `:2` migration entirely to the SSH-decoupling workstream and leave fundamentals at `:1` in this sweep, or (b) operationalize the gate concretely: a consumer is eligible for `:2` only if it declares `sshd:1` directly (or is confirmed not to need it), and record per-consumer that migrating does not drop `sshd`. Per current data that admits only jif; the other three would defer. Recommend (a) for cleanliness of the shallow contract, (b) if fundamentals currency is truly in scope.

## Non-Blocking Findings

### N1. `claude-code` `@latest` framing is slightly imprecise
The inventory table lists the tool pin as `@anthropic-ai/claude-code@latest`. `install.sh` actually installs `@${VERSION}` with the feature option `version` defaulting to `latest`, so it is an overridable default, not a hard pin. Cosmetic; the functional conclusion is unchanged.

### N2. The scratch-build verification proves less than the user scenario
Phase 4's scratch/dry build runs against a **cold** cache, so it proves "new digest installs a current CLI." It cannot demonstrate the actual user scenario, a **warm**-cache rebuild where the changed digest busts the `claude-code` layer, because the no-restart constraint forbids touching the real environment. That layer-bust claim rests on the updatability report's empirical cache model, not a direct test. This is inherent to the constraint and acceptable, but the proposal should state that the warm-rebuild re-resolution is established by reference, not by the scratch build.

### N3. Excluded `portless` is itself stale on two consumers
whelm's `.lace` lock pins portless feature `1.0.0` and weftwise's `.lace` lock pins `1.0.0`, both predating the `1.0.1` republish that delivered the 0.15.3 ingress-durability pin durably (jif is on `1.0.1`; clauthier does not use portless). The "do NOT touch portless" exclusion is defensible for this sweep, but it leaves two consumers on the pre-fix portless feature digest. Flag this for the portless workstream rather than silently exclude it.

### N4. Scratch `lace up` and the cross-project port ledger
`up.ts` coordinates ports via a shared ledger lock (`withLedgerLock`). A disposable `lace up` into a scratch copy gets a distinct project name and container, so risk is low, but Phase 4 should note the scratch build must not contend for or mutate the real consumer's ledger entry.

### N5. Investigation Requested triage
- GHCR push auth: effectively already answered. The workflow declares `packages: write` and the portless NOTE cites a green publish run to `weftwiseink`. Downgrade from "blocks Phase 2" to "confirm the prior run pattern still holds." Not a blocker.
- `lace-fundamentals` 2.1.0 publish state: a genuine prerequisite for the `:2` leg, Phase-1 resolvable by a GHCR check. Not a proposal blocker but must gate Phase 3's fundamentals migration.
- weftwise authoritative lock: subsumed by B1; resolve systemically.
- whelm accessibility: trivial, path confirmed to exist. Phase-1.
- neovim/blesh currency: correctly deferred to a Phase-1 online check.

## Verdict

**Revise.**

The proposal is factually sound, honestly scoped, and reuses a real precedent. It is not a reject: the shallow framing is correct and the fixes are bounded. But B1 (relock targets the wrong file) means the sweep as written could report success while delivering nothing to the files lace actually builds from, and B2 (fundamentals `:2` drops `sshd` from three consumers behind an undefined gate) risks smuggling a breaking change into a no-behavior-change sweep. Both must be resolved before implementation.

## Action Items

1. [blocking] B1: Specify the relock as `devcontainer upgrade --config <consumer>/.lace/devcontainer.json` (or the lace-native equivalent) and add a Phase-1 step confirming, per consumer, which lock file lace's build consumes. Re-verify the portless precedent actually relocked `.lace/`.
2. [blocking] B1: Reframe the "weftwise dual lock files" item as an instance of the systemic `.lace/` vs `.devcontainer/` authority question affecting all four consumers, not a weftwise-only quirk.
3. [blocking] B2: Either defer the `lace-fundamentals` `:1` -> `:2` migration to the SSH-decoupling workstream, or operationalize the gate as "consumer declares `sshd:1` directly (or is confirmed not to need it)." Per current data only jif qualifies.
4. [non-blocking] N1: Reword the `claude-code` tool-pin cell as an overridable `version` option defaulting to `latest`.
5. [non-blocking] N2: State that the warm-rebuild re-resolution is established by reference to the cache report, not by the cold-cache scratch build.
6. [non-blocking] N3: Note that whelm and weftwise sit on portless feature `1.0.0` (pre-durability-fix) and hand that loose end to the portless workstream.
7. [non-blocking] N4: Add a note that the scratch `lace up` must not contend for the real consumer's port-ledger entry.
8. [non-blocking] N5: Downgrade GHCR push auth from blocker to confirmation; keep the 2.1.0 publish-state check as a Phase-3 gate for the fundamentals leg.

## Clarifications for the Author (please pick)

**C1. Fundamentals `:2` scope (drives B2):**
- (a) Defer `:2` entirely to the SSH-decoupling workstream; this sweep leaves fundamentals at `:1`. (recommended for a clean shallow contract)
- (b) Keep `:2` in scope but gate strictly on direct `sshd:1` declaration; migrate only jif now, defer the rest.
- (c) Keep `:2` for all consumers and accept the `sshd` drop as intended decoupling. (not recommended without the decoupling workstream's sign-off)

**C2. Relock authority (drives B1):**
- (a) Standardize on `--config .lace/devcontainer.json` for all consumers and treat any `.devcontainer/*-lock.json` as legacy cruft to optionally clean up.
- (b) Investigate whether a lace-native relock should exist before proceeding (heavier; likely out of shallow scope).
