---
review_of: cdocs/proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-07-18T17:34:53-07:00
task_list: portless/ingress-durability
type: review
state: live
status: done
tags: [rereview_agent, portless, devcontainer, networking, dependency_pinning, rollout, runtime_validated]
---

# Review (Round 2): Portless Feature Version Pin and Ingress Durability

> BLUF: Both round-1 blocking items are resolved and all four non-blocking items are folded in, each verified against live code, not just prose.
> The revision now carries a working two-leg delivery path (immediate consumer option override, durable republish + lock refresh) whose central mechanical claim - `install.sh` reads the `version` option at build time regardless of the locked digest - is true in the source.
> The release workflow name/trigger, the feature version bump target, and the prebuild lock re-seed are all represented accurately; I found no freshly introduced errors.
> Verdict: **Accept.**

## Scope and Method

Round-1 review: [`2026-07-18-review-of-portless-feature-version-pin-and-ingress-durability.md`](2026-07-18-review-of-portless-feature-version-pin-and-ingress-durability.md).
This round checks each round-1 action item against the revised proposal and re-verifies every newly-load-bearing code surface in the live lace tree, plus a sanity pass for errors introduced by the revision.

## Round-1 Action Items

### 1 (blocking): publication/rollout path - RESOLVED

The revision splits delivery into two legs (BLUF, Phase 1, new Phase 1b):
- Immediate: consumer sets the feature `version` option; takes effect on next rebuild with no republish and no lock refresh.
- Durable: bump the feature package `version`, merge to `main` to fire the release workflow, then refresh each consumer's `devcontainer-lock.json`.

Verified against code:
- Feature package `"version": "1.0.0"` in `devcontainers/features/src/portless/devcontainer-feature.json`; the proposal's `1.0.0 -> 1.0.1` bump target is correct.
- `.github/workflows/devcontainer-features-release.yaml` triggers on `push` to `main` under `devcontainers/features/src/**`, runs `devcontainers/action` with `publish-features: "true"` and `features-namespace: "weftwiseink/devcontainer-features"`. The proposal's described workflow behavior and the target artifact path (`ghcr.io/weftwiseink/devcontainer-features/portless`) match.
- `packages/lace/src/lib/prebuild.ts:304-310` seeds the temp build context from prior lock entries (`extractPrebuiltEntries`, comment "for version pinning"). The Edge Cases and Phase 1b callouts represent this accurately, and Phase 1b's "minding the prebuild path that re-seeds prior lock entries" is the right caution: `extractPrebuiltEntries` reads the same consumer lock the refresh updates, so refreshing it does propagate.

The Phase 6 sequencing defect flagged in round-1 F1 (teardown gated on a state the documented steps never reached) is closed: Phase 6 now gates on Phase 1 verification, and Phase 1 reaches host `200` via the option override, so the "rebuild first, verify 200, then delete relay" order is now actually reachable.

### 2 (blocking): consumer option override permitted and scoped - RESOLVED

New design decision "A consumer feature option is config, not drift" draws the line correctly: the `version` option is the feature's public configuration surface, distinct from a network-binding workaround. The Phase 1 "Do NOT" is rewritten to ban network-binding workarounds while explicitly permitting the `version` option.

Verified the mechanism: `install.sh` sets `VERSION="${VERSION:-latest}"` and runs `npm install -g "portless@${VERSION}"`. The devcontainer CLI passes the `version` option as the `VERSION` env var into whichever install.sh is baked into the locked digest, and every published install.sh has read `VERSION` this way (it is the install mechanism). So the override does take effect against the currently-locked pre-fix digest, exactly as the proposal claims (Phase 1, "works against the currently locked artifact with no republish and no lock refresh"). Claim is sound.

### 3 (non-blocking): doctor claim corrected - RESOLVED

The design decision no longer asserts doctor "owns liveness probes." It now reads: doctor "already handles host-portless teardown (`--reset`); the per-route check is a new diagnostic action there (the liveness probe logic currently lives in `host-portless.ts` and is reused, not duplicated)." Verified: `packages/lace/src/commands/doctor.ts` implements only `--reset` (its header says "v1 implements only `--reset`"), and `probeHostPortless` lives in `packages/lace/src/lib/host-portless.ts:259`. Phase 2's "(existing)" now correctly refers to that reusable helper, not to a doctor capability. Accurate.

### 4 (non-blocking): generatePortEntries suppression handling - RESOLVED

Phase 3 now says to update the duplicate-suppression check "in `generatePortEntries` (it matches entries by `startsWith("<port>:")`)" and any user-override detection to recognize the host-scoped form. Verified: `template-resolver.ts:804-805` suppresses via `userAppPort.some(entry => String(entry).startsWith(\`${alloc.port}:\`))`, and the emit at line ~808 is `${alloc.port}:${alloc.port}`. The described collision (a `127.0.0.1:port:port` emit no longer matching the `port:` prefix) is real and the scope note is correct.

### 5 (non-blocking): host-tier exact pin reframed as hygiene - RESOLVED

The design decision now states the host tier's `^0.13.0` "is already effectively exact via the pnpm lockfile; moving the declaration to exact is hygiene that documents intent, not part of the live fix," and Phase 1 marks the move "Optional (hygiene)." Correctly separated from the live regression.

### 6 (non-blocking): README vercel-labs link correction - RESOLVED

Phase 4 now folds in "correct its upstream link (it points at `nicobrinkkemper/portless`; the package's own repository field is `vercel-labs/portless`)." Verified the README still links `github.com/nicobrinkkemper/portless`, so the correction is warranted and lands in the same file Phase 4 already rewrites.

## Sanity Check for Newly Introduced Errors

No new errors found. The three highest-risk new claims all hold:
- Option override honored regardless of locked digest: true (install.sh mechanism above).
- Release workflow name/trigger/namespace: matches `devcontainer-features-release.yaml`.
- Prebuild lock re-seed: matches `prebuild.ts` `extractPrebuiltEntries` seeding.

The two-leg narrative is internally consistent: Phase 1b's "refreshed lock, NO option override" success criterion is coherent because the refreshed digest carries the new `0.15.3` default, and the prebuild caution is correctly attached.

## Verdict

**Accept.** Both blocking items are resolved with verified mechanics, the non-blocking corrections are all in, and the revision introduces no new inaccuracies. The maintainer's three open questions (Q1 rollout cadence, Q2 bump granularity, Q3 canary-with-or-after-pin) are carried in the closing NOTE with assumed answers and clearly marked divergence points, which is appropriate for an implementation-ready proposal; they are choices, not gaps.

## Residual Non-Blocking Notes (implementer discretion, no re-review needed)

1. Phase 1b does not name the exact lock-refresh command (`devcontainer upgrade` vs delete-and-re-resolve). Round-1 suggested both; either is fine, but pick one in the devlog for reproducibility.
2. The `:1` major-tag pickup of a `1.0.1` patch on lock refresh is assumed (standard devcontainer feature semver-tag behavior) and correct; worth a one-line confirmation in the implementation devlog when the republish lands.
