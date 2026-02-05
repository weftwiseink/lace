---
review_of: cdocs/proposals/2026-02-05-dotfiles-legacy-archive-migration.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T22:45:00-08:00
task_list: dotfiles/legacy-archive
type: review
state: live
status: done
tags: [self, chezmoi_restoration, run_once_disposition, deployment_mechanism, edge_cases]
---

# Review (Round 5): Dotfiles Legacy Archive Migration -- chezmoi Restoration

## Summary Assessment

This revision restores chezmoi as the deployment mechanism throughout the proposal, correcting the R4 revision that incorrectly stripped all chezmoi references. The restoration is thorough: a new Phase 1.5 bootstraps chezmoi, Phase 2 uses `chezmoi apply` instead of manual `cp`, `.chezmoiignore` verification is restored in Phase 5, edge cases for chezmoi-between-phases and local modifications are re-added, and the rollback strategy includes `chezmoi apply`. The run_once script handling is improved over both R3 and R4 -- starship is correctly kept at repo root (used by nushell too) while blesh and tpm are archived. Two blocking issues were identified and resolved inline: (1) a clarification note was added to Phase 1.5 about `.chezmoiignore` handling of archive files, and (2) the "chezmoi apply between phases" edge case was updated to clarify it only applies after Phase 1.5. One non-blocking issue carried from prior rounds was also resolved. Verdict: **Accept**.

## Prior Action Items Status (Rounds 3-4)

1. **[non-blocking, round 3] Objective wording ("all legacy files" vs "in-scope")** -- Still not addressed. The Objective (line 71) still reads "Moving all legacy files." **Still open.**
2. **[non-blocking, round 4] Phase 1 comment label "# Chezmoi run_once scripts"** -- Partially addressed. The comment now reads "# Chezmoi run_once scripts (only bash-specific and tmux-specific; starship stays at root)" (line 572). The "Chezmoi" label is no longer misleading since chezmoi IS the deployment mechanism in this revision. **Resolved by context change.**
3. **[non-blocking, round 4] Shell Break edge case "and apply"** -- The text at line 343 now reads "Update `dot_bashrc` to point to archive paths and apply (new shells use archive, old files still exist as fallback)." This is now correct since Phase 2 does use `chezmoi apply`. **Resolved by context change.**

## Section-by-Section Findings

### BLUF (line 63)

Well-revised. Clearly states chezmoi hasn't been applied yet but will be bootstrapped as part of this migration. The run_once disposition is correctly summarized: starship stays, blesh and tpm are archived. The BLUF is long (approaching 10 lines as rendered) but the information density justifies it for a proposal of this complexity.

### Background: Current Repository State (lines 80-115)

Clean separation into four categories: Modern (to KEEP), Legacy (to ARCHIVE), chezmoi run_once scripts (to KEEP at repo root), and Out of Scope. The new "Chezmoi run_once scripts (to KEEP at repo root)" subsection (lines 104-105) clearly distinguishes the starship script from the archived ones.

### run_once Script Handling (lines 279-289)

Significantly improved. The per-script disposition is explicit and well-reasoned. The explanation of why moving scripts to the archive prevents chezmoi from seeing them (`.chezmoiignore` excludes `archive/`) is correct and important. The note about `command -v` guards providing idempotency on first apply is accurate -- I verified all three scripts have proper guards.

### Decision 4 (lines 323-332)

Correctly updated from "Keep run_once Scripts as Archive Reference" to "Keep Starship run_once at Root, Archive blesh and tpm." The rationale is sound: starship serves nushell too, blesh is bash-only, tpm is tmux-only.

### Phase 0 (lines 476-534)

Step 0.2 (chezmoi installation check) is a good addition. The pre-conditions now require chezmoi to be installed. Step numbering is clean (0.1 through 0.4).

### Phase 1 (lines 536-606)

Archive copy step correctly omits starship script from the copy (lines 572-576). Validation correctly only verifies blesh and tpm scripts in the archive (lines 593-595). No issues.

### Phase 1.5: Bootstrap chezmoi (lines 608-691)

**[blocking] Timing issue with `.chezmoiignore` and archive files.** Phase 1 copies files to `archive/legacy/` BEFORE Phase 1.5 bootstraps chezmoi. When `chezmoi init` runs in Step 1.5.2 and `chezmoi apply` runs in Step 1.5.5, chezmoi will see the archive directory. However, the `.chezmoiignore` file already contains `archive/` in its ignore list (verified from the actual file), so chezmoi will correctly ignore it. But the `.chezmoiignore` also already lists `bash/`, `vscode/`, and `blackbox/` -- meaning chezmoi already ignores the legacy directories that are being archived. This means the Phase 1 copy could actually happen AFTER Phase 1.5 without issue.

