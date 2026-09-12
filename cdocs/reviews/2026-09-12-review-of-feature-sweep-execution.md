---
review_of: cdocs/proposals/2026-09-12-feature-version-update-sweep.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-12T07:52:27-07:00
task_list: devcontainer/feature-update-sweep
type: review
state: live
status: done
tags: [fresh_agent, runtime_validated, devcontainer, feature_versioning, execution_verification]
---

# Review: Feature Version Update Sweep - Execution Verification

> BLUF: The executed sweep (workstream B) landed correctly and safely. Independent empirical checks confirm the release workflow republished cleanly, all four consumers' authoritative `.lace/` locks now carry the exact expected digests (`claude-code` 1.0.2 @cb42292a, `blesh` 1.1.1 @76308887, `portless` 1.0.1 where applicable), the stale `sha256:95eabba1…` digest is gone from every file in every consumer repo, no running container was recreated (all uptimes unchanged, weftwise untouched), and every change is within-major. Verdict: ACCEPT.

This is an execution-verification pass (round 3), distinct from the design-acceptance reviews (rounds 1-2 in `2026-09-12-review-of-feature-update-sweep.md`). It verifies the EXECUTED implementation against the accepted proposal and the overseer's claims, from a fresh agent that did not perform the publish or relock.

## Summary Assessment

The sweep's goal was narrow and behavior-neutral: republish `claude-code` (and, per user go, `blesh`/fzf) so the `:1` digest advances off the frozen 1.0.1 resolution, then relock each consumer's authoritative `.lace/devcontainer-lock.json` so the next voluntary rebuild pulls current tooling, all without restarting any container. Every one of those claims verifies against ground truth. The single highest-value finding is a positive one: the expected digests were not merely written by the relock but are confirmed correct against the exact values the overseer committed, and the pre-sweep stale digest exists nowhere in any consumer repo. No blocking findings. Two non-blocking observations concern legacy `.devcontainer/` cruft (already out of scope by the proposal) and a registry-API query limitation worked around transitively.

## What I Verified (with evidence)

### 1. CI publish succeeded and targeted the right workflow

`gh run view 34700219344` returns `"status":"completed"`, `"conclusion":"success"`, `"workflowName":"Release Devcontainer Features"`, `"displayTitle":"feat(blesh): bump bundled fzf 0.74.3->0.74.4 (feature 1.1.0->1.1.1)"`, `headSha` `a766e2c…` (matches the tip commit `a766e2c` in git log). The run completed in ~24s (14:45:37Z -> 14:46:01Z).

Direct GHCR package-version query via `gh api` was blocked by a `415 Unsupported 'Accept' header` limitation, so I could not read the registry manifest directly. This is worked around transitively and conclusively: `devcontainer upgrade` re-resolves the live `:1` tag against GHCR at relock time, and it wrote the new digests into all four locks (below). That the relock produced `cb42292a` / `76308887` is proof the registry `:1` tags now resolve to the republished digests. I flag the direct-manifest read as not performed.

### 2. All four consumer `.lace/` locks updated to the exact expected digests

Read each consumer's `.lace/devcontainer-lock.json` directly:

| Consumer | claude-code | blesh | portless |
|---|---|---|---|
| jif (`/var/home/mjr/code/weft/jif/main`) | 1.0.2 @cb42292a ✓ | 1.1.1 @76308887 ✓ | 1.0.1 @aec6cae8 ✓ |
| whelm (`/var/home/mjr/code/apps/whelm`) | 1.0.2 @cb42292a ✓ | 1.1.1 @76308887 ✓ | 1.0.1 @aec6cae8 ✓ |
| clauthier (`/var/home/mjr/code/weft/clauthier/main`) | 1.0.2 @cb42292a ✓ | 1.1.1 @76308887 ✓ | (no portless) ✓ |
| weftwise (`/var/home/mjr/code/weft/weftwise/main`) | 1.0.2 @cb42292a ✓ | 1.1.1 @76308887 ✓ | 1.0.1 @aec6cae8 ✓ |

Both `resolved` and `integrity` fields carry the full expected values:
`claude-code` = `sha256:cb42292a653bb33ef3a36f2e1de4d3b5d201d8d3e6124a32f9af8e2bf338c1e8`, `blesh` = `sha256:7630888715ead5f4fa768aad22900b544903b68a45b54bd3585d0acf64df68f7`. Portless on whelm+weftwise is the expected in-major `1.0.0 -> 1.0.1` durability pickup; jif was already 1.0.1; clauthier declares no portless. This matches the proposal's per-consumer expectation exactly.

No consumer sits on the stale `claude-code` digest. A `grep -rl 95eabba1` across all four consumer repos (jif, whelm, clauthier, weftwise, including all worktrees) returns nothing: the pre-sweep frozen digest is gone entirely.

### 3. Lock authority confirmed; `.lace/` is what the build reads, and it is the delivery surface

`packages/lace/src/lib/up.ts` (lines ~1676-1681) confirms the build passes `--config <workspaceFolder>/.lace/devcontainer.json` when the extended config exists, so the adjacent `.lace/devcontainer-lock.json` is the lock the build consumes. The proposal's `up.ts:1677-1679` citation holds.

`git check-ignore .lace/devcontainer-lock.json` returns a match in all four consumers: the `.lace/` lock is gitignored, so it is a local untracked artifact. This confirms the delivery model: the on-disk relock IS the deliverable (no commit/push needed), and it is exactly what `lace up` reads. There is no committed lock that a build would prefer over the relocked one.

### 4. No stale or missed consumer that a build would actually read

