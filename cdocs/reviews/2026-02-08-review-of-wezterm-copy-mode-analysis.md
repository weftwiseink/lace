---
review_of: cdocs/reports/2026-02-08-wezterm-copy-mode-analysis.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-08T10:15:00-08:00
task_list: lace/dotfiles-wezterm
type: review
state: archived
status: done
tags: [fresh_agent, wezterm, copy-mode, completeness, accuracy]
---

# Review: WezTerm Copy Mode vs tmux vi-copy Mode Analysis

## Summary Assessment

This report provides a thorough analysis of wezterm's copy mode capabilities, its comparison with tmux's vi-copy mode, and actionable recommendations for configuration improvements. The research is well-sourced with 13 external references, and the gap analysis table is particularly valuable for setting expectations about what is and is not achievable. The most important finding -- that CopyMode actions are compiled into the wezterm binary and cannot be extended by plugins -- is correctly identified and clearly communicated. The BLUF's "85% parity" framing gives a useful mental model.

Verdict: **Accept** with minor non-blocking suggestions.

## Section-by-Section Findings

### BLUF

The BLUF is concise and hits the three key points: what works, what does not, and why plugins cannot bridge the gap. The "85% parity" estimate is a reasonable approximation given the gap analysis table. **No issues.**

### Context (Section)

Correctly identifies the two user pain points and references the actual config file location. Minor note: says "dotfiles/dot_config/wezterm/wezterm.lua" using a relative path, but the deployed path `/home/mjr/.config/wezterm/wezterm.lua` is the one that actually matters at runtime. **Non-blocking** -- the relative path is fine for identifying the chezmoi source.

### Finding 1: Auto-Copy-on-Select Behavior

Well-researched. The code example covers single, double, and triple click streaks. One gap: the example only overrides `mods = 'NONE'` bindings. The wezterm defaults also include `SHIFT`, `ALT`, and `ALT|SHIFT` modifier variants for the Up event. A complete fix would need to override those as well, or the user will still get clipboard copies when Shift-clicking to extend selection. **Non-blocking** -- the proposal phase is the right place to flesh out the full mouse_bindings table.

### Finding 2: Copy Mode Default Key Bindings

Comprehensive table covering all standard bindings. One minor inaccuracy worth noting: the report says the vim equivalent of `g` is `gg`, which is true in vim. In wezterm, single `g` goes to top of scrollback. This is correctly flagged in the comparison table (Section 4) as a "Minor" gap, but in the default bindings table it is listed without comment. Consistent treatment would help. **Non-blocking.**

### Finding 3: Available CopyMode Actions

Good enumeration. The report does not mention `MoveToEndOfLineContent` vs `MoveToStartOfLineContent` distinction (the `$` vs `^` equivalents), though both appear in the list. The action list appears complete based on the documentation sources. **No issues.**

### Finding 4: Comparison with tmux vi-copy Mode

This is the strongest section. The table format is clear, and the "Gap?" column with bold markers for impossible items draws the eye correctly. Two observations:

1. The row for "W/B/E (WORD motion)" states wezterm's w/b/e "treats all non-blank as WORD." This needs verification -- wezterm's word boundary definition likely uses `selection_word_boundary` or a similar internal heuristic. The exact behavior may differ from both vim `w` and vim `W`. The claim that it "treats all non-blank as WORD" may be an oversimplification. **Non-blocking** -- does not change the conclusion that WORD/word distinction is unavailable.

2. The report does not mention `d` (delete, which in tmux vi-copy clears the selection without copying). In wezterm, `Escape` or `ClearSelectionMode` would serve a similar purpose. This is a minor omission. **Non-blocking.**

### Finding 5: What Can Be Customized via Config

Clean three-tier categorization (fully configurable, configurable, not configurable). Accurate. **No issues.**

### Finding 6: Existing Plugins and Tools

Correctly identifies that neither wez-tmux nor modal.wezterm can add missing CopyMode actions. The assessment that this is a dotfiles concern, not a plugin concern, is well-supported. **No issues.**

### Finding 7: Copy Mode Lifecycle Customization

The two code examples (yank-and-stay vs yank-and-exit) are useful and directly actionable. One subtle point: the "yank without exiting" example uses `ClearSelectionMode` which resets the selection mode but does not clear the visual highlight. The user might want `ClearSelection` (to remove the highlight) followed by `ClearSelectionMode` to fully reset. The `ClearSelectionMode` documentation example actually shows both being used together. **Non-blocking** -- worth noting in the proposal.

### Finding 8: Search Mode Integration

Correctly identifies the known issue where search-to-copy-mode transition always enters selection/visual mode. Good upstream reference to issue #5952. **No issues.**

### Analysis: Achievability Assessment

The "Easy/Already default/Impossible" categorization is helpful. One missing entry: customizing `Escape` behavior in copy mode (e.g., first Escape clears selection, second Escape exits copy mode). This is achievable via `act.Multiple` with conditionals or by splitting behavior across `Escape` and `q`. **Non-blocking** -- could be added to the proposal.

### Plugin Feasibility

The conclusion is correct and well-reasoned. The four-bullet list of what plugins can do is a useful constraint summary. **No issues.**

### Recommendations

All five recommendations are sound. Recommendation 5 (watch upstream) is practical and references the right issues. **No issues.**

### Sources

Thirteen sources covering official docs, GitHub issues, discussions, and plugins. Good breadth. **No issues.**

## Verdict

**Accept.** The report is thorough, well-structured, and correctly identifies the boundary between what can be configured and what requires upstream changes. The research is well-sourced, the gap analysis is actionable, and the plugin feasibility conclusion is sound. The non-blocking findings are minor and can be addressed in the subsequent proposal.

## Action Items

1. [non-blocking] Consider noting in Finding 1 that SHIFT/ALT modifier variants of mouse Up events also need overriding for complete auto-copy suppression.
2. [non-blocking] Clarify the w/b/e word boundary behavior claim in the comparison table -- whether it truly matches WORD semantics or uses a different heuristic.
3. [non-blocking] In Finding 7, consider showing the combined `ClearSelection` + `ClearSelectionMode` pattern for fully resetting after yank-without-exit.
4. [non-blocking] Consider adding an Escape behavior customization row to the achievability assessment table.