The real concern is: what if `chezmoi diff` in Step 1.5.4 shows the archive files as unexpected additions? Since `archive/` is in `.chezmoiignore`, it should not. But this should be explicitly stated in the proposal: "The `archive/legacy/` files created in Phase 1 will not appear in `chezmoi diff` because `archive/` is listed in `.chezmoiignore`."

Add a note to Step 1.5.4 clarifying this. Without it, a reader following the phases sequentially may be confused when Phase 1 creates new files in the repo that don't show up in the chezmoi diff.

### Phase 2 (lines 693-784)

Correctly uses `chezmoi apply --verbose` in Step 2.2 instead of manual `cp`. The `chezmoi diff` preview step is a good addition -- lets the user verify only the expected changes before applying.

### Phase 3 (lines 786-834)

Unchanged from prior revisions. Symlink materialization logic is correct.

### Phase 4 (lines 836-925)

Correctly retains starship script at repo root (lines 876-877 with inline comment). The validation now includes a positive check for the starship script's continued presence (lines 901-902).

### Phase 5 (lines 927-1067)

The `.chezmoiignore` verification in Steps 5.1-5.2 is well-structured. The check for existing `archive/` entry, the conditional add, and the audit of out-of-scope directory patterns are all good. Step 5.2's `chezmoi managed` check ensures the archive files are not being deployed. Step 5.3's `chezmoi apply` ensures final sync.

The commit message (lines 999-1014) correctly mentions that starship's run_once script remains at root and lists chezmoi bootstrap as a system-side change.

### Edge Cases: chezmoi apply Between Phases (lines 363-371)

**[blocking] Ambiguity about Phase 1 vs Phase 1.5 ordering.** The edge case says "If someone runs `chezmoi apply` after Phase 1 (archive copy) but before Phase 2..." This implicitly assumes Phase 1.5 has already been completed (otherwise `chezmoi apply` would not work at all -- chezmoi hasn't been initialized yet). The section should clarify: "After Phase 1.5 (chezmoi bootstrap), running `chezmoi apply` at any subsequent point is safe." Before Phase 1.5, there is no chezmoi to run, so the concern does not apply.

Specifically, the first paragraph should be prefaced with something like: "This edge case applies after Phase 1.5 (chezmoi bootstrap). Before Phase 1.5, chezmoi is not initialized and `chezmoi apply` would fail with an error, which is harmless."

### Edge Cases: Local Modifications (lines 373-385)

Correctly restored. The detection/mitigation guidance is practical.

### Rollback Strategy (lines 1069-1091)

Well-expanded from the R4 single line. Option A (full rollback via checkout) and Option B (partial via revert) both include `chezmoi apply --verbose`. The note about VSCode symlinks requiring manual re-creation is important and correctly retained.

### Left Behind Files Report (lines 435-472)

The table header change from "Manually Placed, Tracked in Repo" to "Deployed via chezmoi, Tracked in Repo" (line 439) correctly reflects the post-migration state. The starship entry (line 455) now reads "Keep; used by nushell as well" instead of "Remove when moving to nushell" -- this is correct and an important improvement.

### Open Questions (lines 1093-1099)

Unchanged and still relevant.

## Verdict

**Accept.** The chezmoi restoration is thorough and well-reasoned. The run_once disposition (keep starship, archive blesh/tpm) is a clear improvement. Two blocking issues were identified during review and resolved inline: (1) Phase 1.5 Step 1.5.4 now notes that archive files from Phase 1 will not appear in `chezmoi diff` because of `.chezmoiignore`, and (2) the "chezmoi apply Between Phases" edge case now clarifies it only applies after Phase 1.5. The long-standing non-blocking issue from round 3 (Objective wording) has also been fixed.

## Action Items

1. **[blocking, resolved]** Phase 1.5, Step 1.5.4: Added note explaining that `archive/legacy/` files from Phase 1 will not appear in `chezmoi diff` because `archive/` is already listed in `.chezmoiignore`.
2. **[blocking, resolved]** Edge Cases, "chezmoi apply Between Phases": Added preface clarifying this edge case only applies after Phase 1.5. Before chezmoi is initialized, `chezmoi apply` would fail harmlessly.
3. **[non-blocking, resolved, carried from round 3]** Objective section: Changed "Moving all legacy files" to "Moving in-scope legacy files" to match reduced scope.
