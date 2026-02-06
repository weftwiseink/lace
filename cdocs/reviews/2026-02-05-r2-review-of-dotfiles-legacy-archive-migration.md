---
review_of: cdocs/proposals/2026-02-05-dotfiles-legacy-archive-migration.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T19:30:00-08:00
task_list: dotfiles/legacy-archive
type: review
state: archived
status: done
tags: [fresh_agent, rereview_agent, implementation_detail, validation, edge_cases, operational_readiness]
---

# Review (Round 2): Dotfiles Legacy Archive Migration

## Summary Assessment

This proposal has been substantially expanded since the round-1 review. All three prior action items (one blocking, two non-blocking) have been addressed. The expanded Implementation Phases section now includes exact commands, pre-conditions, validation steps, expected post-states, and rollback procedures for every phase. The new edge cases (chezmoi apply between phases, local modifications, deleted symlink targets, Fedora 43 platform concerns) add real operational value. The document is ready for implementation. Two non-blocking items identified below would improve robustness. Verdict: **Accept**.

## Prior Action Items Status

1. **[blocking] Chezmoi run_once accuracy** -- Addressed in revision 1. The "Chezmoi run_once Script Handling" section now correctly states scripts ARE managed by chezmoi, and that removal is safe due to `run_once` semantics. The edge case "Chezmoi State Drift" section also reflects the corrected reasoning. **Resolved.**

2. **[non-blocking] Phase 6 commit scope** -- Addressed in revision 1. Phase 6 now includes a NOTE block clarifying the commit captures repo-side changes only, with system-side operations as prerequisites. **Resolved.**

3. **[non-blocking] Full rollback caveat** -- Addressed in revision 1. The rollback strategy summary now explicitly notes that `git checkout -- .` does not restore system-side symlinks. **Resolved.**

## Section-by-Section Findings (New/Expanded Content)

### Implementation Phases: Pre-conditions

Each phase now has explicit pre-conditions. These are well-chosen and verifiable. Phase 0's pre-condition requiring `chezmoi doctor` exits 0 is a good addition. Phase 5's pre-deletion checklist is particularly strong -- it gates deletion on automated verification of all prior phases.

**No issues.**

### Implementation Phases: Validation Steps

The validation commands are concrete and testable. Highlights:

- Phase 1 validation uses `diff -r` for byte-level verification of every copied directory. Thorough.
- Phase 2 includes a "non-breaking intermediate state smoke test" that checks both paths resolve. This directly validates the core safety property.
- Phase 3 validation confirms files are regular (not symlinks), non-empty, and content-matches the originals. Three-layer check.
- Phase 5 pre-deletion checklist consolidates all prior phase verifications into a single pass-fail gate. Well designed.
- Phase 6 includes an end-to-end smoke test covering bash, starship, ble.sh, vscode init, and tmux. Good coverage.

**No issues.**

### Implementation Phases: Rollback Commands

Every phase has specific rollback commands. The Phase 2 rollback correctly distinguishes between the "immediate fix" (copy backup bashrc) and the "full revert" (git checkout + chezmoi apply). Phase 6 rollback properly includes the system-side symlink restoration that `git revert` alone would miss.

**No issues.**

### Implementation Phases: git rm vs. rm

Phase 5 was changed from `rm -rf` to `git rm -rf`. This is a good improvement -- it stages deletions atomically and produces a cleaner commit history. The NOTE explaining the tradeoff is helpful.

**No issues.**

### Edge Cases: Chezmoi Apply Between Phases

This was requested in the round-1 review as a non-blocking suggestion. The new section covers all three inter-phase windows (1-2, 2-5, 5-6) and correctly concludes chezmoi apply is safe at every point. The reasoning is sound.

**No issues.**

### Edge Cases: Local Modifications to Managed Files

Good addition. The detection command (`chezmoi diff`) and mitigation (capture diff before applying) are practical. The note that other managed files are unaffected because only `dot_bashrc` is modified is accurate.

**No issues.**

### Edge Cases: Symlink Target Already Deleted

Good addition covering a real failure mode. The fallback to archive copies is the right approach. The "both missing" case (remove dangling symlink and document) is appropriately pragmatic.

**No issues.**

### Edge Cases: Platform-Specific Concerns (Fedora 43)

This section covers four areas. Three are solid. One has a minor gap:

**[non-blocking]** The atomic/ostree desktop note states "The symlink paths in this proposal use `/var/home/mjr` consistently." However, reviewing the proposal, there is inconsistency: some commands use `/home/mjr` (e.g., `cd /home/mjr/code/personal/dotfiles` throughout the Implementation Phases) while others use `/var/home/mjr` (the symlink targets in Phase 3 and Phase 4). This is technically fine because `/home/mjr` is a symlink to `/var/home/mjr` on atomic desktops, but the claim of consistency is inaccurate. Suggest clarifying that `cd` commands use `$HOME`-resolved `/home/mjr` (which works on all Fedora variants) while absolute symlink targets use `/var/home/mjr` (the canonical path on this system), and that both resolve to the same location.

The Flatpak Firefox note is a useful addition. However, it could note how to determine whether the existing symlink already points to a Flatpak path -- if it does, the Phase 4 instructions need adjustment. If it points to the standard `~/.mozilla` path (as the proposal shows), that confirms RPM Firefox and no Flatpak adjustment is needed.

### Phase 3 Validation: Content Diff Against Originals After Phase 5

**[non-blocking]** The Phase 3 validation compares the materialized files against the originals at `vscode/keybindings.jsonc` and `vscode/settings.jsonc`. However, by the time Phase 5 runs, those originals will have been `git rm`'d. If the implementer ever needs to re-validate Phase 3 after Phase 5, the diff targets are gone. This is a minor sequencing note -- the archive copies at `archive/legacy/vscode/` could serve as the reference instead. Not a functional issue since validation happens before deletion, but worth noting if the implementer runs phases out of order or re-validates.

## Verdict

**Accept.** All round-1 blocking and non-blocking issues have been resolved. The expanded implementation phases are thorough, with concrete commands, multi-layer validation, and specific rollback procedures at every step. The new edge cases cover the requested scenarios well. The two non-blocking items identified above are minor clarity improvements that do not affect correctness or executability. The proposal is ready for implementation.

## Action Items

1. **[non-blocking]** In "Platform-Specific Concerns," clarify that `/home/mjr` (used in `cd` commands) and `/var/home/mjr` (used in symlink targets) are both correct but serve different purposes: `cd` uses the `$HOME`-resolved path, while symlink targets use the canonical filesystem path. The current claim of "uses `/var/home/mjr` consistently" is inaccurate.

2. **[non-blocking]** In Phase 3 validation, consider noting that the reference files for content comparison (`vscode/keybindings.jsonc`, `vscode/settings.jsonc`) will not survive Phase 5. If re-validation is needed later, use the archive copies at `archive/legacy/vscode/` instead.
