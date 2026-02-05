---
review_of: cdocs/proposals/2026-02-04-wezterm-plugin-proper-packaging.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T18:30:00-05:00
type: review
state: archived
status: done
tags: [fresh_agent, architecture, migration, repository_structure]
---

# Review: WezTerm Plugin Proper Packaging and Distribution

## Summary Assessment

This proposal recommends moving the lace wezterm plugin to a separate GitHub repository (`weftwiseink/lace.wezterm`) to enable standard plugin distribution. The reasoning is sound and well-documented. The proposal correctly identifies that WezTerm's plugin system requires `plugin/init.lua` at the repository root, making a separate repository necessary for proper distribution. However, the proposal contradicts the earlier research document which recommended the local `file://` approach, and should explicitly acknowledge this evolution in thinking.

**Verdict: Revise** - Minor clarifications needed before acceptance.

## Section-by-Section Findings

### BLUF
**Finding:** Clear and actionable. Correctly summarizes the core change.
**Status:** No issues.

### Objective
**Finding:** Well-defined goals. The four bullet points are measurable success criteria.
**Status:** No issues.

### Background - Current State
**Finding:** Accurately describes the current fragile setup with path gymnastics.
**Status:** No issues.

### Background - WezTerm Plugin System Constraints
**Finding:** Good technical summary. However, the claim "No tag or branch pinning" should be verified - some plugin systems do support branch specifiers in URLs.
**Status:** Non-blocking. Consider verifying branch support (e.g., `https://github.com/user/repo#branch`).

### Background - Why a Separate Repository is Required
**Finding:** The reasoning is correct but incomplete. The earlier research document (`cdocs/reports/2026-02-04-wezterm-plugin-research.md`) explicitly recommended the local plugin approach. This proposal should acknowledge why the recommendation has changed - the key insight being that "proper distributable plugin" (shareable with others) has different requirements than "local development plugin."
**Status:** Blocking. Add a note explaining the evolution from the prior research recommendation.

### Proposed Solution - Repository Structure
**Finding:** Clean and minimal. The `.wezterm` suffix convention is well-researched.
**Status:** No issues.

### Proposed Solution - Migration Path for Dotfiles
**Finding:** Clear before/after comparison. The simplified code is a significant improvement.
**Status:** No issues.

### Proposed Solution - Local Development Override
**Finding:** The environment variable approach is reasonable but slightly awkward. Consider also mentioning that developers can temporarily edit the cached plugin in `~/.local/share/wezterm/plugins/` directly for quick iteration.
**Status:** Non-blocking suggestion.

### Design Decisions - Repository Name
**Finding:** Good research on naming conventions. The alternatives considered section is valuable.
**Status:** No issues.

### Design Decisions - Keep Original in Lace Repo?
**Finding:** The recommendation to remove is correct, but the proposal should specify what happens to `config/wezterm/wezterm.lua` (the reference config that currently uses the plugin). Should it be deleted, updated to use the GitHub URL, or moved?
**Status:** Non-blocking. Clarify fate of the reference wezterm.lua config.

### Design Decisions - Interaction with Lace Plugins System
**Finding:** This is an important clarification. The distinction between host-side wezterm plugin and container-side lace plugins is correctly explained.
**Status:** No issues.

### Edge Cases
**Finding:** Good coverage of offline, updates, and container scenarios. Well thought through.
**Status:** No issues.

### Implementation Phases
**Finding:** Clear phased approach. Phase 3 mentions "Optionally keep `config/wezterm/wezterm.lua`" but doesn't specify what it should reference. If kept, it should be updated to use the new GitHub URL as a working example.
**Status:** Non-blocking. Clarify Phase 3 item 3.

### Risks and Mitigations
**Finding:** Table format is good. The "Breaking existing users" risk mitigation mentions "deprecation period" but doesn't specify duration or mechanism. Given that this is primarily a personal/internal tool, this may not be critical.
**Status:** Non-blocking. Consider specifying deprecation timeline if external users exist.

### Success Criteria
**Finding:** Measurable and appropriate.
**Status:** No issues.

### Missing Section: Alternatives Considered
**Finding:** The proposal jumps straight to "separate repository" without discussing alternatives like git submodules, npm/luarocks packaging, or symlinking strategies. While the prior research covered some of this, the proposal should briefly summarize why alternatives were rejected.
**Status:** Non-blocking. Consider adding brief "Alternatives Considered" section.

## Verdict

**Revise** - One blocking issue and several non-blocking suggestions.

The blocking issue is the lack of acknowledgment that this proposal contradicts the earlier research document's recommendation. Adding a sentence explaining why the requirements have evolved (from "local development" to "distributable plugin") would resolve this.

## Action Items

1. [blocking] Add a note in the Background section acknowledging the evolution from the prior research document (`cdocs/reports/2026-02-04-wezterm-plugin-research.md`), which recommended the local `file://` approach. Explain that the current proposal addresses a different requirement: making the plugin distributable and shareable, not just functional locally.

2. [non-blocking] Verify whether WezTerm supports branch specifiers in plugin URLs (e.g., `https://github.com/user/repo#branch`). If supported, document it; if not, keep the current text.

3. [non-blocking] Clarify what happens to `config/wezterm/wezterm.lua` in Phase 3. Should it be deleted, updated to reference the GitHub URL, or kept as-is?

4. [non-blocking] Consider adding a brief "Alternatives Considered" section summarizing why git submodules, symlinking, or other approaches were not chosen.

5. [non-blocking] In the "Local Development Override" section, mention that developers can also directly edit the cached plugin in WezTerm's plugin directory for quick iteration.
