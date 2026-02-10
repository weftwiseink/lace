---
review_of: cdocs/reports/2026-02-09-wezterm-scrolltobottom-incident-analysis.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T09:05:00-08:00
task_list: lace/dotfiles-wezterm
type: review
state: archived
status: done
review_round_notes: |
  R1: Two blocking findings (incorrect latent bug claim, incorrect recommendation 1).
  Both corrected in the report after review. Verdict upgraded to Accept.
tags: [self, incident, config-validation, factual-accuracy, wezterm]
---

# Review: WezTerm ScrollToBottom Incident Analysis

## Summary Assessment

This report investigates a real incident where a background agent broke the user's wezterm config by using `{ CopyMode = 'ScrollToBottom' }`, which is not a valid CopyModeAssignment variant. The root cause analysis is thorough and well-grounded -- the key finding that `ScrollToBottom` is a top-level `KeyAssignment` rather than a `CopyModeAssignment` is verified against both wezterm source code and the output of `wezterm show-keys`. The "trust chain without grounding" pattern is a valuable insight. However, the report contains one factual error about a "latent bug" in the current deployed config that does not actually exist, and the version-mismatch hypothesis needs qualification. Overall, this is a strong incident analysis with actionable prevention steps.

## Section-by-Section Findings

### BLUF

Well-structured and hits the key points: what happened, root cause, error origin, and the prevention path. No issues.

### Context / Background

**Finding: [non-blocking]** The "Document Chain" section is excellent -- it traces the error propagation across four stages (report -> proposal -> implementation -> review). The framing of "every agent in the chain propagated the same error without independent verification" is the core lesson and is well-placed early.

### Key Finding 1: ScrollToBottom Is NOT a CopyModeAssignment Variant

Verified. The claim is grounded in the wezterm source (`config/src/keyassignment.rs`) and confirmed by the `wezterm show-keys` output which shows zero uses of `ScrollToBottom` in the copy_mode table. The distinction between `ScrollToBottom` (top-level, viewport scroll) and `MoveToScrollbackBottom` (CopyMode, cursor movement) is correctly drawn. This is the strongest section of the report.

### Key Finding 2: The Default y Binding

Verified. The actual default `y` binding shown matches the `wezterm show-keys` output: `{ CopyTo = 'ClipboardAndPrimarySelection' }, { CopyMode = 'Close' }` with no `ScrollToBottom`. The claim that "viewport scroll position is implicitly restored when copy mode closes" is stated without verification but is a reasonable inference from the fact that the defaults work correctly without it.

### Key Finding 3: Docs vs. Installed Version

**Finding: [non-blocking]** The report says "it is possible that `{ CopyMode = 'ScrollToBottom' }` was added as a valid CopyModeAssignment variant in a post-20240203 nightly build." This is speculative. An alternative explanation is that the wezterm docs have always shown `ScrollToBottom` in copy mode examples as a table-syntax shorthand that was never actually valid -- the docs page uses a template include (`{% include "examples/default-copy-mode-key-table.markdown" %}`) that may auto-generate from nightly defaults which may have been fixed or may behave differently. The report could be more precise by noting it was unable to definitively confirm whether `{ CopyMode = 'ScrollToBottom' }` is valid in any wezterm version, and that the docs may simply be wrong.

### Key Finding 4: Correct Syntax

The two options (A: `act.ScrollToBottom` as a top-level action, B: just omit it) are both correct and well-explained. The note that Option B is what the defaults use is valuable.

### Key Finding 5: Latent Bug in Current Deployed Config

**Finding: [blocking]** The report claims lines 248-252 of the deployed config contain `{ CopyMode = 'ScrollToBottom' }` inside the Escape callback. This is factually incorrect. The actual deployed config at `/home/mjr/.config/wezterm/wezterm.lua` line 253 reads:

```lua
{ CopyMode = 'MoveToScrollbackBottom' },
```

Not `{ CopyMode = 'ScrollToBottom' }`. The `MoveToScrollbackBottom` variant IS a valid CopyModeAssignment (confirmed in the source enum and in the `wezterm show-keys` output where `G` maps to `act.CopyMode 'MoveToScrollbackBottom'`). There is no latent bug. The Escape callback has already been fixed to use the correct variant.

