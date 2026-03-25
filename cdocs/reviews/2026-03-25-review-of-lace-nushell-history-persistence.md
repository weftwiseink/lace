---
review_of: cdocs/proposals/2026-03-25-lace-nushell-history-persistence.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-25T14:30:00-07:00
task_list: lace/nushell-history
type: review
state: archived
status: done
tags: [self, architecture, mounts, pre_review_ready]
---

# Review: Lace Nushell History Persistence

## Summary Assessment

This proposal addresses nushell history persistence via a symlink + feature-declared mount approach, and includes a well-reasoned analysis of container config models.
The core design is sound: the symlink approach is the pragmatic correct choice given nushell's hardcoded history path.
The config model analysis (Models A/B/C) is thorough and reaches the right conclusion.
Two blocking issues and several non-blocking suggestions are identified below.
Verdict: **Revise** (minor changes, close to acceptance).

## Section-by-Section Findings

### BLUF

Clear and comprehensive.
Covers the technical approach, the broader architectural question, and the conclusion.
The references and dependency links are useful.
No issues.

### Background

Accurate and well-sourced.
The upstream nushell issue/PR tracking is valuable for understanding why alternatives were rejected.
One clarification: the proposal states nushell history defaults to `$XDG_CONFIG_HOME/nushell/history.sqlite3`, but the user's current nushell config uses plaintext format (`$nu.history-path` resolves to `history.txt` on the host).
This is noted in the edge cases section but could cause confusion in the background section.

**Non-blocking**: Consider noting in the background that the host currently uses plaintext but lace's nushell setup configures sqlite format.

### Container Config Model Analysis

The strongest section of the proposal.
The three-model comparison is systematic and the assessment is well-argued.
Model C's "fatal flaw" analysis is particularly sharp: the readonly mount + writable state separation is blocked by nushell's directory conflation.
The overlayfs NOTE is a good addition.

One nuance worth surfacing: Model B's "concurrent sqlite corruption" weakness assumes multiple containers are running simultaneously.
In practice, many lace users run a single container at a time.
The proposal correctly identifies this as a risk but could acknowledge that for single-container users, Model B would technically work.
This does not change the conclusion: Model A is still correct because it handles the general case.

**Non-blocking**: Consider a brief acknowledgment that Model B works for single-container users but fails as a general solution.

### Proposed Solution

**Blocking: The `recommendedSource` field behavior is mischaracterized.**
The proposal states: "When the user opts into shared history via `settings.json`, lace uses that path instead of auto-deriving."
This is correct for `settings.json` overrides, but the `recommendedSource` field in the mount declaration has different semantics than described.
For mounts without `sourceMustBe`, `recommendedSource` is displayed in guidance messages but is NOT used as the resolution path.
The auto-derived path is always used unless a `settings.json` override exists.
The NOTE callout on line 177-179 conflates `recommendedSource` with `settings.json` override behavior.
Fix: clarify that `recommendedSource` is guidance-only and the actual shared history path is configured via `settings.json`.

**Blocking: The init script does not check for `~/.config/nushell/` existence.**
The code snippet on line 187 checks `if [ -d "/mnt/lace/nushell-history" ]` but does not check whether `~/.config/nushell/` exists.
The edge cases section (line 310-312) correctly states this check should happen, but the code snippet does not implement it.
Fix: add `[ -d "$NUSHELL_CONFIG" ]` to the guard condition in the code example.

### Design Decisions

The per-container-by-default decision is well-justified.
The "symlink over alternatives" section is thorough and each rejection has clear reasoning.

The `/commandhistory` reuse rejection reasoning is sound but slightly overweights namespace purity.
A `nushell/` subdirectory under the existing bash history mount would work fine mechanistically.
The namespace argument is valid from an organizational standpoint.

**Non-blocking**: The rejection of `/commandhistory` reuse is reasonable but the reviewer notes it is a matter of preference, not a technical constraint.

### Edge Cases

Thorough coverage.
The chezmoi re-apply scenario is well-analyzed.
The migration section correctly identifies that no migration is needed.

**Non-blocking**: The "plaintext vs sqlite" edge case could be resolved immediately rather than left as an open question.
Since lace's nushell setup configures sqlite in `config.nu`, and users who override that format are making a deliberate choice, hardcoding sqlite with a documentation note is the pragmatic answer.
This resolves open question #1.

### Verification

Good concrete steps.
The shared history verification (steps 7-9) correctly notes the nushell restart requirement for cross-container visibility.

**Non-blocking**: Add a verification step for the "container without nushell" edge case: temporarily remove the nushell feature from user.json, rebuild, and confirm no errors in the init script output.

### Implementation Phases

Clean three-phase breakdown.
Phase 2 (dotfiles repo) is appropriately separated from Phase 1 (lace repo).
Phase ordering is correct: the init script works even without the chezmoiignore rule (because chezmoi doesn't currently manage history files), so Phase 1 can be deployed independently.

**Non-blocking**: Phase 1 step 2 references `steps/git-identity.sh` as the file to modify.
This is correct (it generates the init script via heredoc), but implementors unfamiliar with the codebase might look for a separate init script file.
Consider noting that the init script is generated inline via heredoc in git-identity.sh.

### Open Questions

Question 3 can be resolved: `chezmoi managed` confirms no history files are currently managed.
The `.chezmoiignore` change is safe for the host.

## Verdict

**Revise.**
Two blocking issues, both straightforward to fix:
1. Clarify `recommendedSource` semantics in the NOTE callout.
2. Add `~/.config/nushell/` existence check to the init script code example.

After these fixes, the proposal is ready for `review_ready` status.

## Action Items

1. [blocking] Fix the NOTE callout at line 177-179: clarify that `recommendedSource` is guidance-only and does not affect resolution. The shared history path is configured exclusively via `settings.json` override.
2. [blocking] Add `[ -d "$NUSHELL_CONFIG" ]` to the guard condition in the init script code example (line 187).
3. [non-blocking] Note in the background section that the host uses plaintext history but lace's nushell config.nu configures sqlite format.
4. [non-blocking] Resolve open question #1 inline: hardcode sqlite, document that plaintext users need manual adjustment.
5. [non-blocking] Resolve open question #3 inline: chezmoi does not currently manage history files, the ignore rule is safe.
6. [non-blocking] Add a "container without nushell" verification step.
7. [non-blocking] Note in Phase 1 that the init script is generated via heredoc in `git-identity.sh`, not a standalone file.
