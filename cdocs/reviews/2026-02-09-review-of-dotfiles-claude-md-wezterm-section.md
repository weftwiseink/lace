---
review_of: dotfiles/CLAUDE.md (external repo: ~/code/personal/dotfiles/)
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T08:55:00-06:00
type: review
state: archived
status: done
tags: [fresh_agent, wezterm_validation, incident_response, empirically_verified]
---

# Review: Dotfiles CLAUDE.md -- WezTerm Config Changes Section

## Summary Assessment

This document establishes a validation workflow for wezterm config changes, motivated by
an incident where a background agent shipped a broken config (`{ CopyMode = 'ScrollToBottom' }`
is not a valid CopyModeAssignment variant). The document is well-structured, empirically
grounded, and correctly identifies the two-layer validation approach (`ls-fonts` stderr
check + `show-keys` diff). All claims were verified against the actual wezterm CLI during
drafting. After one round of corrections to fix inaccurate descriptions of error behavior,
the document is accurate and ready for use. **Verdict: Accept.**

## Section-by-Section Findings

### File Locations

Clean and correct. Both paths are accurate. The note about chezmoi deploy + hot-reload
is helpful context for agents unfamiliar with the workflow.

No findings.

### Validation Workflow

**Finding 1 (non-blocking): Step 1 captures copy_mode but not all key tables.**
The baseline capture only grabs `copy_mode` and the full key list. If the user has custom
`search_mode` overrides (they do -- see the deployed config), those should also be captured.
However, this is minor since the workflow generalizes and agents can adapt.

**Finding 2 (non-blocking): Step 3 uses relative path in `--config-file`.**
The command `wezterm --config-file dot_config/wezterm/wezterm.lua` assumes the working
directory is the dotfiles repo root. This was verified to work, but agents running from
other directories would fail. Consider noting the cwd requirement or using an absolute path.

**Finding 3 (non-blocking): The `ls-fonts` stderr check pattern is correct but could be tighter.**
The `grep -q ERROR` pattern would match any line containing "ERROR" in the log prefix
(e.g., `ERROR  wezterm_gui >` or `ERROR  logging >`). This is the right behavior since all
config errors use this prefix. Verified against actual wezterm output.

### Common Pitfalls

**Finding 4 (non-blocking): The CopyMode enum list may be incomplete or version-dependent.**
The list of valid CopyMode string variants was extracted from `show-keys` output and the
error message. It may not be exhaustive (wezterm could add new variants in future versions).
The document already mitigates this with "Always verify against `show-keys` output" -- good.

**Finding 5 (non-blocking): The `action_callback` pitfall is valuable but untestable via CLI.**
The document correctly notes that `action_callback`-based bindings show as
`EmitEvent 'user-defined-N'` and require manual key-press testing. This is an inherent
limitation. The existing config uses `action_callback` for the Escape binding in copy mode
(clearing selection vs. exiting), so this pitfall is directly relevant.

**Finding 6 (non-blocking): Minor redundancy between pitfall items.**
The first pitfall (CopyMode enum), second pitfall (config errors break everything), and
third pitfall (act.Multiple construction time) all describe aspects of the same failure
mode. This redundancy is acceptable because each bullet addresses a different angle that
agents need to understand, but they could reference each other to reduce repetition.

### Future Improvement Notes

All three NOTE callouts are reasonable and well-scoped. The pre-commit hook suggestion
correctly notes its limitation (catches parse errors but not silent fallbacks).

No findings.

## Verdict

**Accept.** The document accurately describes wezterm's config validation behavior, all
claims have been empirically verified against the actual CLI, and the two-layer validation
workflow (ls-fonts stderr + show-keys diff) provides genuine protection against the class
of error that caused the incident. The corrections made during drafting (fixing the
"silently dropped" claim to "throws error that crashes config") improved accuracy
significantly.

## Action Items

1. [non-blocking] Consider adding `search_mode` to the baseline capture in step 1, since
   the deployed config customizes search_mode as well.
2. [non-blocking] Note the cwd assumption in the `--config-file` commands, or provide
   absolute path alternatives for agents running from other directories.
3. [non-blocking] Consider reducing redundancy between the first three pitfall items by
   adding a brief "see above" cross-reference rather than restating the config-crash
   behavior in each.
