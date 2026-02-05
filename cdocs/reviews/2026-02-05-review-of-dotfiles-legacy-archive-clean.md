---
review_of: cdocs/proposals/2026-02-05-dotfiles-legacy-archive-clean.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T00:10:00-08:00
task_list: lace/dotfiles-migration
type: review
state: live
status: done
tags: [fresh_agent]
---

# Review: Dotfiles Legacy Archive Migration (Clean Rewrite) -- R1

## Summary Assessment

This is a substantial improvement over the evolved proposal. The BLUF is concise (2 sentences), the phasing is clear and actionable, starship preservation is explicit, and -- critically -- no chezmoi commands appear in the migration steps. The proposal correctly decouples the archive migration from chezmoi bootstrap, which was the main complaint about the previous version.

The proposal is well-structured as a standalone document. A reader unfamiliar with the previous version can follow it from start to finish.

## Section-by-Section Findings

### BLUF
Clean and accurate. Two sentences. No verbose risk enumeration. States the key constraint (no chezmoi commands). **No issues.**

### Background
The "What About Chezmoi?" section is a highlight -- it directly addresses the main failure mode of the previous proposal and clarifies the agnostic approach. The "What About Starship?" section is clear. **No issues.**

### Proposed Solution

**Non-blocking (NB-1):** The "What Stays at Repo Root" table lists `dot_blerc` and `dot_tmux.conf` as staying. These are legacy bash/tmux configs. Should they eventually be archived too, or is their retention intentional because chezmoi manages them? A one-line note clarifying their long-term disposition would help. These files are still actively deployed to `~/.blerc` and `~/.tmux.conf`, so keeping them for now is reasonable -- but calling this out would be helpful.

### Implementation Phases

**Non-blocking (NB-2):** Phase 1 pre-flight does not check whether the VSCode symlinks exist and resolve. The old proposal had this check. Adding a quick `file ~/.config/Code/User/keybindings.json` would help detect the "symlinks already broken" edge case early rather than discovering it in Phase 4.

**Non-blocking (NB-3):** Phase 3 mentions `chezmoi apply --verbose` as an option "if chezmoi is bootstrapped." This is fine as written (it is an if/else), but could be misread as the proposal requiring chezmoi. Consider reordering to put the `cp` method first since that is "the expected case" per the text.

**Non-blocking (NB-4):** Phase 5 commit message is good but could note this is the clean rewrite migration (to distinguish from any partial attempts that might exist in the git log).

### Design Decisions
All five decisions are well-reasoned and concise. Decision 1 (no chezmoi commands) directly addresses the user's primary complaint. Decision 5 (starship preserved) directly addresses the user's explicit requirement. **No issues.**

### Edge Cases
Coverage is appropriate for the scope. The `.chezmoiignore` edge case is a nice touch -- proactively addressing a question reviewers would ask. **No issues.**

### Rollback Strategy
Clean and simple. The note about VSCode symlinks being system-side is important. **No issues.**

### Test Plan
Covers the critical verification points. **No issues.**

## Verdict

**Accepted.** No blocking findings. Four non-blocking suggestions for polish.

## Action Items

| ID | Type | Description | Resolution |
|----|------|-------------|------------|
| NB-1 | Non-blocking | Add note about `dot_blerc`/`dot_tmux.conf` long-term disposition | Author discretion |
| NB-2 | Non-blocking | Add VSCode symlink pre-flight check to Phase 1 | Author discretion |
| NB-3 | Non-blocking | Reorder Phase 3 deploy to put `cp` method first (expected case) | Author discretion |
| NB-4 | Non-blocking | Consider distinguishing commit message from prior attempts | Author discretion |
