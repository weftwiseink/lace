---
first_authored:
  by: "@claude-sonnet-5"
  at: 2026-09-01T00:00:00-07:00
task_list: devcontainer-decoupling/lace-up-layout
type: report
state: live
status: review_ready
tags: [architecture, future_work, devcontainer]
---

# Consolidating `.lace/` Into `.lace/up/`

> BLUF: `.lace/` is a flat scatter of 7+ generated files written by 5 modules across 3 different pipeline phases. Grouping the per-`up` artifacts under `.lace/up/` and merging four of them into a single `lace-resolutions.json` is layout cleanup, not a behavior change, but it has two real traps: (1) `up.ts`'s relative-path rewriting for local features/Dockerfile/build-context is computed from the literal location of `.lace/devcontainer.json` and must gain one more `..` segment everywhere it appears, and (2) the four files proposed for merging are written independently at three different points in the pipeline by three different classes, each doing a blind overwrite today; naively pointing all three at one shared filename reintroduces a lost-update bug unless the writers are converted to read-merge-write or refactored to share one in-memory accumulator written once. `.lace/prebuild/` and `.lace/prebuild.lock` should stay at the `.lace/` top level: they are a build cache shared by `up`, `prebuild`, `restore`, and `status`, not a per-`up` artifact. `.gitignore` needs no change since it already ignores `.lace/` wholesale. A prior proposal (`cdocs/proposals/2026-03-07-lace-up-output-organization.md`) already assumes today's flat layout for its `.lace/logs/` design; that proposal's file paths need a one-line update if this consolidation lands first.

## Context / Background

The user's request: "There's a bunch of discrete intermediate files under `.lace`. Instead we should have a `.lace/up` subdir with `devcontainer.json` and `lace-resolutions.json`."

This report inventories every current `.lace/` writer and reader, distinguishes per-invocation ephemeral output from state that is genuinely persisted and reused across runs, and specifies a target layout plus the concrete code changes and risks the move entails. No source code is changed as part of this report.

## Key Findings

