---
review_of: cdocs/reports/2026-03-21-tmux-vs-zellij-multiplexer-decision.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T11:45:00-07:00
task_list: terminal-management/zellij-migration
type: review
state: live
status: done
tags: [fresh_agent, architecture, terminal_management, decision_analysis]
---

# Review: Terminal Multiplexer Decision: tmux vs Zellij

## Summary Assessment

This report presents a well-structured comparative analysis of tmux, zellij, and wezterm as terminal multiplexers for the lace workflow system.
The document is thorough, honest about trade-offs in both directions, and arrives at a defensible recommendation.
The most important finding is that the weighted decision matrix contains arithmetic errors: the stated totals do not match the scores in the table, which undermines the quantitative framing even though the qualitative argument holds.
Verdict: Revise, with one blocking issue (the math) and several non-blocking suggestions.

## Section-by-Section Findings

### Frontmatter

The frontmatter is well-formed and follows the spec.
All required fields are present with valid values.
Status is correctly set to `review_ready`.
No issues.

### BLUF

The BLUF is strong: it states the recommendation, the decisive factor (copy mode), the proposed stack, and the effort comparison.
The "42 vim motions" figure is reasonable (the body text says "approximately 42 distinct vim motions," which checks out against the inventory).
The "8 scroll-only actions" figure matches the zellij inventory.
**Non-blocking**: The BLUF mentions "modern tmux stack" with six parenthetical tools, which is dense.
This is acceptable for a BLUF but could be tightened.

### Context

Clear and concise.
Properly references the companion feasibility report and summarizes its key finding (copy mode as severe, likely permanent gap).
The relative link `(2026-03-21-zellij-migration-feasibility.md)` is a same-directory link, which is correct for same-folder documents.
No issues.

### Head-to-Head: Weighted Decision Matrix

**Blocking**: The weighted totals are incorrect.
Manual computation from the table data yields:

- tmux: (10x10) + (7x6) + (6x6) + (5x7) + (8x8) + (8x9) + (6x6) + (7x8) + (8x6) + (4x8) = 100+42+36+35+64+72+36+56+48+32 = **521** (document claims 538)
- zellij: (10x1) + (7x10) + (6x7) + (5x8) + (8x9) + (8x7) + (6x10) + (7x8) + (8x5) + (4x7) = 10+70+42+40+72+56+60+56+40+28 = **474** (document claims 472)
- wezterm: (10x6) + (7x2) + (6x3) + (5x2) + (8x4) + (8x9) + (6x5) + (7x7) + (8x9) + (4x7) = 60+14+18+10+32+72+30+49+72+28 = **385** (document claims 409)

The normalized scores (out of max 690) would be: tmux 7.5, zellij 6.9, wezterm 5.6.
None of the three totals match.
The ranking and conclusion are unchanged (tmux wins), but incorrect arithmetic in a quantitative argument is a credibility issue.

The sensitivity claim ("Even at weight 7 instead of 10, tmux still wins") does hold with corrected numbers (491 vs 471), but the margin narrows to 20 points, which is worth noting for transparency.

### Copy Mode: The Deciding Factor

Thorough and well-structured.
The motion inventory for tmux is detailed and accurate.
The zellij and wezterm comparisons are fair.
The assessment paragraph is clear and well-argued.
No issues.

### What You Lose Going to tmux (vs Zellij)

This section demonstrates the "critical and detached analysis" convention well.
Each loss is acknowledged honestly with specific mitigations where they exist.
The "not dismissible" framing is appropriate.

**Non-blocking**: The "No Built-in Web Client" subsection mentions tmate as "aging" but provides no context on what tmate is.
A parenthetical "(tmate: tmux fork enabling session sharing via SSH)" would help readers unfamiliar with it.

### What You Gain Going to tmux

Balanced and specific.
The scriptability section provides concrete details (100+ commands, format strings, libtmux) rather than vague claims.
The migration effort comparison is well-placed here as a gain.
No issues.

### The "Modern tmux" Stack (2026)

Useful and concrete.
The plugin table format is effective for scanning.

