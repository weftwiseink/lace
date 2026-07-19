---
review_of: cdocs/proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-07-18T19:40:00-07:00
task_list: portless/ingress-durability
type: review
state: live
status: done
tags: [fresh_agent, portless, devcontainer, networking, dependency_pinning, rollout, runtime_validated]
---

# Review: Portless Feature Version Pin and Ingress Durability

> BLUF: The diagnosis is correct and the core decision (pin the version, do not build a bridge) is sound; I re-verified the load-bearing upstream facts against the npm tarballs and they hold (0.15.4 is vercel-labs, loopback-binding; 0.15.3 is bare wide `listen`).
> One blocking gap makes the proposal not-yet-actionable as written: it treats "change the `version` default in the feature source, then rebuild" as the delivery path, but the feature is consumed as a **published OCI artifact** (`ghcr.io/weftwiseink/devcontainer-features/portless:1`) that consumers pin by digest in `devcontainer-lock.json`.
> A source edit is inert until the feature is re-published (which needs a feature-package `version` bump and a merge to `main`) **and** each consumer refreshes its lock to the new digest.
> As written, the Phase 1 acceptance test ("fresh rebuild, relay-free host 200") will still return 502 on `mirror-rearch`, because that worktree's lock pins `portless@sha256:0e77c8…` (a pre-fix digest whose baked-in metadata still says `version: latest`).
> Verdict: **Revise** - add a publication/rollout phase and a lock-refresh step; the rest is close to landable with minor corrections.

## Scope and Method

I read the proposal, its companion cross-repo review, and the driving devlog, then verified every named code surface against the live lace tree and re-checked the empirical upstream claims against the extracted npm tarballs in the session scratchpad.

Verified surfaces (all exist and behave as the proposal assumes unless noted):

- `devcontainers/features/src/portless/devcontainer-feature.json`: `version` option `"default": "latest"`; feature package `"version": "1.0.0"`. `install.sh`: `npm install -g "portless@${VERSION}"`. Confirmed.
- `packages/lace/src/lib/template-resolver.ts` `generatePortEntries` (line ~817): symmetric emit `result.appPort.push(\`${alloc.port}:${alloc.port}\`)` at line ~808. Confirmed.
- `packages/lace/src/lib/up.ts` alias registration (~1186-1256): `portlessAlias` gating and `registerHostPortlessAlias` shellout present. Confirmed.
- `packages/lace/src/lib/port-allocator.ts`: `LACE_PORT_MIN/MAX = 22425/22499`, `PortAllocator.allocate`. Confirmed.
- `packages/lace/src/commands/doctor.ts`: **only** implements `--reset` (teardown). See F3 - the "doctor already owns liveness probes" premise is inaccurate.
- Empirical re-check: `p15/package/package.json` -> `repository: vercel-labs/portless`, `author: Vercel Labs`; `dist/cli.js:1559 getProxyBindTargets`. `p15.3/package/dist/cli.js:4261 server.listen(proxyPort, () => {` (bare, wide). The version bisect and ownership claims are sound.

## Summary Assessment

This is a high-quality proposal: the causal narrative is complete, the "pin not bridge" adjudication is well-argued and consistent with prior art, the exact-over-range reasoning is correct, and the durability add-ons each retire a documented pain. The empirical spine is real, not asserted.

The single load-bearing weakness is that the proposal reasons about the fix as a **source change** and never engages with how that source reaches the broken container. Lace ships this feature through a GitHub Actions OCI publish pipeline, consumers pin it by digest, and lace's own prebuild path re-seeds those pinned digests. Under that reality the proposal's central promise - "the pin only takes effect on rebuild" - is false in a way that would let an implementer mark Phase 1 "done" against a still-broken `mirror-rearch`. That is the blocking issue.

## Section-by-Section Findings

### F1 (blocking): the fix has no publication/rollout path; the source edit is inert for real consumers

The proposal's delivery model is stated in the Edge Cases ("The pin only takes effect on rebuild") and in Phase 1 ("Set `version` default … fresh rebuild, relay-free host `200`"). That model is incomplete on three counts, each verified:

1. **The feature is consumed from ghcr, not the local repo.** `weftwise/mirror-rearch/.devcontainer/devcontainer.json:58` references `ghcr.io/weftwiseink/devcontainer-features/portless:1`. The feature's metadata (including the `version` option default that `install.sh` reads) is baked into the *published* artifact. Editing the source `devcontainer-feature.json` changes nothing a consumer sees until lace re-publishes.
2. **Re-publishing requires a feature-package version bump + merge to main.** `.github/workflows/devcontainer-features-release.yaml` runs `devcontainers/action` with `publish-features` on push to `main` under `devcontainers/features/src/**`. The published semver is the feature's own `"version"` field (currently `1.0.0`), which the proposal never mentions bumping. Without a bump, the release is at best a no-op-or-overwrite and consumers on `:1` have no new artifact to resolve.
3. **Consumers pin the feature by digest, and the prebuild path re-seeds it.** `mirror-rearch/.devcontainer/devcontainer-lock.json` pins `portless:1` to `sha256:0e77c80790ff…` (lock dated 2026-07-16, i.e. the pre-fix, `version: latest` artifact). `packages/lace/src/lib/prebuild.ts:302-308` explicitly seeds the temp build context with the prior lock entries "for version pinning." So even after a bumped re-publish, a `mirror-rearch` rebuild resolves the **old** digest, whose baked-in metadata still defaults `version: latest`, so `install.sh` still runs `npm install -g portless@latest` -> 0.15.4 -> loopback -> 502.

Consequence: **the Phase 1 acceptance test, run exactly as written, fails.** The proposal must add a phase (or expand Phase 1) covering: bump the feature `version`, merge to trigger the release workflow, confirm the new digest is published, then in the consumer refresh `devcontainer-lock.json` (`devcontainer upgrade` or delete-and-re-resolve) before the "fresh rebuild" measurement. Phase 6's cleanup sequencing ("after a rebuilt relay-free container serves host 200 …") inherits the same defect: the rebuild does not serve 200 until the lock is refreshed, so the teardown step is gated on a state that the documented steps never reach.

### F2 (blocking): the fastest working mitigation is explicitly forbidden without acknowledging why

Phase 1 says "Do NOT … touch weftwise's `.devcontainer`." But a consumer-side feature-option override - `"ghcr.io/weftwiseink/devcontainer-features/portless:1": { "version": "0.15.3" }` in the consumer's `devcontainer.json` - is the **only** lever that delivers the pin without waiting on republish and without a lock refresh: `install.sh` reads `VERSION` from the option at build time regardless of which (old) feature digest is locked. It takes effect on the very next rebuild.

The proposal is entitled to prefer the source default as the durable, all-consumers fix (it is the right durable fix). But foreclosing the option override without noting that it is the immediate unblock leaves weftwise broken for the entire republish-plus-lock-refresh latency. Reframe: the consumer option override is the immediate mitigation; the source default + republish is the durable fix; sequence them rather than banning the former. This is blocking only because, combined with F1, the proposal as written contains no path that actually restores weftwise to 200.

### F3 (non-blocking, factual): "doctor already owns host-portless liveness probes" is inaccurate

`packages/lace/src/commands/doctor.ts` implements exactly one action, `--reset`, which calls `teardownHostPortless`; its own header comment says "v1 implements only `--reset`." The liveness helper `probeHostPortless` lives in `host-portless.ts` and is invoked by `ensureHostPortless` during `lace up`, not by doctor. So the Design Decision "Doctor already owns host-portless liveness probes; a per-route check there …" and Phase 2's "(existing)" overstate the current surface: the canary is a **new diagnostic action** on a command that today only tears down. The building block (`probeHostPortless`) is reusable, so the work is modest, but the phase should (a) specify the new no-arg-or-`--check` diagnostic action and its output contract, and (b) drop the "existing" framing. Also decide the default-invocation behavior: today bare `lace doctor` prints a help stub; the canary presumably becomes that default.

### F4 (non-blocking): Phase 3's loopback publish collides with the appPort suppression check

`generatePortEntries` suppresses a generated entry when the user already supplied one, via `userAppPort.some(entry => String(entry).startsWith(\`${alloc.port}:\`))` (line ~803). If Phase 3 emits `127.0.0.1:${port}:${port}`, that generated string no longer starts with `${port}:`, so: (a) a user who hand-writes a `127.0.0.1:port:port` entry is not detected and lace double-emits, and (b) any other code path matching on the `${port}:` prefix must be re-audited. The pasta-honors-host-address open question is already flagged; add this suppression-matching adjustment to Phase 3's scope so the idempotency guarantee in the Test Plan ("alias re-registration is idempotent") is not quietly broken for the port entries.

### F5 (non-blocking): the host-tier exact pin is hygiene, not part of this fix - frame it so

Moving `packages/lace/package.json` `portless` from `^0.13.0` to exact `0.13.0` is coherent with pnpm practice and harmless. But `pnpm-lock.yaml` already locks the host tier to 0.13.0 - that lockfile, not the range, is the reproducibility guarantee, and the host tier was never the source of this outage (it already runs 0.13.0). The change is defensive intent-hardening against a future `pnpm update`, not a fix. The proposal calls it "one-line … in passing," which is fine; just avoid implying it closes any part of the live regression. The **container** feature's `version` option is the genuinely unpinned surface (resolved fresh at each `npm install -g` at build time, governed by no lockfile), and the proposal correctly targets it.

