---
review_of: cdocs/proposals/2026-02-05-dotfiles-legacy-archive-migration.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T21:45:00-08:00
task_list: dotfiles/legacy-archive
type: review
state: archived
status: done
tags: [fresh_agent, consistency_audit, chezmoi_removal, rollback_simplification, simplification_pass]
---

# Review (Round 4): Dotfiles Legacy Archive Migration -- Chezmoi Removal and Simplification

## Summary Assessment

This round reviews the simplification revision that removes operational chezmoi references (chezmoi was never applied on this machine) and collapses rollback sections. The changes are thorough and internally consistent. All `chezmoi apply`, `chezmoi diff`, `chezmoi managed`, and `chezmoi doctor` commands have been removed from action-oriented sections. Per-phase Rollback subsections have been eliminated. Phase 0 is appropriately simplified to a git branch backup. Two minor consistency issues found: a stale comment label in Phase 1 ("Chezmoi run_once scripts") and the Phase 2 title in the Shell Break edge case still says "and apply." Verdict: **Accept** with non-blocking observations.

## Prior Action Items Status (Round 3)

1. **[non-blocking] Objective wording ("all legacy files" vs "in-scope")** -- Not addressed in this revision. The Objective still reads "Moving all legacy files." This was a cosmetic issue from round 3 and remains non-blocking. **Still open.**

## Consistency Audit: Chezmoi References

### Operational chezmoi commands (must be removed)

Searched for `chezmoi apply`, `chezmoi diff`, `chezmoi managed`, `chezmoi doctor`, `chezmoi cat`, `chezmoi state`, `chezmoi init` in action-oriented sections (Tasks, Validation, Pre-conditions). **All removed.** Specifically:

- Phase 0: `chezmoi doctor` pre-condition removed. `chezmoi managed` backup steps removed.
- Phase 2: `chezmoi diff` preview step removed. `chezmoi apply` step replaced with `cp dot_bashrc ~/.bashrc`. Post-apply `chezmoi diff` verification removed.
- Phase 4: `chezmoi apply --dry-run` validation removed.
- Phase 5: `chezmoi managed` and `chezmoi managed --include=scripts` verification removed. `.chezmoiignore` update step removed entirely.
- Rollback Strategy: `chezmoi apply` removed from all rollback procedures.
- Edge Cases: "Chezmoi State Drift," "Chezmoi Apply Runs Between Phases," and "Local Modifications to Managed Files" sections all removed.

No operational chezmoi commands remain in any action-oriented section. **Pass.**

### Legitimate chezmoi references (should remain)

The following chezmoi references are legitimate and correctly retained:

- `.chezmoiignore` as a literal filename in repo listings (lines 81, 768, 845). The file physically exists in the repo.
- `chezmoi_run_once/` as a literal directory name in archive structure (lines 194, 305, 488, 511-513, 531-533). This is the chosen archive subdirectory name.
- Historical revision entries (lines 20, 28) that describe what prior revisions changed. Appropriately preserved as historical record.
- The new revision entry (lines 42-47) documenting this simplification, which necessarily references chezmoi to explain what was removed.
- Explanatory context in BLUF (line 52), Background (lines 81, 90, 119), Bashrc Re-routing (line 263), run_once Handling (lines 267-269), and Decision 4 (line 310) that explains chezmoi was never applied. These provide essential context for why the proposal does not use chezmoi operationally.

**Pass.**

### References to /tmp/dotfiles-migration-backup/

Phase 0 no longer creates `/tmp/dotfiles-migration-backup/`. Searched for remaining references:

- Shell Break edge case recovery (line 331): Now uses `git show pre-legacy-archive-backup:dot_bashrc > ~/.bashrc`. **Updated correctly.**
- Phase 4 pre-conditions (line 692): Now references "`pre-legacy-archive-backup` branch and git history." **Updated correctly.**

No stale `/tmp/dotfiles-migration-backup/` references remain. **Pass.**

### Per-phase Rollback subsections

Checked each phase for `#### Rollback` subsections:

- Phase 0: No rollback subsection (was "N/A" before, now omitted). **Correct.**
- Phase 1: No rollback subsection. **Correct.**
- Phase 2: No rollback subsection. **Correct.**
- Phase 3: No rollback subsection. **Correct.**
- Phase 4: No rollback subsection. **Correct.**
- Phase 5: No rollback subsection. **Correct.**

Top-level Rollback Strategy (line 848-850) collapsed to a single line referencing `git reflog` and the backup branch. **Correct.**

### Phase numbering

Phases are numbered 0 through 5. All cross-references verified:

- Edge case "Shell Break": references Phase 1, Phase 2, Phase 4. **Correct.**
- Edge case "Symlink Target Already Deleted": references Phase 0, Phase 1, Phase 3. **Correct.**
- Phase 3 validation NOTE: references "After Phase 4." **Correct.**
- Phase 4 pre-deletion checklist: references Phase 1, Phase 2, Phase 3. **Correct.**
- Phase 4 NOTE: references "commit in Phase 5." **Correct.**
- Phase 5 commit message: references "Phase 3." **Correct.**
- Fedora 43 platform note: references "Phase 3." **Correct.**

**Pass.**

## Section-by-Section Findings

### BLUF (line 52)

Well-revised. Now states two categories of risk (down from three), explicitly notes chezmoi was never applied, and correctly describes run_once scripts as simple archive candidates. The removal of "rollback strategy" from the deliverables list aligns with the simplified approach.

### Background: Current Repository State (lines 69-102)

**[non-blocking]** The "Modern" section header reads "dot_* naming convention, to KEEP" (line 73). This is accurate and avoids implying chezmoi management. The `.chezmoiignore` entry (line 81) correctly notes "present in repo but chezmoi has never been applied." Clean.

### Background: Live System State (lines 117-141)

Correctly relabeled from "Chezmoi-managed files" to "Config files on system (placed by old setup.sh or manually, NOT by chezmoi)." The parenthetical on line 120 adds helpful provenance detail.

### run_once Script Handling (lines 265-269)

Clear and concise. Correctly explains these are just shell scripts that were never executed by chezmoi. The "straightforward `git mv` with no side effects" framing is accurate given no chezmoi state exists.

### Phase 0 (lines 424-472)

Appropriately simplified. The `git checkout -b pre-legacy-archive-backup` approach is lighter than the previous `/tmp` backup with chezmoi state snapshots. The pre-condition no longer requires `chezmoi doctor`. The verification steps (shell works, VSCode symlinks resolve) are retained -- these are the checks that actually matter.

### Phase 1 (lines 475-544)

**[non-blocking]** Line 511 comment reads "# Chezmoi run_once scripts" above the copy commands. This is a label for the copy block, and while the directory is indeed named `chezmoi_run_once/`, the comment could be read as implying these are actively chezmoi-managed. Suggest changing to "# Legacy install scripts (run_once)" for consistency with the rest of the document's framing. Very minor.

### Phase 2 (lines 547-633)

The replacement of `chezmoi apply` with `cp dot_bashrc ~/.bashrc` (line 588) is the correct approach given chezmoi was never applied. The verification steps are unchanged and appropriate -- they test actual shell behavior, not chezmoi state.

**[non-blocking]** Line 321 in the Shell Break edge case reads "Update `dot_bashrc` to point to archive paths and apply." The phrase "and apply" is a vestige of the chezmoi apply step. Since the Phase 2 title is now "Update dot_bashrc Source Paths" (without "and Apply"), this edge case summary should match. Suggest: "Update `dot_bashrc` to point to archive paths and copy to system."

### Phase 5 (lines 772-845)

Correctly streamlined. The `.chezmoiignore` update step has been removed entirely, and the `chezmoi managed` verification is gone. The commit message no longer mentions `.chezmoiignore` cleanup. The `git add` command on line 786 no longer includes `.chezmoiignore`.

### Left Behind Files Report (lines 383-420)

The "Chezmoi State Artifacts" subsection (stale `scriptState` entries) has been correctly removed -- there are no chezmoi state artifacts since chezmoi was never applied. The "Active Config Files" table header changed from "Chezmoi-Managed" to "Active Config Files (Manually Placed, Tracked in Repo)" with "Source of Truth" column instead of "Managed By." Accurate.

### Rollback Strategy (lines 848-850)

Single line. References `git reflog` and the backup branch. Sufficient given the user's stated preference for ad-hoc resolution.

## Verdict

**Accept.** The simplification is internally consistent. All operational chezmoi commands have been removed. No stale `/tmp/dotfiles-migration-backup/` references remain. Per-phase rollback subsections are eliminated. Phase numbering is consistent. The remaining chezmoi references are all legitimate (literal filenames, directory names, historical revision entries, or explanatory context about why chezmoi is not used). Two non-blocking wording nits identified.

## Action Items

1. **[non-blocking]** Line 511: Change comment "# Chezmoi run_once scripts" to "# Legacy install scripts (run_once)" for consistency with the document's framing that these were never executed by chezmoi.
2. **[non-blocking]** Line 321: Change "Update `dot_bashrc` to point to archive paths and apply" to "Update `dot_bashrc` to point to archive paths and copy to system" to match the Phase 2 title change.
3. **[non-blocking, carried from round 3]** Objective section: "Moving all legacy files" should say "Moving in-scope legacy files" to match reduced scope.
