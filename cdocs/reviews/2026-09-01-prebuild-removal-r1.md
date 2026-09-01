---
review_of: cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-01T09:55:00-07:00
task_list: lace/prebuild-cache-rethink/legacy-builder-migration
type: review
state: live
status: done
tags: [self, fresh_agent, runtime_validated, prebuild, lace_prebuild_deletion, iterate]
---

# Review: Prebuild Removal (Phases 4-6) — Round 1

> BLUF: Accept.
> The ~6100-LoC deletion is clean and correct: typecheck and build are green, the only failing test is the pre-existing environmental port-allocator case (independently confirmed byte-identical to `main`, port 22431 held by a reboot-protected container's `pasta` process), no live references to deleted modules remain, and the two load-bearing bits (`--buildkit never`, `dev_container_feature_content_temp` cleanup) are retained byte-for-byte.
> The fail-loud `prebuildFeatures` guard fires early and was independently reproduced against a throwaway fixture (exit 1, migration message, no container build).
> Two minor non-blocking nits and one informational merge note; no blocking findings.

## Verification Performed (this round)

All commands run from the `prebuild-removal` worktree. No container was built or rebooted.

| Check | Result |
|---|---|
| `pnpm --filter lace typecheck` (`tsc --noEmit`) | exit 0, zero errors |
| `pnpm --filter lace build` (vite) | exit 0, `dist/index.js 154.39 kB` |
| `pnpm --filter lace test` | 1 failed / 881 passed / 3 skipped / 1 todo (37 files) |
| `grep -rn prebuildFeatures packages/lace/src` | only guard (`up.ts:237-254`) + its test (`validate.test.ts:110-144`) |
| `grep -rn BUILDAH_LAYERS packages/lace/src` | empty (exit 1) |
| Live imports of deleted modules/symbols | none |
| `--buildkit never` + temp cleanup vs `main` | `git diff main` empty for that region |
| Fail-loud guard via built CLI | exit 1, migration message, no build call |
| Scope (`git diff --name-only main..HEAD`) | only `packages/lace/`, `cdocs/`, `.devcontainer/` |
| `git status` / `git log main..HEAD` | clean tree; no merge/push; expected commits only |

## Section-by-Section Findings

### Verification floor (compile, test, greps) — passes

Typecheck and build both exit 0. The test suite reproduces the devlog's numbers exactly: `Tests 1 failed | 881 passed | 3 skipped | 1 todo`.
The single failure is `port-allocator.test.ts > reuses saved port when it is in ownedPorts even if port is blocked`, a 5s timeout caused by `EADDRINUSE ::1:22431`.
Independently confirmed environmental, not a branch regression:
- `git diff main -- packages/lace/src/lib/port-allocator.ts` and `... __tests__/port-allocator.test.ts` are both empty (byte-identical to `main`).
- `ss -tlnp` shows `*:22431` held by `pasta.avx2` pid 1037058 (also 22425/22426/22427/22428 — the reboot-protected containers' rootless-podman networking). The test binds a real socket to 22431 to simulate a blocked port; the live container already owns it.

No other test fails. Not blocking.

### Retained load-bearing machinery — correct and unmodified

Both critical retentions are present at the single `runDevcontainerUp` site and unchanged from `main`:
- `up.ts:1439` `args.push("--buildkit", "never")`.
- `up.ts:1443-1444` `podman rm -f -a --filter ancestor=dev_container_feature_content_temp` then `podman rmi -f dev_container_feature_content_temp`.

`git diff main -- packages/lace/src/lib/up.ts` shows no change in this region, so the highest-severity failure picture (accidental removal of either) is ruled out.

### Fail-loud guard — correct placement, independently demonstrated

The guard sits at `up.ts:237-254`, immediately after config parse and before Phase 0a workspace layout, template resolution, and the `runDevcontainerUp` call at `up.ts:1448`.
It checks `configMinimal.raw.customizations.lace.prebuildFeatures` and returns `exitCode 1` with a migration-pointing message, so a config carrying the key errors out rather than silently dropping features.

Reproduced against a throwaway fixture (`/scratchpad/guard-fixture`, a devcontainer.json declaring `customizations.lace.prebuildFeatures`), via the built CLI:

```
$ node packages/lace/dist/index.js validate --workspace-folder <fixture>
customizations.lace.prebuildFeatures is no longer supported. Move these entries into the
top-level `features` map in .devcontainer/devcontainer.json. See
cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md for the migration.
...
GUARD_CLI_EXIT=1
```

`lace validate` runs with `skipDevcontainerUp: true`, so no container is built. The guard test (`validate.test.ts:110-144`) additionally asserts no `devcontainer build` call is made.

### Deviations — all sound

- **`dockerfile.ts` reduced, not deleted.** The file now exports only `parseDockerfileUser`, which is imported by `devcontainer.ts:5` and consumed at `devcontainer.ts:323` inside `extractRemoteUser`. This function is genuinely still needed and is not on the proposal's prebuild-only list. Every prebuild-only helper (`parseDockerfile`, `generateTag`, `parseTag`, `rewriteFrom`, `restoreFrom`, `generatePrebuildDockerfile`, `parseImageRef`, `generateImageDockerfile`) is gone. Correct call.
- **`devcontainer.json` flip.** JSONC preserved (all comments intact); all four features moved verbatim from `customizations.lace.prebuildFeatures` to the top-level `features` map; a migration-pointing comment was added above the block. Diff vs `main` is exactly the move plus the comment.
- **Extra docs touched (`architecture.md`, portless sections).** Justified by history-agnostic framing: leaving them describing the deleted pipeline as current would violate the house rule. Reasonable.
- **`user-config.ts` substep 8 no-op.** Confirmed: the schema never carried `prebuildFeatures`; nothing to remove.

### Docs quality — good, reads as migration notes

`prebuild.md` is a proper migration note (BLUF, "What changed", "Migration steps", one-time cleanup).
`README.md`, `migration.md`, and `troubleshooting.md` no longer present prebuild as current; the residual `lace prebuild` mentions are all qualifying "Earlier versions..." callouts (the permitted NOTE-callout exception to history-agnostic framing) or enumerations of what was removed.

### Scope adherence — confirmed

`git diff --name-only main..HEAD` touches only `packages/lace/`, `cdocs/`, and `.devcontainer/devcontainer.json`.
No other project (clauthier/jif/whelm) was migrated. Working tree is clean; no merge or push; `git log main..HEAD` contains only the scaffold + Phase 4/flip/Phase 5/Phase 6 + devlog-finalize commits.
`devcontainers/features/src/bash-history/` shows as "deleted" in `git diff main..HEAD`, but this is benign divergence, not an implementer action (see N3).

## Non-Blocking Findings

- **N1 (writing convention).** README additions contain three spaced-double-hyphen em-dashes (` -- `), which `writing-conventions.md` prohibits in favour of colons/commas/periods:
  - `...No lace core changes are needed -- the feature port auto-injection pipeline...`
  - `[Removing lace prebuild](docs/prebuild.md) -- migrating prebuildFeatures into features`
  - `...resolution -- is expressed in standard devcontainer.json fields.`
  The devlog claims "colons over em-dashes" was followed; these three contradict that. Cosmetic; does not gate acceptance.

- **N2 (dead code / test).** `flock.ts` is left in place as production dead code (its only callers were the deleted subcommands). The devlog calls it "unreferenced dead code," but `flock.test.ts` still imports and exercises `withFlockSync`, so the module is not fully orphaned — its test still runs in the suite. Either delete both `flock.ts` and `flock.test.ts`, or amend the devlog note to acknowledge the surviving test. Harmless; out of the proposal's deletion list, so leaving it is defensible.

- **N3 (informational, merge hygiene).** The branch is one commit behind `main`: `a823954 feat(bash-history): add mount-only devcontainer feature` was added to `main` after the branch point (`bash-history` is absent at merge-base `61ec1ec`). `git diff main..HEAD` therefore renders the bash-history feature as a "deletion," but the branch never touched it. When merging `prebuild-removal`, ensure `a823954` is retained (a standard merge/rebase does this; do not resolve the phantom deletion by dropping bash-history).

## Verdict

**Accept.**

The deletion is correct and complete against the proposal's Phase 4-6 scope. The verification floor is met on evidence produced this round: green typecheck/build, a single independently-confirmed environmental test failure, no dangling references, retained load-bearing machinery unmodified, and a working fail-loud guard demonstrated against a real fixture without building a container.
The deferred items (Phase 3 other-project migration, Phase 7 live dogfood, the warm-vs-cold `it.todo`) are correctly out of scope under the reboot constraint and are not acceptance gates for this branch.
The three non-blocking items are cosmetic or informational and can be addressed at merge time or ignored.

## Action Items

1. [non-blocking] Replace the three ` -- ` em-dashes in `README.md` with colons/commas per `writing-conventions.md`.
2. [non-blocking] Resolve the `flock.ts` / `flock.test.ts` dead-code pair: delete both, or amend the devlog note to record that the test survives.
3. [informational] At merge time, retain `main`'s `a823954` (bash-history feature); the `git diff main..HEAD` deletion of it is phantom (branch is behind `main`, not deleting the feature).

## Open Questions for the Overseer

The following are judgment calls left to the overseer, not blockers:

1. Should the branch be rebased onto current `main` (picking up `a823954`) before merge, to make the diff read cleanly and avoid any phantom-deletion risk during merge?
   - (a) Rebase now, re-run the suite, then merge.
   - (b) Merge as-is and rely on git's three-way merge to retain bash-history.
2. Is the retained-but-dead `flock.ts` worth a follow-up cleanup, or acceptable to carry as-is?
   - (a) Delete `flock.ts` + `flock.test.ts` in this branch.
   - (b) Leave both; note it in the devlog only.
   - (c) Defer to a separate dead-code sweep.