### F6 (non-blocking): README ownership drift, and it undercuts a load-bearing claim if left unreconciled

The feature `README.md` links portless as `github.com/nicobrinkkemper/portless`, while the proposal, the companion review, and my tarball re-check all establish `vercel-labs/portless` (`author: Vercel Labs`). The npm evidence governs; the README is stale. Since the "external repo, no fork, upstream request is follow-up not blocker" argument (F2 of the companion review) rests on the ownership fact, Phase 4's README rewrite should reconcile the link at the same time it fixes the stale `22435:1355` asymmetric-mapping section the proposal already calls out. Non-blocking, but it lives in the same file Phase 4 already touches, so fold it in.

### Things done well (no action needed)

- **Pin-not-bridge** adjudication is correct and consistent with the `clean-portless-urls` option-C rejection; a committed forwarder would mask the next upstream change.
- **Exact-over-range** is the right call: 0.15.4 shipped a behavior change in a patch, so a range is precisely the trap.
- **0.15.3 smoke-test-gated with 0.13.0 fallback** is a sound risk posture for a never-validated minor line.
- **Verification Methodology** insisting on socket-table + host-curl + relay-absent evidence (not config inspection) is exactly right for an outage class that was invisible in committed config.
- **Loopback-scoped publish** genuinely makes the restored wide bind strictly safer than the May baseline; the mermaid's host-portless-dials-`127.0.0.1` path remains intact under it.

## Verdict

**Revise.** The diagnosis, the core decision, and the empirical foundation are accepted; the May validation is vindicated. But the proposal has no working delivery path for its own fix: it edits feature source while the fix must travel through an OCI republish and a consumer digest-lock that it never mentions, so its Phase 1 acceptance test fails as written (F1), and it forecloses the one consumer-side lever that works immediately (F2). Resolve F1 and F2 and the proposal is landable; F3-F6 are quality corrections.

## Action Items

1. [blocking] Add a publication/rollout phase (or expand Phase 1): bump the feature package `version` in `devcontainer-feature.json` (from `1.0.0`), merge to `main` to fire `devcontainer-features-release.yaml`, confirm the new `portless:1` digest is published, then refresh the consumer's `devcontainer-lock.json` (`devcontainer upgrade` or delete-and-re-resolve) **before** the "fresh rebuild" measurement. Correct the Edge Case and Phase 6 sequencing that assume rebuild-alone suffices.
2. [blocking] Reconcile the "Do NOT touch weftwise's `.devcontainer`" guard with reality: document the consumer feature-option override (`portless: { version: "0.15.3" }`) as the immediate mitigation that works without republish or lock refresh, and sequence it ahead of (or alongside) the source-default durable fix, so a working path to host `200` exists at every step.
3. [non-blocking] Correct F3: `lace doctor` currently implements only `--reset`; drop the "already owns liveness probes"/"(existing)" framing, specify the new diagnostic action and its per-hop output contract, and reuse `probeHostPortless` from `host-portless.ts`.
4. [non-blocking] In Phase 3, adjust `generatePortEntries` suppression (the `startsWith(\`${port}:\`)` check) so the `127.0.0.1:port:port` emit stays idempotent and user-override detection still fires.
5. [non-blocking] Reframe the host-tier `^0.13.0` -> exact change as lockfile-redundant hygiene, not part of the live fix; keep the container feature `version` option as the actual unpinned target.
6. [non-blocking] Fold the README ownership correction (`nicobrinkkemper` -> `vercel-labs/portless`) into Phase 4's README rewrite alongside the stale `22435:1355` mapping fix.

## Open Questions for the Maintainer

**Q1: Rollout latency vs. blast radius.** The durable source-default fix, once published, changes the pin for **every** project consuming `portless:1` (weftwise, whelm, any lace project) on its next lock refresh + rebuild - all currently-built containers stay on 0.15.4 until then.
- (a) **Publish the bumped feature and let each project refresh its lock on its own cadence (recommended)**, with the consumer option override (Action 2) as the immediate unblock for the actively-broken `mirror-rearch`.
- (b) Drive the option override into every consumer's `.devcontainer` now and treat the source default as cleanup - faster fleet-wide but edits repos this proposal wanted to leave untouched.

**Q2: Feature version bump granularity.** The pin is a behavior-restoring change to the published feature.
- (a) **Patch bump `1.0.0` -> `1.0.1` (recommended):** consumers on `:1` pick it up on lock refresh with no devcontainer.json change.
- (b) Minor/major bump if you want to force an explicit consumer opt-in (defeats the "one committed line, auto-rolls-out" goal).

**Q3: Should the canary phase ship in the same PR as the pin, or after?** The pin is the outage fix and is independently verifiable; the canary is durability. Landing them together (as the proposal groups Phases 1-2) delays the outage fix behind new diagnostic code. Split so the pin+publish lands first?