- `.lace/` currently holds 7 distinct artifacts written by 6 different files across 3 separate phases of the `up` pipeline, plus a shared prebuild-cache namespace used by 4 different commands.
- Two of the four files proposed for merging (`port-assignments.json`, `mount-assignments.json`) are true persisted state: loaded at pipeline start, consulted to reuse prior host-port/mount-path choices, and only overwritten on drift. `resolved-mounts.json` and `runtime-fingerprint` are effectively write-only from lace's own perspective in production code (only a test reads `resolved-mounts.json` back).
- The four candidate files for `lace-resolutions.json` are written at three different call sites (`up.ts:671-672`, `resolve-mounts.ts:182-183` via `up.ts:991`, `config-drift.ts` via `up.ts`'s drift-check block) by three independently-instantiated classes, each with its own `persistPath`/`load()`/`save()` doing a **blind whole-file overwrite**. Pointing all three at the same filename without additional coordination causes each writer to clobber the sections written by the others.
- `up.ts`'s `rewriteLocalFeatureRefs()` and the dockerfile/build-context rewriting in `generateExtendedConfig()` compute paths as `relative(laceDir, sourcePath)`, where `laceDir = join(workspaceFolder, ".lace")`. Moving the generated config to `.lace/up/devcontainer.json` changes `laceDir` to `join(workspaceFolder, ".lace", "up")`, adding one directory level, so every rewritten relative reference gains one additional leading `../`.
- `.lace/prebuild/` and `.lace/prebuild.lock` are written and read by `commands/prebuild.ts`, `commands/status.ts`, `lib/restore.ts`, and `lib/metadata.ts` independent of whether `lace up` ever runs (also invoked via `runPrebuild` from inside `up.ts`). This is a shared build-cache namespace, not an `up`-invocation artifact, and does not belong under `.lace/up/`.
- `.lace/logs/` (`lib/run-log.ts`) is instantiated only from `up.ts`, so it is `up`-exclusive, but it is an append/rotate archive (keeps the last 10, 7-day retention) rather than current-run state — it is a directory of history, not a single generated snapshot. It arguably belongs under `.lace/up/logs/` for co-location, but its retention semantics differ from the other artifacts.
- `.gitignore` at the repo root has a single line, `.lace/`, so no gitignore change is needed for this move; the entire tree is already ignored regardless of nesting.
- `cdocs/proposals/2026-03-07-lace-up-output-organization.md` (`status: review_ready`) proposes `.lace/logs/up-<timestamp>.log` and cites the current flat layout (`.lace/` "already contains `devcontainer.json`, `port-assignments.json`, `mount-assignments.json`, `prebuild/`") as existing infrastructure. It does not conflict with this consolidation but its file-path references need updating if this proposal is implemented first (or vice versa).
- 10 test files reference these paths directly by string (`port-assignments`, `mount-assignments`, `resolved-mounts`, `prebuild.lock`, `.lace/logs`, `.lace/devcontainer.json`, `.lace/prebuild`) and will need path updates: `docker_smoke.test.ts`, `resolve-mounts.integration.test.ts`, `portless-scenarios.test.ts`, `restore.integration.test.ts`, `port-allocator.test.ts`, `e2e.test.ts`, `up-mount.integration.test.ts`, `mount-resolver.test.ts`, `up.integration.test.ts`, `debug-footer.test.ts`.

## Current State: Complete `.lace/` Inventory

| Path | Writer (file:line) | Reader(s) | Persisted across runs? |
|---|---|---|---|
| `devcontainer.json` | `lib/up.ts:1474-1481` (`generateExtendedConfig`) | `up.ts:1046-1050` (same-run drift check), `debug-footer.ts:29`, the `devcontainer` CLI itself (external process) | Regenerated fresh every `up` invocation. Not read-modify-write state, but consumed synchronously within the same run and by an external process. |
| `port-assignments.json` | `lib/port-allocator.ts:139-150` (`PortAllocator.save()`, called from `up.ts:671`) | `port-allocator.ts:124-136` (`load()`, called in constructor on every run), `debug-footer.ts:31` | **Yes.** This is the entire point of the file: same host port reused across `lace up` invocations. |
| `mount-assignments.json` | `lib/mount-resolver.ts` (`MountPathResolver.save()`, called from `up.ts:672`) | `mount-resolver.ts` `load()` (constructor), `debug-footer.ts:30` | **Yes.** Same rationale as ports. |
| `resolved-mounts.json` | `lib/resolve-mounts.ts:179-183` (`runResolveMounts`, called from `up.ts:991`) | Only `resolve-mounts.integration.test.ts` reads it back; no production code reads it | No. Write-only snapshot of the current run's repo-mount resolution. |
| `runtime-fingerprint` | `lib/config-drift.ts:77-83` (`writeRuntimeFingerprint`) | `config-drift.ts:63-71` (`readRuntimeFingerprint`, called from `up.ts`'s drift-check block) | **Yes.** Compared against the current fingerprint each run to decide whether to auto-recreate the container. |
| `prebuild.lock` | `commands/prebuild.ts:29` | `flock(1)` (external, advisory) | No. Exists only for the duration of a `prebuild` invocation. |
| `prebuild/` (Dockerfile snapshot, `devcontainer.json` snapshot, `metadata.json`) | `lib/prebuild.ts:70`, `lib/metadata.ts:22-27` (`writeMetadata`) | `lib/metadata.ts:34-40` (`readMetadata`, used by `restore.ts` and `status.ts`), `lib/prebuild.ts` `contextsChanged` (staleness check) | **Yes**, deliberately: `restore.ts` explicitly does *not* delete this directory because it is a build cache. |
| `logs/` | `lib/run-log.ts:52` (`RunLog`, instantiated only in `up.ts`) | Humans/agents reading directly; `debug-footer.ts` prints a `logPath` it is handed, not one it derives from `.lace/logs` itself | Archival, not reused state: rotates to the 10 most recent files, 7-day max age. |

The persisted-state files (`port-assignments.json`, `mount-assignments.json`, `runtime-fingerprint`) and the write-only snapshot (`resolved-mounts.json`) are the four candidates named in the request as merge targets for `lace-resolutions.json`. Treating them identically in the target design would be a mistake: three of the four are load-bearing state consulted on the *next* run, one is a debugging artifact nothing reads back.

## Target Layout

```
.lace/
├── up/
│   ├── devcontainer.json       # generated config passed to `devcontainer up`
│   ├── lace-resolutions.json   # merged: port assignments, mount assignments,
│   │                           # runtime fingerprint, resolved-mounts snapshot
│   └── logs/
│       └── <timestamp>-<suffix>.log
├── prebuild.lock                # unchanged: shared build-cache namespace
└── prebuild/                    # unchanged: shared build-cache namespace
    ├── Dockerfile
    ├── devcontainer.json
    └── metadata.json
```

`prebuild/` and `prebuild.lock` stay at the `.lace/` top level. They are written and read independently of `lace up` by `lace prebuild`, `lace restore`, and `lace status`, and conflating them with `up`'s per-invocation output would misrepresent their actual lifecycle (long-lived build cache vs. regenerated-every-run config).

`logs/` moves under `.lace/up/` for co-location, since `RunLog` is exclusively an `up`-pipeline concern, but its rotation/retention behavior is unchanged.

### `lace-resolutions.json` shape

```jsonc
{
  "ports": {
    "wezterm-server/hostSshPort": { "port": 22425, "assignedAt": "..." }
  },
  "mounts": {
    "myns/data": { "resolvedSource": "...", "isOverride": false, "assignedAt": "..." }
  },
  "resolvedMounts": { /* current ResolvedMounts snapshot, last-run-wins */ },
  "runtimeFingerprint": "a1b2c3..."
}
```

`ports` and `mounts` are genuinely persisted, read-modify-write sections. `resolvedMounts` and `runtimeFingerprint` are last-write-wins snapshots of the most recent run. Merging them into one file is cosmetically simpler but means every writer must know how to avoid clobbering the sections it doesn't own (see Risks below).

## The `up.ts` Relativity Problem

`generateExtendedConfig()` and `rewriteLocalFeatureRefs()` both compute output paths as `relative(laceDir, sourcePath)`, where today `laceDir = join(workspaceFolder, ".lace")`. Three code paths depend on this:

1. **Local feature refs** (`up.ts:1290-1313`, `rewriteLocalFeatureRefs`): a feature ref like `./features/portless` (relative to `.devcontainer/devcontainer.json`) is rewritten to `../.devcontainer/features/portless` so it resolves correctly from `.lace/devcontainer.json`'s location, per the devcontainer CLI's "must be a child of `.devcontainer/`" constraint (documented in the function's docstring, `up.ts:1266-1289`).
2. **`build.dockerfile`** (`up.ts:1353-1356`) and the legacy top-level `dockerfile` field (`up.ts:1358-1367`): resolved against `.devcontainer/`, then rewritten relative to `laceDir`.
3. **`build.context`** (`up.ts:1370-1374`): same pattern.

Moving the generated config to `.lace/up/devcontainer.json` changes `laceDir` to `join(workspaceFolder, ".lace", "up")`. Every one of the above rewrites needs `laceDir` updated to include the `up` segment; `relative()` then naturally produces one extra `../` (e.g., `./features/portless` becomes `../../.devcontainer/features/portless` instead of `../.devcontainer/features/portless`), and the CLI's "child of `.devcontainer/`" constraint continues to hold because the extra `..` still resolves back into the real tree. **The fix is a single-line change** (`laceDir = join(workspaceFolder, ".lace", "up")` at `up.ts:1349`, and the corresponding line in the config-drift read path at `up.ts:1046`), but every test asserting exact rewritten path strings (the "local feature ref" and "dockerfile/context rewriting" unit tests) will need their expected `../` counts bumped by one. This is the single highest-risk mechanical change in the whole consolidation: a missed call site here reintroduces the exact "Local file path parse error" the existing docstring warns about, and it fails silently until a feature or Dockerfile build is actually exercised (unit tests that only check the config JSON's other fields will not catch it).

## Persisted-State Merge Risk

`portAllocator.save()` and `mountResolver.save()` are called back-to-back at `up.ts:671-672`. `runResolveMounts()` (which writes `resolved-mounts.json`) runs later, at `up.ts:991`, in a separate phase. The runtime-fingerprint write happens later still, inside the config-drift block that follows `generateExtendedConfig()`. These are three independent classes (`PortAllocator`, `MountPathResolver`, plus the free functions in `resolve-mounts.ts` and `config-drift.ts`), each owning its own file end-to-end via a private `load()`/`save()` blind-overwrite pair. `PortAllocator` and `MountPathResolver` are each instantiated only from `up.ts` (confirmed: no other command constructs them), so there is no cross-command sharing concern, but there is a same-process sequencing concern: if all three are pointed at one `lace-resolutions.json` filename without further changes, the later writer's blind overwrite discards the earlier writer's section, silently losing port or mount data on every run.

Two ways to fix this, in increasing order of invasiveness:

1. **Read-merge-write per writer.** Each of the three writers reads the current `lace-resolutions.json` (if present), merges only its own top-level key, and writes the whole file back. Minimal diff, but adds a read before every write and depends on all three writers agreeing on the merge contract; still vulnerable to two concurrent `lace up` processes in different terminals for the same project, which is a preexisting but now higher-blast-radius risk (today a concurrent-process race only loses one of four files; consolidated, it loses all four sections at once).
2. **Shared accumulator object.** Introduce a `LaceResolutions` struct threaded through the pipeline, populated by each phase, and written once near the end of `runUp()`. Cleaner and removes the read-before-write races entirely, but is a real refactor of `PortAllocator`/`MountPathResolver`'s save() contract and of `runResolveMounts()`'s signature (currently a standalone function that owns its own file write).

This report does not pick between them; it flags that the merge is not risk-free housekeeping and needs a designed answer before implementation, not an incidental side effect of a rename.

## Migration

- **Existing projects** have flat files at `.lace/devcontainer.json`, `.lace/port-assignments.json`, `.lace/mount-assignments.json`, `.lace/resolved-mounts.json`, `.lace/runtime-fingerprint`, `.lace/logs/`. Since `.lace/` is fully regenerated/gitignored and none of it is meant to be hand-edited, the simplest migration is "no migration": old files become orphaned and can be left in place (harmless, gitignored) or deleted as part of `lace up`'s startup (e.g., detect the old flat layout and `rm` the known legacy filenames once). Silent orphaning risks user confusion if they go looking for `port-assignments.json` and find it stale; an explicit one-time cleanup is preferable to silence.
- **`.gitignore`**: no change needed. The single `.lace/` entry already covers the new nesting.
- **`debug-footer.ts:22-31`**: `laceDir` and all three printed paths (`config`, `mounts`, `ports`) need updating to the new locations (`.lace/up/devcontainer.json`, and whatever `lace-resolutions.json` field-level references make sense once the merge lands — printing one merged path for both `mounts:` and `ports:` may be more honest than printing two labels pointing at the same file).
- **`packages/lace/docs/architecture.md`** "Settings and state files" section (lines 260-291) documents the current flat layout by name and needs rewriting to the `.lace/up/` layout once implemented.
- **`cdocs/proposals/2026-03-07-lace-up-output-organization.md`**: references `.lace/logs/` and the current flat file list as "existing infrastructure" in its Background section. Its own file paths (`.lace/logs/up-<timestamp>.log`) become `.lace/up/logs/up-<timestamp>.log` if this consolidation lands first; the two proposals are otherwise compatible and non-conflicting in intent.

## Risks and Open Questions

- **[High] Relativity math**: every `relative(laceDir, ...)` call site in `up.ts` (three of them, plus the docstrings describing them) must be updated in lockstep. A partial update produces devcontainer-CLI errors that only surface when a local feature, custom Dockerfile, or custom build context is actually used, which several integration tests exercise but ordinary unit tests may not.
- **[High] Lost-update race in the merged file**: see "Persisted-State Merge Risk" above. Needs an explicit design decision (read-merge-write vs. shared accumulator) before implementation starts.
- **[Medium] `resolved-mounts.json` and `runtime-fingerprint` have different semantics than `port-assignments.json`/`mount-assignments.json`** (write-only snapshot / small-scalar-state vs. genuinely reused state) but the request merges all of them into one file. Worth confirming the merge is still desired for the two non-reused pieces, or whether only the two truly-persisted files should merge and the other two stay separate/embedded differently.
- **[Medium] Concurrent `lace up` invocations** (two terminals, same project) already race on today's four separate files; consolidating into one file increases the blast radius of a lost update from one concern to all four at once. Not a new class of bug, but a real severity increase.
- **[Low] `debug-footer.ts` currently prints three distinct labeled paths** (`config`, `mounts`, `ports`) that would become two or fewer distinct files post-merge; the footer's UX needs a small rework, not just a path substitution.
- **[Open] Should `prebuild.lock` and `prebuild/` eventually also move**, e.g. to a sibling `.lace/prebuild/` that already matches this shape? This report recommends leaving them as-is since they are already appropriately scoped outside `up`'s namespace, but flags it as worth an explicit "no" if the user wants full consistency later.
- **[Open] Old-layout cleanup**: silent orphaning vs. explicit one-time deletion of legacy flat files, as discussed under Migration.

## Work Breakdown

1. **Design the merge coordination mechanism.** Decide read-merge-write vs. shared accumulator for `lace-resolutions.json` (see Persisted-State Merge Risk). Success criteria: a short design note or proposal section resolving this before any code changes.
2. **Introduce `.lace/up/` path constants and update `laceDir` computation.** Update `up.ts:1349` (and the drift-check read at `up.ts:1046`) to `join(workspaceFolder, ".lace", "up")`. Success criteria: `devcontainer.json` is written to and read from the new path; existing dockerfile/context/feature-ref rewrite tests pass with one additional `../` in expected output.
3. **Merge `port-assignments.json` + `mount-assignments.json` + `runtime-fingerprint` (+ `resolved-mounts.json`, pending step 1's scope decision) into `lace-resolutions.json`.** Apply the chosen coordination mechanism from step 1. Success criteria: a full `lace up` run on a project with pre-existing port/mount assignments reuses the same host port and mount source across two consecutive runs (regression test for the exact bug a naive merge would introduce).
4. **Move `logs/` under `.lace/up/logs/`.** Update `run-log.ts:52`. Success criteria: log rotation/retention behavior unchanged, verified by existing `RunLog` unit tests with updated paths.
5. **Update `debug-footer.ts`.** Rework the printed path list to reflect the merged file and new locations. Success criteria: `debug-footer.test.ts` updated and passing; manual review that the footer still points an agent at the right file for ports/mounts debugging.
6. **Update `packages/lace/docs/architecture.md`** "Settings and state files" section to the new layout. Success criteria: doc accurately lists `.lace/up/devcontainer.json`, `.lace/up/lace-resolutions.json`, `.lace/up/logs/`, and unchanged `.lace/prebuild/`, `.lace/prebuild.lock`.
7. **Legacy-file cleanup on first `up` after upgrade.** Detect and remove orphaned flat files from the old layout. Success criteria: a project with an old-layout `.lace/` directory ends up with only the new layout after one `lace up` run, and no orphaned files remain.
8. **Update the 10 identified test files** to the new paths (see Key Findings for the file list). Success criteria: full test suite green.
9. **Reconcile `cdocs/proposals/2026-03-07-lace-up-output-organization.md`**'s log-path references if it has not yet been implemented. Success criteria: the proposal's file paths match whichever layout lands first; a NOTE callout added to either document if sequencing leaves a temporary mismatch.
