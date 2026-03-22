---
review_of: cdocs/reports/2026-03-21-tmux-vs-zellij-multiplexer-decision.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T14:30:00-07:00
task_list: terminal-management/zellij-migration
type: review
state: live
status: done
tags: [rereview_agent, architecture, terminal_management, decision_analysis]
---

# Review (Round 2): Terminal Multiplexer Decision: tmux vs Zellij

## Summary Assessment

This report compares tmux, zellij, and wezterm as terminal multiplexers for the lace workflow, recommending tmux on the strength of its vim-native copy mode.
All seven action items from the round 1 review have been substantively addressed: the blocking arithmetic errors are corrected, sensitivity analysis is documented in a NOTE callout, ambiguous references (tabby, Theme Mode 2031, tmate) are clarified, the effort estimate is widened to 3-5 weeks, and a concrete quarterly trigger for revisiting zellij is specified.
One minor inconsistency remains: a single line in "Simpler Migration from WezTerm" still reads "3-4 weeks" while the BLUF and effort table both say "3-5 weeks."
Verdict: Accept, with one non-blocking suggestion.

## Round 1 Action Item Disposition

1. **[blocking] Weighted totals corrected**: Resolved. Totals now read 521/474/385, independently verified against the per-row scores. Normalized values (7.6/6.9/5.6) are also correct (computed against max 690).
2. **[non-blocking] Sensitivity analysis NOTE**: Resolved. Lines 54-55 contain a properly attributed `NOTE(opus/terminal-management)` callout documenting the 20-point margin at weight 7.
3. **[non-blocking] Clarify tabby reference**: Resolved. The sidebar tabs subsection explicitly disambiguates: "tabby (tmux plugin, not the tabby terminal emulator)."
4. **[non-blocking] Clarify Theme Mode 2031**: Resolved. Parenthetical "(structured dark/light theme reporting)" added inline.
5. **[non-blocking] Effort estimate adjusted to 3-5 weeks**: Resolved in BLUF and effort table. One residual inconsistency noted below.
6. **[non-blocking] Concrete trigger for revisiting zellij**: Resolved. Recommendation 4 specifies quarterly review of zellij release notes targeting issue #947.
7. **[non-blocking] Tmate parenthetical explanation**: Resolved. "tmate, a tmux fork enabling session sharing via SSH" now appears in the web client subsection.

## New Findings

### Effort Estimate Inconsistency (Non-Blocking)

The "Simpler Migration from WezTerm" subsection (under "What You Gain") still reads:

> Estimated 3-4 weeks vs 4-6 weeks for zellij.

The BLUF and the effort table both correctly state "3-5 weeks."
This is a trivial text alignment fix.

### Arithmetic Verification (Pass)

Independently recomputed all three weighted totals and the sensitivity analysis:
- tmux: 100+42+36+35+64+72+36+56+48+32 = 521
- zellij: 10+70+42+40+72+56+60+56+40+28 = 474
- wezterm: 60+14+18+10+32+72+30+49+72+28 = 385
- Sensitivity (weight 7): tmux 491 vs zellij 471, margin 20

All figures match the document. The blocking issue from round 1 is fully resolved.

### Writing Convention Compliance (Pass)

Sentence-per-line formatting is maintained throughout.
BLUF is present and effective.
No emojis.
Mermaid diagram for architecture.
Colons preferred over em-dashes.
History-agnostic framing maintained.
The sensitivity analysis NOTE callout includes proper attribution.

## Verdict

**Accept.**

All blocking and non-blocking items from round 1 have been addressed.
The document is well-structured, analytically honest, and arrives at a well-defended recommendation.
The single remaining inconsistency (3-4 vs 3-5 weeks in one location) is trivial and non-blocking.

## Action Items

1. [non-blocking] Align "Estimated 3-4 weeks" in the "Simpler Migration from WezTerm" subsection to "3-5 weeks" to match the BLUF and effort table.
