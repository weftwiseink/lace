---
review_of: cdocs/devlogs/2026-03-25-user-json-rollout-implementation.md
first_authored:
  by: "@claude-sonnet-4-6"
  at: 2026-03-25T12:00:00-07:00
task_list: lace/user-json-rollout
type: review
state: live
status: done
tags: [fresh_agent, implementation_review, user_config, lace_bugs, verification]
---

# Review: user.json Rollout Implementation

> BLUF: The implementation successfully delivers the core proposal goal: `user.json` now populates the developer environment with nushell, neovim, claude-code, git identity, and mounts across all lace containers.
> Three genuine lace code bugs were discovered and fixed (user features not reaching prebuild, `defaultShell` not propagating, `chsh` failing without `/etc/shells` entry).
> The bugs are correctly fixed.
> The verification output is concrete and covers most critical items, though several checklist items remain deferred without explicit tracking.
> One structural concern: the `minPrebuild` mutation in `up.ts` relies on shared object references from `configMinimal.raw` that could be silently fragile if the data path changes.

## Summary Assessment

This devlog documents an implementation of the `user.json` rollout proposal across configuration files and lace core code.
The work went through multiple rebuild-verify-fix cycles and emerged with a passing container.
The three bugs found during Phase 2/3 are substantive: two are in `up.ts`/`prebuild.ts` (user features not included in prebuild, `defaultShell` not propagating to `configMinimal.raw`) and one is in the `lace-fundamentals` shell.sh script (`chsh` requiring `/etc/shells` registration).
All three fixes are correct and appropriate.
The proposal deviations are well-documented: neovim feature source changed to the lace-native version, nushell binary path corrected to `/usr/local/bin/nu`.
The verification section has concrete output but leaves six checklist items deferred without issue tracking.
Verdict: **Accept** with non-blocking suggestions.

## Section-by-Section Findings

### Deviations from Proposal

Both deviations are correctly documented and justified.
The neovim deviation (lace-native feature vs. `neovim-homebrew`) is the right call: the lace feature provides plugin persistence mount, which is more appropriate for this environment.
The nushell binary path correction (`/usr/local/bin/nu` vs. `/usr/bin/nu`) was discovered empirically and is now correct.

No issues.

### Phase 1 (Implementation Notes)

The five-commit sequence is described clearly.
Two mechanical issues are documented (trailing comma, `installsAfter` format) and both are correctly attributed to the proposal having used wrong format.

**Finding: `installsAfter` format discrepancy is a proposal bug, not an implementation bug.**
The proposal's Phase 1 action item shows `"installsAfter": { "ghcr.io/eitsupi/...": {} }` (object format).
The spec requires an array of strings.
The devlog correctly identifies and fixes this, but does not update the proposal's Phase 1 section to reflect the correct format.
This is non-blocking: the proposal has `status: implementation_wip` so future readers should consult the devlog, but it leaves a latent confusion source.

### Phase 2/3 (Bug Fixes)

**Bug 1: User features not included in prebuild** (Issue 1).
Root cause: `runPrebuild` in `prebuild.ts` read the source `devcontainer.json` directly, bypassing the in-memory config that had user features merged in.
Fix: Added `prebuildFeatures?: Record<string, Record<string, unknown>>` override option to `PrebuildOptions`.
`up.ts` calls `extractPrebuildFeatures(configMinimal.raw)` (which by that point has user features merged) and passes the result as `prebuildFeatures` to `runPrebuild`.
The fix is correct.

The code path at `up.ts:820-826` reads:
```ts
const mergedPrebuild = extractPrebuildFeatures(configMinimal.raw);
const prebuildResult = runPrebuild({
  ...
  prebuildFeatures: mergedPrebuild.kind === "features" ? mergedPrebuild.features : undefined,
});
```
This correctly passes `undefined` when `mergedPrebuild.kind !== "features"`, preserving the opt-out path in `runPrebuild`.

**Bug 2: `defaultShell` not propagating to `configMinimal.raw`** (Issue 6).
The `defaultShell` injection code at `up.ts:724-750` writes the value into `resolvedConfig` but also needs to reach `configMinimal.raw` because `runPrebuild` reads from `configMinimal.raw` (after the fix to Bug 1).
The fix adds a mutation back to `minPrebuild[fundamentalsRef].defaultShell`.

**Structural concern (non-blocking):** The mutation at lines 742-748 is subtle.
`minPrebuild` is extracted as:
```ts
const minPrebuild = (minLace.prebuildFeatures ?? {}) as Record<...>;
if (minPrebuild[fundamentalsRef]) {
  minPrebuild[fundamentalsRef].defaultShell = userConfigDefaultShell;
}
```
This relies on `minLace.prebuildFeatures` being a reference to the same object already stored in `configMinimal.raw.customizations.lace.prebuildFeatures`.
Because no `structuredClone` is applied to `minCustomizations`, this is true and the mutation propagates correctly.
However, the code pattern assumes mutable shared reference semantics across a multi-step extraction chain - this is correct today but is easy to break accidentally if a future refactor adds a clone.
A comment explaining the aliasing intent would make this safer.
(Non-blocking: the existing comment at line 741 partially explains the intent.)

