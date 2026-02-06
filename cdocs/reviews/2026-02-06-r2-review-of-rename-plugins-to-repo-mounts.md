---
review_of: cdocs/proposals/2026-02-06-rename-plugins-to-repo-mounts.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T11:15:00-08:00
task_list: lace/rename-plugins-to-repo-mounts
type: review
state: live
status: done
tags: [rereview_agent, refactor, naming, completeness-check, revision_review]
---

# Review: Rename Plugins to Repo Mounts (Round 2)

## Summary Assessment

The proposal has been revised to address all three R1 blocking issues and both non-blocking issues. A subsequent revision (revision 2) reverted the `localMount` nested field name back to `overrideMount` per user feedback, with an updated design decision that clearly justifies keeping the original name. The proposal is now thorough, internally consistent, and ready for implementation. Verdict: **Accept**.

## R1 Action Item Resolution

### 1. [blocking] Fix BLUF inaccurate `overrideMounts` reference -- RESOLVED

The BLUF now reads: "restructure settings.json so the top-level `plugins` key becomes `repoMounts` (the nested `overrideMount` field is kept as-is)." This accurately describes what changes and what stays the same. No issues.

### 2. [blocking] Reconsider settings.json top-level key name -- RESOLVED

The settings.json top-level key is now `repoMounts`, matching the devcontainer.json key. The design decision section explicitly documents why `overrides` was rejected (too generic, ambiguous as lace gains more settings). The consistency argument is sound.

### 3. [blocking] Add `overview_and_quickstart.md` to change list or scope it out -- RESOLVED

An "Out of Scope" section was added (lines 340-348) that explicitly lists `overview_and_quickstart.md`, `bin/open-lace-workspace`, and `bin/wez-lace-into` with reasoning for each. The reasoning is correct -- these files reference "plugin" in the conventional sense (wezterm plugins, neovim plugins), not in the lace-specific "mounted repo" sense being renamed.

### 4. [non-blocking] Add `plugins`/`pluginCount` local variables to resolve-mounts.ts change list -- RESOLVED

Lines 196-197 of the proposal now include the `plugins` local variable (renamed to `repoMounts`) and the `pluginCount` local variable (renamed to `repoMountCount`).

### 5. [non-blocking] Clarify `bin/open-lace-workspace` and `bin/wez-lace-into` -- RESOLVED

Both files are now listed in the Out of Scope section with clear reasoning.

## Section-by-Section Findings

### BLUF

**[non-blocking]** The BLUF is clear, accurate, and appropriately scoped. It correctly describes the three dimensions of the rename (devcontainer.json key, settings.json top-level key, container/host paths) and notes that `overrideMount` is kept as-is. The parenthetical about `overrideMount` is a good addition -- it prevents future readers from wondering whether the nested field was overlooked.

### Schema Changes

**[non-blocking]** The settings.json section header was updated from "the top-level key and the override field change" to "the top-level key changes," which correctly reflects that only one thing changes now. The NOTE paragraph is well-written and justifies the `overrideMount` retention without being defensive.

### File-by-File Change List

**[non-blocking]** The change list entries for `overrideMount` now consistently read "Keep as-is (no rename)" across settings.ts, settings.test.ts, mounts.ts, mounts.test.ts, both integration test files, and the README. This is a good documentation practice -- explicitly noting "no change" avoids ambiguity about whether the field was simply forgotten.

**[non-blocking]** The mounts.ts entry for `pluginSettings?.overrideMount` (line 164) now reads "Change to `repoSettings?.overrideMount` (field name unchanged, only the variable prefix changes)." This is precise and helpful -- it calls out the subtle distinction between the variable rename and the field name retention.

### Design Decisions

**[non-blocking]** The decision "Keep `overrideMount` as the nested field name in per-repo settings" is well-argued. The reasoning acknowledges the `localMount` alternative and explains why `overrideMount` was preferred: it communicates both that it is a mount source and that it overrides the default behavior. The point about the outer key describing the system while the inner key describes the action is a clean conceptual separation.

### Revision History

**[non-blocking]** The two revisions are well-documented in the frontmatter. Revision 1 addresses the R1 blocking issues; revision 2 addresses the user feedback on `localMount` vs `overrideMount`. The trail is clear for future readers.

### Edge Cases, Test Plan, Implementation Phases

No changes since R1, and no new issues. These sections remain appropriate for a pure rename refactoring.

## Verdict

**Accept.** All three R1 blocking issues have been resolved. The user-requested revert from `localMount` to `overrideMount` has been cleanly applied across the entire proposal -- schema examples, file-by-file change lists, test data references, and design decisions are all internally consistent. The proposal is implementation-ready.

## Action Items

No blocking action items. The proposal is ready for implementation.

1. [non-blocking] When implementing, consider running `grep -r "localMount" packages/lace/src/` as a sanity check to confirm this term does not appear in the codebase (it should not, since it was only considered and never shipped).