**Non-blocking**: The "Theme Mode 2031" mention in the tmux 3.6 feature list is unexplained.
Readers may not know what this refers to.
A brief qualifier (e.g., "Theme Mode 2031 - structured theme support") would help.

**Non-blocking**: tabby is mentioned in the Sidebar Tabs subsection as providing "a vertical sidebar tab manager with grouping, mouse support, and daemon architecture."
This seems to be a reference to the tabby terminal emulator, not a tmux plugin.
If so, this is a different architectural choice (replacing ghostty with tabby) rather than a tmux plugin, and the framing is confusing.
If it is a tmux plugin, a link or clarification would help.

### Integration Architecture for Lace with tmux

The Mermaid diagram is clear and follows conventions.
The three discovery plugin options are well-differentiated.
Option 1 (CLI subcommand) is recommended, and the reasoning is sound: it reuses existing TypeScript infrastructure.

**Non-blocking**: The effort estimate table sums to roughly 3.5-5 weeks if taken literally (2-3 + 1 + 1 + 2-3 + 1 + 7-14 + 2-3 + 1 + 1 = 18.5-29 working days = 3.7-5.8 weeks).
The stated "3-4 weeks" total is on the optimistic end, suggesting some parallelism is assumed.
This should be noted or the total adjusted.

### Hybrid Consideration: EditScrollback for tmux Too

Concise and relevant.
The shell command is practical and testable.
The framing ("bonus, not workaround") is well-calibrated.
No issues.

### What Zellij Wins on (Honestly)

This section is one of the document's strengths.
Honest acknowledgment of seven areas where the non-recommended option is genuinely better.
The closing line ("If copy mode were fixed, zellij would be the stronger choice") is a strong, credible statement that reinforces trust in the overall analysis.
No issues.

### Recommendations

The four recommendations are clear and actionable.
The phased migration plan is realistic and includes a Phase 0 for experimentation.

**Non-blocking**: Recommendation 4 ("Revisit Zellij Periodically") is important context but lacks a concrete trigger.
Something like "check zellij release notes quarterly, specifically for issue #947 progress" would make it actionable.

### Writing Convention Compliance

The document follows sentence-per-line formatting consistently.
BLUF is present and well-formed.
No emojis.
Mermaid is used for diagrams.
Colons are preferred over em-dashes throughout (the one colon usage in "EditScrollback for tmux Too" subtitle uses a colon correctly).
History-agnostic framing is maintained.
No callout attribution issues.

One convention violation: the document uses a spaced-hyphen em-dash substitute in the BLUF ("A 'modern tmux' stack (tmux 3.6 + ghostty + sesh + tmux-floax + catppuccin + tmuxp + smart-splits)") which is fine, but the document body contains no NOTE/WARN/TODO callouts.
For a decision document of this significance, at least one NOTE callout on the sensitivity of the copy mode weighting would be appropriate.

## Verdict

**Revise.**

The document is strong in structure, analysis, and honesty.
The single blocking issue is the arithmetic errors in the decision matrix, which must be corrected for the quantitative argument to hold credibility.
The qualitative argument is sound regardless.

## Action Items

1. [blocking] Correct the weighted totals in the decision matrix. Recompute from the table data: tmux should be 521, zellij 474, wezterm 385 (or adjust individual scores if the totals were the intended figures and the per-row scores are wrong). Update normalized scores accordingly.
2. [non-blocking] Add a NOTE callout on sensitivity analysis: at copy mode weight 7, tmux leads by only 20 points (491 vs 471). This is a thin margin and worth being transparent about.
3. [non-blocking] Clarify the tabby reference in "Sidebar Tabs" subsection: is this a tmux plugin or the tabby terminal emulator? If the latter, the framing is misleading in a tmux plugins context.
4. [non-blocking] Clarify "Theme Mode 2031" in the tmux 3.6 feature list.
5. [non-blocking] Consider noting the optimism in the 3-4 week effort estimate, or adjusting to 3-5 weeks.
6. [non-blocking] Add a concrete trigger to Recommendation 4 for revisiting zellij (e.g., quarterly review of issue #947).
7. [non-blocking] Add a brief parenthetical for tmate in the "No Built-in Web Client" subsection.