**Bug 3: `chsh` requires `/etc/shells` entry** (Issue 5).
`shell.sh` now adds the shell path to `/etc/shells` before calling `chsh`.
The fix is correct and defensive: it uses `grep -qxF` for exact-line matching.
The ordering - add to `/etc/shells`, then `chsh`, then log success - is correct.

### Changes Made Table

The table is accurate against the files read.
One omission: `~/.config/lace/user.json` and `~/.config/lace/settings.json` are listed but are host-side config files outside the repo.
These cannot be verified from the codebase.
The devlog should note these are host-side only (non-blocking: the table context makes this implicit).

### Verification

The verification output snippet is concrete and covers the critical items:
- Shell: `/usr/local/bin/nu` as SHELL and login shell, correct nu version.
- Editor: nvim version and EDITOR/VISUAL env vars present.
- Git: correct identity (`micimize` / `rosenthalm93@gmail.com`).
- Claude: version and CLAUDE_CONFIG_DIR confirmed.
- Mounts: screenshots, dotfiles, authorized_keys confirmed.
- Dotfiles: nushell config, nvim init.lua, starship.toml confirmed.
- Tools: git, delta, chezmoi, curl, jq, less confirmed.

**Finding: `GIT_AUTHOR_NAME` noted as "unset" in the verification output but the proposal's checklist required this to be verified.**
The verification line reads: `Git: micimize / rosenthalm93@gmail.com, GIT_AUTHOR_NAME unset`.
This is correct per the proposal (only `LACE_GIT_NAME` / `LACE_GIT_EMAIL` should be set, not `GIT_AUTHOR_NAME`).
No issue - this is a positive verification.

**Finding: Deferred items lack issue tracking references** (non-blocking).
Six items are listed as "Not verified (deferred)":
- Nushell history persistence (has an RFP).
- SSH connect test (practical constraint noted).
- Cross-project rebuild (dotfiles devcontainer).
- Starship prompt rendering.
- Carapace completions.
- Neovim lazy.nvim plugin pre-install.

The nushell history deferral is well-justified with a pointer to the dedicated RFP.
The others lack explicit follow-up tracking.
In particular, "cross-project rebuild" was a success criterion in the proposal (Phase 2 checklist), and "Neovim lazy.nvim plugin pre-install" is a `postCreateCommand` item that may never have run in the build mode used.
These deferred items should be explicitly noted as open issues or referenced in follow-up proposals.

**Finding: `lace-fundamentals` version test is stale** (blocking for test accuracy, non-blocking for the implementation itself).
The test `fundamentals-scenarios.test.ts` at line 197 asserts `expect(metadata.version).toBe("1.0.0")`.
The feature was bumped to `1.0.2` in this implementation.
This test will now fail.
If the test suite was run as part of this work, this failure would have been caught.
The devlog does not mention running tests, and this is a concrete regression.

### Frontmatter

The devlog frontmatter is correct: `type: devlog`, `state: live`, `status: review_ready`.
The `tags` field is appropriate.
The `first_authored.by` model ID (`@claude-opus-4-6-20250605`) follows the correct format.

**Finding: Proposal `status` field uses non-spec value** (non-blocking for this review, but noted).
The proposal's `status: implementation_wip` is not in the spec's valid values (which include `wip`, `review_ready`, `implementation_ready`, `evolved`, etc.).
This is a triage concern for the proposal document, not this devlog.

## Verdict

**Accept.**

The implementation correctly delivers the proposal goals.
The three bugs discovered are fixed correctly.
The verification evidence is concrete.
The stale test (F3 version assertion) is the only concrete code regression introduced - it should be fixed but does not block acceptance of the implementation itself.

## Action Items

1. [non-blocking] Fix the stale version assertion in `fundamentals-scenarios.test.ts` line 197: change `"1.0.0"` to `"1.0.2"` to match the current feature version after the bumps in this rollout.
2. [non-blocking] Add a comment in `up.ts` around lines 742-748 explaining that `minPrebuild` is an alias into `configMinimal.raw` (not a clone) and that the mutation is intentional.
3. [non-blocking] Create follow-up tracking for the unresolved deferred verification items: cross-project rebuild (dotfiles devcontainer with same `user.json`) and neovim lazy.nvim plugin pre-install verification.
4. [non-blocking] Update the proposal's Phase 1 action item 2 to reflect the correct `installsAfter` array format (`["feature-id"]`), rather than the incorrect object format shown, to prevent future confusion.
