---
review_of: cdocs/proposals/2026-03-12-devcontainer-tool-integration-docs.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-13T08:47:51-07:00
task_list: lace/docs
type: review
state: live
status: done
tags: [self, documentation, mount-patterns, scope]
---

# Review: Documentation improvements for mount systems and devcontainer tool integration

## Summary Assessment

This proposal identifies real documentation gaps exposed by two concrete breakages and proposes four targeted additions to the README, troubleshooting guide, and migration guide.
The background and design decisions are well-grounded in hands-on debugging.
The main concern is scope calibration: the proposal treats lace as a multi-user tool with general documentation needs, but it currently has a single-user audience, and two of the four proposed changes add minimal value given that audience.
Verdict: Accept with minor adjustments — drop the migration guide step and streamline the README section placement.

## Section-by-Section Findings

### BLUF

Clear and accurate.
**Non-blocking:** "git credential helpers, etc." is speculative — no evidence of git credential issues was encountered.
Removing the hedging phrase keeps the BLUF tighter.

### Background

Excellent.
Both failure modes are well-documented with root cause and fix.
The "Existing documentation" subsection correctly identifies the gaps.
No issues.

### Proposed Solution

**§1 — New README section: "Tool integration patterns"**

**Non-blocking:** Placement "after Repo mounts and before Workspace layout" makes this a peer of major feature sections.
Given that it documents interaction patterns rather than a lace feature, it may read better as a subsection under an existing section or placed after "Host-side validation" (closer to the troubleshooting end of the doc).
Alternatively, a standalone section works if kept concise — the risk is it grows into a catch-all for tool-specific workarounds.

**Non-blocking:** Subsection (c), `CONTAINER_WORKSPACE_FOLDER`, is loosely related to the mount path-remapping theme.
It's already an env var set in the generated devcontainer.json and is visible in the config.
A one-line note in the workspace layout section may be more discoverable than burying it in a tool-integration section.

**§2 — Troubleshooting entries**

Good additions, both follow the established format.
No issues.

**§3 — Migration guide addition**

**Non-blocking:** The migration guide is structured as incremental adoption steps (1–6), each independently valuable.
A "step 3.5" for tool-specific mount patterns breaks this progression — it's not a migration step, it's a troubleshooting/recipe concern.
The troubleshooting entries (§2) and the README section (§1) already cover this.
Recommend dropping this phase to keep the migration guide focused on lace adoption mechanics.

**§4 — Expand repo mounts "Settings overrides" motivation**

Good.
Two sentences of motivation before the existing example adds clarity without bloat.

### Design Decisions

All three decisions are sound and well-reasoned.
The "downstream tool failures in troubleshooting" decision is the strongest — it directly addresses discoverability.

### Edge Cases

All three are relevant.
The "shared `installed_plugins.json`" point is important — the docs should explicitly warn against modifying bind-mounted config files as a workaround.

### Implementation Phases

Clear, appropriately scoped.
Phase 3 (migration guide) should be dropped per the finding above.

## Verdict

**Accept** with non-blocking adjustments.
No blocking issues — the core additions (README section, troubleshooting entries, repo-mount motivation) are well-targeted.
The migration guide step can be dropped without loss.

## Action Items

1. [non-blocking] Drop Phase 3 (migration guide step 3.5) — the troubleshooting entries and README section provide sufficient coverage without breaking the migration guide's incremental structure.
2. [non-blocking] Consider placing the "Tool integration patterns" section after "Host-side validation" rather than between "Repo mounts" and "Workspace layout," to group it with other operational/diagnostic content.
3. [non-blocking] Remove speculative tool references ("git credential helpers, etc.") from the BLUF — stick to what was actually encountered.
4. [non-blocking] Move the `CONTAINER_WORKSPACE_FOLDER` note to the workspace layout section as a one-liner rather than a subsection of tool integration.
