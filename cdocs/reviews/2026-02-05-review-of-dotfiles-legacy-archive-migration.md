---
review_of: cdocs/proposals/2026-02-05-dotfiles-legacy-archive-migration.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T12:45:00-08:00
task_list: dotfiles/legacy-archive
type: review
state: live
status: done
tags: [self, migration, archive, symlinks, chezmoi, correctness_check]
---

# Review: Dotfiles Legacy Archive Migration

## Summary Assessment

This proposal provides a thorough, well-researched plan for archiving legacy configuration files in the dotfiles repository. The investigation phase is particularly strong: live system state was verified empirically (symlinks, chezmoi state, file diffs), and the critical dependency chain from `~/.bashrc` through the legacy `bash/` and `vscode/` directories is identified correctly as the primary risk. The phased implementation with copy-before-delete and per-phase rollback is sound. One blocking issue exists: the proposal contains an inaccurate claim about chezmoi's handling of the `run_once_*` scripts that could cause a surprise during migration. Two non-blocking items would improve the proposal. Verdict: **Revise** to address the chezmoi run_once accuracy issue, then this is ready for implementation.

## Section-by-Section Findings

### BLUF

The BLUF is comprehensive and accurately summarizes the three risk categories. It correctly identifies the key deliverables (file inventory, phased plan, rollback, left-behind report). Slightly long for a BLUF but justified given the operational nature of this work.

**No issues.**

### Background / Current Repository State

The file inventory is thorough and cross-referenced against live system state. The duplicate files table is a valuable addition -- confirming which legacy files are exact copies of the chezmoi-managed files prevents accidental data loss.

The "Critical Dependency" section correctly identifies that `~/.bashrc` sources from `bash/`, `vscode/`, and platform-specific directories. This is the single most important finding in the proposal.

**No issues.**

### Proposed Solution: Archive Directory Structure

The proposed structure is clean and mirrors the original layout under `archive/legacy/`. Placing `chezmoi_run_once/` as a separate subdirectory (rather than scattering scripts) makes the archive navigable.

**No issues.**

### Proposed Solution: Symlink De-linking Plan

The asymmetric treatment of VSCode (copy) vs. Firefox (update symlink) is well-reasoned. Decision 3 and Decision 4 provide clear rationale for the difference.

One minor note: the `cp --remove-destination` command for VSCode symlinks is correct and handles the symlink-to-file conversion properly.

**No issues.**

### Proposed Solution: Bashrc Re-routing Plan

The re-routing approach is conservative and appropriate. The before/after diffs are clear and the three locations requiring changes are all identified:
1. `BASHFILES_DIR` variable
2. `vscode/init.sh` source
3. Platform-specific case statement

**No issues.**

### Proposed Solution: Chezmoi run_once Script Handling

**[BLOCKING]** The proposal states:

> 1. The `.chezmoiignore` already excludes `bash/`, `vscode/`, etc.

This is true for those directories, but the sentence appears in the context of explaining why moving `run_once_*` scripts is safe. The `run_once_*` scripts are NOT in `.chezmoiignore` -- they are actively managed by chezmoi (confirmed: `chezmoi managed --include=scripts` returns all three scripts).

The practical consequence: when the `run_once_*` files are deleted from the repo root in Phase 5, chezmoi will no longer see them in its source state. For `run_once` scripts specifically, this is benign -- chezmoi only runs them once and tracks execution in `scriptState`. Removing the source does not trigger re-execution or errors.

However, the proposal should:
1. Correct the misleading claim that `.chezmoiignore` covers the scripts
2. Explicitly state that the scripts ARE currently managed by chezmoi (`chezmoi managed --include=scripts` lists them)
3. Confirm that removing `run_once_*` source files from chezmoi's view is safe because chezmoi's `run_once` semantics prevent re-execution regardless
4. Consider whether to add `run_once_*` patterns to `.chezmoiignore` BEFORE the move, or simply note that after Phase 5 the source files are gone and chezmoi silently stops tracking them

The conclusion (that moving them is safe) is correct, but the reasoning contains a factual error that could mislead a future reader or implementer.

### Design Decisions

All five decisions are well-structured with clear rationale. Decision 2 (re-route vs. inline) is the most consequential and the reasoning is sound -- minimizing the diff to `dot_bashrc` reduces risk in the most sensitive file.

**No issues.**

### Edge Cases

The "Shell Break During Migration" section correctly identifies the atomicity concern and the copy-then-update-then-delete strategy. The "Chezmoi State Drift" section reaches the right conclusion (stale entries are harmless) but inherits the inaccuracy from the run_once handling section.

**Non-blocking:** The edge case section could mention one additional scenario: what happens if `chezmoi apply` is run between Phase 1 (copy) and Phase 2 (update paths)? Answer: nothing changes, because `dot_bashrc` still points to the original paths and the archive copies are invisible to chezmoi. This is fine but worth stating explicitly to reassure the implementer.

### Left Behind Files Report

This section is excellent. The three-tier classification (chezmoi-managed, installed software, orphaned files) with cleanup actions is exactly what was requested. The chezmoi state artifacts table with the cleanup command is a nice touch.

**No issues.**

### Implementation Phases

The phasing is logical: snapshot -> copy -> reroute -> de-link -> delete -> commit. Each phase has success criteria, constraints, and rollback.

**Non-blocking:** Phase 6 proposes committing "the entire migration as a single atomic commit." However, the migration includes changes to both the dotfiles repo (file moves, `dot_bashrc` edits, `.chezmoiignore` updates) and system-side operations (de-linking symlinks, running `chezmoi apply`). The "single commit" can only capture the repo-side changes. The system-side operations (Phases 3 and 4) happen outside git. This should be clarified: the commit captures Phases 1, 2, 5, and 6 (repo changes), while Phases 3 and 4 are system operations documented but not version-controlled.

### Rollback Strategy

The per-phase rollback table is clear. The "full rollback" shortcut (`git checkout -- . && chezmoi apply`) is correct but note that it would not restore the VSCode or Firefox symlinks (those are system-side, not in git). The Phase 3 and Phase 4 rollback instructions cover this, but the "full rollback" line could add a caveat.

### Open Questions

All four questions are relevant and appropriately scoped. Question 1 (pnpm divergence) is worth resolving before or during the migration to avoid archiving a version with unintentional differences.

**No issues.**

## Verdict

**Revise.** One blocking issue (chezmoi run_once script handling accuracy) must be corrected. The conclusion is correct but the reasoning is wrong in a way that could mislead implementers. Two non-blocking suggestions would improve clarity.

## Action Items

1. **[blocking]** Correct the "Chezmoi run_once Script Handling" section to accurately state that the `run_once_*` scripts ARE currently managed by chezmoi (not ignored), and that removing them from the source directory is safe specifically because of `run_once` semantics (chezmoi tracks execution state separately and does not re-run or error when the source file disappears).

2. **[non-blocking]** In Phase 6, clarify that the "single atomic commit" captures repo-side changes only. System-side operations (VSCode symlink materialization in Phase 3, Firefox symlink update in Phase 4) are not version-controlled and should be noted as manual prerequisites completed before the commit.

3. **[non-blocking]** In the Rollback Strategy summary, add a note that the "full rollback" shortcut (`git checkout -- . && chezmoi apply`) restores repo state but does not automatically restore the VSCode/Firefox symlinks. Reference the Phase 3/4 rollback instructions for those.
