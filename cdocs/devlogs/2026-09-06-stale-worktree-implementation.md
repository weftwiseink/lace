---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-06T15:52:07-07:00
task_list: lace/workspace-validation
type: devlog
state: live
status: done
tags: [workspace-detection, worktree, bugfix]
---

# Devlog: Implement stale/prunable worktree classification in `lace up`

> BLUF: Implements the accepted proposal `2026-09-06-stale-worktree-classification.md` (R2 accept).
> Three coordinated changes: a filesystem-only `scanWorktreeAdmin` scanner that wires the dead `prunable-worktree` stub with git's exact `should_prune_worktree` ordering (locked gate BEFORE gitdir stat), a partitioned error policy so prunable-only offenders no longer abort `lace up` while broken-LIVE offenders still hard-error, and an unconditional `worktree.useRelativePaths=true` postCreate bake-in that closes the source of new absolute gitdirs.
> All verification is hermetic (unit/integration with stubbed subprocess); no container is touched.

## Accepted decisions honored (from R2 re-review)

- Warn-not-error, never auto-prune: `lace up` never mutates `.bare/worktrees/*`.
- Accepted broken-live SIBLING downgrade: a sibling with a present host working tree but a `nonexistent-location` forward pointer classifies prunable (warn), not a hard error. Host-indistinguishable from a live co-tenant.
- `locked` checked BEFORE the gitdir stat, matching git's `should_prune_worktree`.
- The CURRENT worktree being upped retains its `:166-178` back-pointer hard-error path (unaffected by the downgrade).

## Plan

- Phase 1: `scanWorktreeAdmin` + `WorktreeAdminEntry` in `workspace-detector.ts`; wire emission in `classifyWorkspaceUncached`; extend `createBareRepoWorkspace` with a stale-entry option.
- Phase 2: partitioned error policy in `applyWorkspaceLayout`.
- Phase 3: dedicated unconditional `worktree.useRelativePaths` postCreate injection.
- Verify: typecheck, build, full lace test suite.

## Progress

### Phase 1: Admin-metadata scanner (done)

Added `WorktreeAdminEntry` + `scanWorktreeAdmin(bareGitDir)` to `workspace-detector.ts`, reproducing git's `should_prune_worktree` order: `locked` gate first, then gitdir missing/empty, then stat the forward pointer (`nonexistent-location`), else LIVE.
A private `worktreeAdminWarnings(bareGitDir, excludeWorktree)` translates entries into `prunable-worktree` (with the co-tenant-safe prune remedy) and, for LIVE entries with absolute back-pointers, `absolute-gitdir`.
`classifyWorkspaceUncached` now calls the admin scan instead of `checkAbsolutePaths`, excluding the current worktree (dedup with the retained `:166-178` back-pointer check).
`checkAbsolutePaths` is retired from the classify path but retained as a unit-tested utility (NOTE added).
Extended `createBareRepoWorkspace` with a `staleAdminEntries` option (gitdir missing/empty/nonexistent/verbatim, locked, withWorkingTree for the ambiguous case).

Tests: 7 `scanWorktreeAdmin` unit tests (incl. locked-before-gitdir ordering, both dangling and missing gitdir) + 5 classify emission tests (prunable, still-absolute, mixed, ambiguous-sibling downgrade, current-worktree dedup). 63 detector tests green; typecheck clean.

### Phase 2: Partitioned error policy (done)

Replaced the single `absolute-gitdir` filter in `applyWorkspaceLayout` with a partition: `broken` (absolute-gitdir) still hard-errors with the unchanged message; `prunable-worktree` adds an aggregated co-tenant-safe prune remedy to `warnings` and proceeds to `status:"applied"`.
Per-entry prunable warnings already flow through the `:99-103` warning loop, so the remedy string is present in both the prunable-only (applied) and mixed (error) cases.
`up.ts:344-357` needs no structural change: `applied` proceeds, `error` aborts as before.

Tests: prunable-only returns `applied` with the remedy and mutated `workspaceMount`/`workspaceFolder`; mixed returns `error` AND surfaces the prune remedy. 38 layout tests green.

> NOTE(claude-opus-4-8/workspace-validation): The proposal's Test Plan lists a separate `up.ts` wiring test. Since `up.ts` requires no change (it already routes `applied` -> proceed, `error` -> abort) and the gating decision lives entirely in `applyWorkspaceLayout`, the "prunable-only runs without `--skip-validation`" guarantee is covered by the layout-level `applied` assertion. A full `up.ts` integration test would require heavy subprocess stubbing for zero additional coverage of this change.

### Phase 3: Close the source (config bake-in) (done)

Added a dedicated, unconditional `mergePostCreateCommand(config, "git config --global worktree.useRelativePaths true")` call in `applyWorkspaceLayout`, placed after the `safe.directory` block but NOT gated behind `postCreate.safeDirectory`.
A user who disables `safeDirectory` still gets the relative-paths fix.
On container git < 2.48 the key is an inert unknown-key no-op, so applying it is always version-safe.

Two existing tests were updated to reflect the always-present injection (the safe.directory-only assertions), and three tests added: guard-independence (`safeDirectory:false` still injects useRelativePaths and omits safe.directory), idempotency, and the chained-both assertion. 40 layout tests green.

## Verification

- `pnpm --filter lace typecheck`: clean.
- `pnpm --filter lace build`: clean (dist/index.js built).
- `pnpm --filter lace test`: 908 passed, 3 skipped, 1 todo. 5 failures, ALL non-regressions:
  - 4 x `port-allocator.test.ts` EADDRINUSE on live host ports 22429-22433 (flagged pre-existing/environmental; reproduces on pristine main).
  - 1 x `fundamentals-scenarios.test.ts` F3 `feature metadata declares correct mounts and dependsOn`: asserts feature version `2.0.0` but the feature on the base commit declares `2.1.0`. This branch touches no fundamentals/feature files (`git diff --name-only dcb17f0 HEAD` confirms), so it is a pre-existing stale-test failure, not a regression from this work.
- All new tests (12 detector, 5 layout) pass; no existing workspace-detector or workspace-layout test regressed.

## Deviations from the proposal

- The separate `up.ts` wiring test is folded into the layout-level `applied` assertion, because `up.ts` needs no structural change (see the Phase 2 NOTE above). The behavioral guarantee (prunable-only proceeds without `--skip-validation`) is fully covered.
- Phase 4 (live-container proof + optional `git worktree prune -n` cross-check) is explicitly deferred by the proposal and out of the hermetic core; not attempted (constraint: no container / no `lace up`).
- `checkAbsolutePaths` is retired from the classify path but retained as an exported, unit-tested utility rather than deleted, so its three existing tests stay green. Marked with a NOTE.
</content>
</invoke>
