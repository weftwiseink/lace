---
review_of: cdocs/proposals/2026-02-05-dotfiles-legacy-archive-migration.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T20:15:00-08:00
task_list: dotfiles/legacy-archive
type: review
state: archived
status: done
tags: [fresh_agent, scope_reduction, internal_consistency, phase_renumbering, out_of_scope_verification]
---

# Review (Round 3): Dotfiles Legacy Archive Migration -- Scope Reduction

## Summary Assessment

This round reviews the scope reduction revision that excludes `firefox/`, `tridactyl/`, `btrfs/`, and `macos/` from the archive migration. The changes are thorough and internally consistent: all `git rm`, `cp -a`, `diff -r`, and `mkdir` commands for the removed directories have been stripped from the implementation phases, Phase 4 (Firefox symlink update) has been removed entirely with correct renumbering, the `.chezmoiignore` update correctly retains ignore entries for out-of-scope directories that remain at repo root, and a new "Out of Scope Notes" section documents the rationale for each exclusion. The decision to keep `blackbox/` in archive scope is well-reasoned (it is only sourced by the bash config which is itself being archived). One non-blocking issue: the Objective section still says "all legacy files" which is now inaccurate. Verdict: **Accept**.

## Prior Action Items Status (Round 2)

1. **[non-blocking] Path consistency claim (Fedora 43)** -- Addressed in revision 2 indirectly. The Fedora 43 section now says "symlink targets in Phase 3 use `/var/home/mjr`" (singular, correct) rather than "Phases 3 and 4." The underlying path explanation was already clarified in revision 2. **Resolved.**

2. **[non-blocking] Phase 3 re-validation note** -- Addressed. The Phase 3 validation now includes a comment noting "After Phase 4, the originals at vscode/ will be gone" with the archive copy path as fallback reference. **Resolved.**

## Scope Reduction Verification

### Directories removed from archive scope

Verified that the following directories have been fully removed from all action-oriented sections (no `git rm`, `cp -a`, `diff -r`, `mkdir`, or `ln -snf` commands reference them in archive contexts):

- `firefox/` -- removed from archive structure, Phase 1 copy commands, Phase 1 validation, Phase 4 deletion, Phase 5 commit message. Phase 4 (Firefox symlink update) removed entirely. Firefox symlink documented as "out of scope" in both the Symlink De-linking Plan and Left Behind Files Report.
- `tridactyl/` -- removed from archive structure, Phase 1 copy/validate, Phase 4 deletion. Duplicate table entry moved to a NOTE below the table.
- `btrfs/` -- removed from archive structure, Phase 1 copy/validate, Phase 4 deletion.
- `macos/` -- removed from archive structure, Phase 1 copy/validate, Phase 4 deletion. The `dot_bashrc` re-routing plan correctly leaves the `macos/macos.sh` source path unchanged.

### blackbox/ retained in scope

The decision to keep `blackbox/` in archive scope is sound. `blackbox/blackbox.sh` is sourced by `dot_bashrc` in the Linux platform branch of the `case $(uname -s)` block. Since `dot_bashrc` is having its source paths rerouted to `archive/legacy/`, the blackbox path must also be rerouted. The `macos/macos.sh` path is left unchanged because `macos/` is staying in place -- this asymmetry is correctly handled.

### .chezmoiignore update

The proposed `.chezmoiignore` in Phase 5 correctly retains ignore entries for `firefox/`, `tridactyl/`, `btrfs/`, and `macos/` under a "Legacy directories remaining in repo root" comment. This prevents chezmoi from attempting to manage these directories. The existing entries for deleted directories (`bash/`, `blackbox/`, `vscode/`, etc.) are correctly removed since those directories will no longer exist.

## Section-by-Section Findings

### Phase Renumbering

The old Phase 4 (Firefox symlink update) has been removed, old Phase 5 is now Phase 4 (Delete originals), old Phase 6 is now Phase 5 (Commit). All internal references have been updated:

- Edge case "Shell Break During Migration": references Phase 4 for deletion. Correct.
- Edge case "Chezmoi State Drift": references Phase 4 for script deletion. Correct.
- Edge case "Chezmoi Apply Between Phases": references Phase 4 and Phase 5 correctly.
- Phase 3 validation NOTE: references "After Phase 4." Correct.
- Phase 4 NOTE: references "commit in Phase 5." Correct.
- Phase 5 NOTE: references "Phases 1, 2, 4, and 5." Correct.
- Rollback Strategy table: Phase 4 and Phase 5 entries match new numbering. Correct.
- Fedora 43 platform note: references "Phase 3" (singular) for symlink targets. Correct.

Historical revision entries (round 1, round 2) still reference old phase numbers. This is appropriate since they describe what those revisions changed at the time.

### Objective Section

**[non-blocking]** Line 53 reads: "Moving all legacy files to a structured `archive/legacy/` directory." This should say "in-scope legacy files" or similar, since four directories are explicitly excluded. Similarly, line 568 says "Copy all legacy files" and line 618 says "contains a complete copy of all legacy files" -- both should qualify the scope. These are minor wording issues that do not affect implementation correctness.

### Out of Scope Notes Section

Well-structured. Each directory has a clear rationale:
- Firefox: separate proposal (forward reference).
- Tridactyl: benign duplicate, no conflict due to `.chezmoiignore`.
- Btrfs: not referenced by any config being archived.
- Macos: still actively sourced by `dot_bashrc` on Darwin; path unchanged.

The macos entry is particularly important -- it explains why the `case $(uname -s)` Darwin branch is left untouched.

### Phase 4 Validation: Out-of-scope Directory Check

Good addition. The Phase 4 (delete originals) validation now includes:
```bash
for d in firefox tridactyl btrfs macos; do
  test -d "$d" && echo "$d still in place: OK" || echo "WARNING: $d missing (should not have been deleted)"
done
```
This actively guards against accidental deletion of out-of-scope directories. The same check appears in Phase 5 (commit) validation. Well-designed defensive validation.

### Phase 5 Commit Message

The commit message correctly lists the in-scope directories and explicitly notes the out-of-scope directories that remain. The note about Firefox being tracked in a separate proposal is helpful for git log archaeology.

### Left Behind Files Report

The Firefox symlink entry has been updated from "Symlink to archive" to "Symlink to `firefox/` in dotfiles repo" with status "Not affected by this migration (out of scope)." Accurate.

## Verdict

**Accept.** The scope reduction is internally consistent. All action commands, validation steps, rollback procedures, phase numbering, and cross-references have been correctly updated. The out-of-scope directories are properly documented and their `.chezmoiignore` entries are retained. The blackbox inclusion rationale is sound. One non-blocking wording issue in the Objective section does not affect correctness.

## Action Items

1. **[non-blocking]** In the Objective section (line 53), change "Moving all legacy files" to "Moving in-scope legacy files" or "Moving targeted legacy files." Apply the same qualifier to Step 1.2 ("Copy all legacy files") and Phase 1 Expected State ("contains a complete copy of all legacy files"). This aligns the wording with the reduced scope established by the "Out of Scope" inventory.