`find … -name devcontainer-lock.json` across the four repos surfaces the four `.lace/` locks plus legacy `.devcontainer/` locks in weftwise main and five weftwise worktrees (`bocsync-bailout`, `logical-core`, `df-to-mount`, `loro-repo-package`, `command-deer-cmdk`). Investigated whether any of these is a build-authoritative lock that was missed:

- The five weftwise worktrees have **no `.lace/` directory at all** and their `.devcontainer/` locks reference only `lace-fundamentals:1` and `portless:1` (grep for `claude-code:1` and for the stale digest returns nothing). They are therefore **not consumers of the two swept features** (`claude-code`, `blesh`), none is a running container (`podman ps` shows only weftwise `main`), and none is lace-managed via `.lace/`. Nothing was missed with respect to the sweep scope.
- weftwise `main`'s tracked `.devcontainer/devcontainer-lock.json` now shows `portless` 1.0.1 and `lace-fundamentals` 1.0.2, i.e. it no longer diverges from `.lace/` on portless (the pre-sweep divergence the proposal noted is resolved incidentally). It contains no `claude-code` entry. Because weftwise `main` has a `.lace/devcontainer.json`, its `lace up` builds from `.lace/`, not this file.

No consumer's build would read a lock other than the relocked `.lace/` one. No blocking finding here.

### 5. No-restart constraint honored

`podman ps` shows the four consumer containers (whelm, jif, clauthier, weftwise) all with `CreatedAt` of 2026-09-01 and `Status: Up 10 days`; `dioxus` is `Up 5 days` (created 2026-09-06). No container has a post-sweep creation timestamp. weftwise `main` in particular is untouched (created 2026-09-01 12:53, Up 10 days). Relock rewrote on-disk locks only; nothing was recreated. This matches the hard constraint and the overseer's claim.

### 6. Behavior-neutrality: no major-version change slipped in

Every feature entry in every `.lace/` lock references a `:1` (or upstream `:1`) major tag and resolves to a within-major version: `claude-code` 1.0.2, `blesh` 1.1.1, `portless` 1.0.1, `lace-fundamentals` 1.0.2, `neovim` 1.1.0, `bash-history` 1.0.0, plus upstream `git` 1.3.8 / `node` 1.7.1 / `sshd` 1.1.0. The deliberately-pinned `portless` advanced only 1.0.0 -> 1.0.1 (in-major, the intended durability pickup) and did not jump to a new major. `lace-fundamentals` remains on the `:1` line (1.0.2); the deferred `:1 -> :2` migration did not slip in. No `:2` reference exists in any consumer lock.

## Section-by-Section Findings

- **Proposal objective and constraints (Objective, Edge Cases):** Fully satisfied by the execution. The "relock without `--config` refreshes nothing" edge case was avoided (the devlog records `--config <repo>/.lace/devcontainer.json` was used); the resulting locks prove the correct target was written. Non-blocking.
- **Test Plan / Verification Methodology:** The digest-advance, lock-refresh, no-op-discipline, and constraint-audit items are all independently reproduced above. The proposal's Verification step 2 (cold scratch build proving a current CLI installs) was explicitly not reproduced by me and, per the no-restart constraint and the overseer's report, not required for this positioning work: the warm-cache layer-bust rests by reference on the legacy-builder cache model, as the proposal states. I did not run a scratch build (read-only mandate); this does not block, because the sweep's deliverable is the lock positioning, which is fully verified. Non-blocking.
- **weftwise legacy `.devcontainer/` locks (Background, prior-art NOTE):** Correctly treated as out-of-scope cruft. Post-sweep, weftwise main's `.devcontainer/` lock happens to have converged on portless 1.0.1; the five worktree `.devcontainer/` locks remain legacy and reference only fundamentals/portless. Optional cleanup remains a separate chore, as the proposal says. Non-blocking.

## Non-Blocking Observations

1. **Direct GHCR manifest read not performed.** The `gh api` package-versions query returned HTTP 415 on the OCI Accept header. Registry `:1 -> new digest` resolution is instead established transitively (the relock re-resolved live `:1` to the expected digests). If an operator wants a direct confirmation, `gh api -H "Accept: application/json" /orgs/weftwiseink/packages/container/devcontainer-features%2Fclaude-code/versions` or a `devcontainer` resolution against `:1` would close it.
2. **weftwise worktree `.devcontainer/` locks are stale legacy artifacts** (no claude-code, no `.lace/`, not running). Harmless to the sweep. If any of these worktrees is ever brought up as a full devcontainer without a `.lace/` config, it would read its own `.devcontainer/` lock, but that lock does not reference the swept features, so there is no risk of shipping a stale claude-code from them. Optional future cleanup.

## Verdict

**Accept.** The sweep landed correctly and safely. The release workflow published cleanly (run `34700219344` green), all four authoritative `.lace/` locks carry the exact expected digests with no stale digest remaining anywhere, `.lace/` is confirmed as the build-authoritative and delivery surface, no other lock a build would read was missed, no running container was recreated (weftwise untouched), and every change is within-major with the deferred `lace-fundamentals :2` migration correctly absent. No blocking findings.

## Action Items

1. [non-blocking] If a direct registry confirmation is wanted, query the GHCR package versions with `Accept: application/json` or resolve `:1` via `devcontainer` to close the transitive gap in verification item 1.
2. [non-blocking] Consider the optional, out-of-scope cleanup of weftwise's legacy `.devcontainer/` locks (main + five worktrees) in a separate chore, per the proposal.
3. [non-blocking] Hand off the still-open Investigation Requested items from the proposal (lace-fundamentals `:2` / sshd decoupling; portless staleness sign-off) to their owning workstreams; they are outside this sweep and do not gate acceptance.
