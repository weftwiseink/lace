---
review_of: cdocs/reports/2026-01-31-wezterm-server-feature-design-decisions.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T17:00:00-08:00
task_list: lace/devcontainer-features
type: review
state: live
status: done
tags: [fresh_agent, design-decisions, completeness, exposition-quality, cross-referencing]
---

# Review: Design Decisions: Wezterm Server Devcontainer Feature

## Summary Assessment

This document extracts design decisions from the wezterm-server proposal into a standalone reference report with 8 numbered decisions and a Usage Context section.
The quality is generally good: decisions are clearly stated, justifications are present, and the document is appropriately terse while retaining essential reasoning.
The primary concern is a mismatch between the 7 decisions listed in the proposal's "Design Requirements" summary and the 8 in this report, plus a minor gap where the wezterm URL conventions decision (7) carries more implementation detail than design rationale.
Verdict: **Accept** with minor non-blocking suggestions.

## Section-by-Section Findings

### Frontmatter

The frontmatter is well-formed and valid.
`type: report` and `status: done` are appropriate for a reference document.
No `last_reviewed` field exists yet, which is correct (this is the first review).

No issues.

### Opening paragraph

The BLUF-style opening line identifies the document's purpose and cross-references the proposal.
The reference path is correct and matches the actual proposal location.

No issues.

### Decision 1: Monorepo subdirectory

Clearly stated. The justification covers the `features-namespace` override mechanism, explains why co-location is preferred (primary consumer, simpler iteration), and notes the extraction escape hatch.
This matches the proposal's Decision 1 and retains the essential reasoning without bloat.

No issues.

### Decision 2: Extract from .deb/.rpm/AppImage

Strong justification: quantifies the avoided overhead (100+ MB of GUI dependencies), names the extraction methods per distro family, and grounds the decision in the existing Dockerfile pattern.
This is one of the most important decisions and the exposition level is appropriate.

No issues.

### Decision 3: Cross-platform distro detection

The table mapping distro families to detection, package format, and extraction method is a good, terse reference.
The note that the `.deb` path is most tested and the others extend reach is useful signal.

No issues.

### Decision 4: Depend on sshd feature via installsAfter

Clearly states it is a soft dependency and explains the semantics: ordering only applies when both features are present, and the feature does not fail without sshd.
The note about `installsAfter` for `common-utils` (curl availability) is a useful addition.

No issues.

### Decision 5: Use _REMOTE_USER for runtime directory ownership

Concise and well-justified. Explains the portability benefit over hardcoded `node` or UID `1000`.

No issues.

### Decision 6: Workflows at repo root with path filters

Accurate and terse. States the constraint (GitHub Actions only reads from `.github/workflows/`) and the mitigation (path-scoped triggers).

No issues.

### Decision 7: Wezterm release URL conventions

**Finding 1 (non-blocking): More implementation detail than design decision.**
This section reads more like an implementation reference (documenting URL naming patterns) than a design decision with alternatives considered.
The actual design decision is implicit: "the install script must handle per-platform URL construction rather than using a single download pattern."
The `set -eu` plus `curl -f` note is a useful implementation principle but is not really a "decision" in the same sense as the others.

Consider reframing the lead sentence to state the decision more explicitly (e.g., "Per-platform URL construction is required because wezterm's release naming conventions vary by distro and architecture") and demoting the URL specifics into supporting detail.
This is stylistic and non-blocking.

### Decision 8: Phase 4 deferred

Clearly states what was deferred and why, with a cross-reference to the feature-based-tooling proposal.
This is a useful decision to capture since it documents the scope boundary.

No issues.

### Usage Context section

This section is a valuable addition that goes beyond the proposal's decisions.
It explains the end-to-end usage pattern (host wezterm with SSH domain, container sshd on 2222, mux server daemonize) and references the SSH key management RFP.

**Finding 2 (non-blocking): The cross-reference to the SSH key management RFP is good, but the path could be verified.**
The path `cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md` appears to be correct based on the glob results.

No issues beyond the observation.

### Completeness check: proposal decisions vs. report decisions

The proposal's "Design Requirements" section (lines 397-412) lists 7 decisions:

1. Monorepo subdirectory -> Report Decision 1
2. Extract binaries from packages -> Report Decision 2
3. Cross-platform via distro detection -> Report Decision 3
4. Depend on sshd via installsAfter -> Report Decision 4
5. `_REMOTE_USER` for runtime dir ownership -> Report Decision 5
6. Workflows at repo root with path triggers -> Report Decision 6
7. Phase 4 deferred to feature-based-tooling -> Report Decision 8

The report adds two decisions not in the proposal summary:

- Report Decision 7 (Wezterm release URL conventions): derived from the proposal's "Edge Cases" section rather than the "Design Requirements" section.
- Report Decision 8 maps to proposal Decision 7.

**Finding 3 (non-blocking): The proposal's Design Requirements section lists 7 items but does not include "wezterm release URL conventions."**
The report has 8 decisions because it promoted an edge case into a numbered decision.
This is reasonable (URL handling is a real design concern), but the proposal's summary and the report are now out of sync.
The proposal should either add a Decision 8 for URL conventions or the report should note that Decision 7 was promoted from the Edge Cases section for reference purposes.
Since this review is scoped to the report, and the report's own content is self-consistent, this is non-blocking.

### Comparison with the packages-lace design decisions report

The sibling report (`2026-01-31-packages-lace-design-decisions.md`) follows a similar format with numbered decisions, each containing a brief heading and 2-4 paragraphs of rationale, plus a "Usage Stories" section at the end.
This report is consistent in structure and tone.
The wezterm report's "Usage Context" serves the same role as the packages-lace report's "Usage Stories," providing end-to-end context.

No issues.

### Writing conventions compliance

- BLUF: The opening sentence serves as an implicit BLUF. A formal `> BLUF:` block is absent, but for a reference/report document (as opposed to a proposal or communication), this is acceptable.
- Sentence-per-line: Generally followed. Some sentences are long but not egregiously so.
- History-agnostic framing: The document uses present tense throughout. Decision 2 says "This is the proven pattern from the lace Dockerfile, generalized across distro families" which is appropriately framed.
- No emojis, no em-dashes: Compliant. Colons are used properly.

No issues.

## Verdict

**Accept.**

The document achieves its stated purpose: it is a terse, implementation-focused reference that retains essential reasoning from the proposal.
All 8 decisions are clearly stated and justified.
The only structural concern (Decision 7 being more of an implementation reference than a design decision) is minor.
The document is well-suited for its intended role of being referenced from the proposal's "Design Requirements" section.

## Action Items

1. [non-blocking] Consider reframing Decision 7's lead sentence to state the design decision explicitly rather than leading with implementation details about URL naming conventions.
2. [non-blocking] Synchronize the proposal's "Design Requirements" section to account for the 8th decision (URL conventions) that was promoted from edge cases, or add a note in the report that Decision 7 was promoted from the proposal's Edge Cases section.
3. [non-blocking] Consider adding a formal `> BLUF:` line at the top for consistency with other cdocs, though this is optional for reference reports.