This error invalidates Recommendation 1 ("Immediate: Fix the latent Escape bug") and weakens the report's credibility since the claim was made without re-reading the actual file content -- the same kind of "trust without grounding" error the report critiques.

### How the Bug Got Through

The four-stage analysis is well-structured and the "Pattern: Trust Chain Without Grounding" section names the failure mode clearly. This is the most valuable analytical contribution of the report.

**Finding: [non-blocking]** The Stage 2 description says "The proposal was reviewed and accepted without catching the error." The proposal review document (`2026-02-08-review-of-wezterm-copy-mode-improvements.md`) was not read or cited. The report assumes the review missed it but does not verify. Minor gap given the overall narrative is correct.

### Prevention: How to Test WezTerm Config Changes

Excellent section. The validation tools table is practical and grounded in actual testing (`--config-file` flag verified to work with both `ls-fonts` and `show-keys`). The "What WezTerm Does NOT Have" subsection sets proper expectations.

**Finding: [non-blocking]** The `ls-fonts` parse check command pipes to `head -1`, but the INFO-level log line from the lace plugin (`lua: lace: registered 75 SSH domains`) is printed to stderr before the font output. The actual check should look at stderr for errors: `wezterm ls-fonts >/dev/null 2>&1 && echo "OK" || echo "FAIL"` would be more reliable than inspecting the first line of output. Alternatively, just check the exit code.

### Recommended TDD Workflow

The six-step workflow is concrete and actionable. Step 2 ("Verify Syntax Against Running Version") is the critical addition that would have prevented this incident.

**Finding: [non-blocking]** Step 3 suggests copying to `/tmp/wezterm-test.lua` and editing there. For agents using Claude Code, the more natural pattern is to edit in place and validate before the file is saved/deployed. The temp-file approach adds friction. Consider noting that `wezterm --config-file` allows validating a file without deploying it, so agents can validate the chezmoi source directly: `wezterm --config-file ~/code/personal/dotfiles/dot_config/wezterm/wezterm.lua ls-fonts`.

**Finding: [non-blocking]** Step 5 says "Wait 2 seconds" for auto-reload. Wezterm's file-watching reload is typically faster than 2 seconds, but there is no programmatic way to wait for reload completion. The sleep is a pragmatic choice. Consider noting that checking the log file timestamp is a more reliable signal than arbitrary sleep.

### Recommendations

**Finding: [blocking]** Recommendation 1 ("Fix the latent Escape bug") is based on the incorrect Finding 5. The bug does not exist in the current deployed config. This recommendation should be removed or corrected to note that the fix has already been applied.

Recommendations 2-5 are sound and actionable.

## Verdict

**Revise.** The core analysis is strong and the prevention workflow is valuable, but the report contains a factual error about the current state of the deployed config (Finding 5 and Recommendation 1). This needs correction before the report can serve as a reliable reference. The fix is straightforward: remove or correct the latent bug claim and the corresponding recommendation.

## Action Items

1. [blocking] Correct Finding 5 ("Latent Bug in Current Deployed Config"). The current deployed config uses `{ CopyMode = 'MoveToScrollbackBottom' }` in the Escape callback, which is a valid CopyModeAssignment variant. The latent bug claim is incorrect. Either remove the section or reframe it to note that the Escape callback was already fixed to use the correct variant.
2. [blocking] Correct Recommendation 1. Remove the "Immediate: Fix the latent Escape bug" recommendation or replace it with a note that the fix has been applied and should be verified via `wezterm show-keys`.
3. [non-blocking] Qualify the version-mismatch hypothesis in Finding 3. The report speculates that `{ CopyMode = 'ScrollToBottom' }` may be valid in nightly wezterm but does not confirm this. Consider adding a note that the claim is unverified.
4. [non-blocking] Improve the `ls-fonts` parse check command to use exit code checking rather than inspecting stdout line 1, since the lace plugin log line appears on stderr before font output.
5. [non-blocking] In Step 3 of the TDD workflow, note that `wezterm --config-file` can validate the chezmoi source directly without copying to a temp file.
