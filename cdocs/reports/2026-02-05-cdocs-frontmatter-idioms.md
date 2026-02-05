---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-05T00:00:00-08:00
type: report
subtype: analysis
state: live
status: done
tags: [cdocs, frontmatter, idioms, patterns, workflow, analysis]
---

# CDocs Frontmatter Idioms Discovery Report

> BLUF: Analysis of 89 cdocs files reveals organically evolved frontmatter patterns that extend beyond the original spec.
> Key discoveries: the evolution idiom (`state: evolved` + `evolved_into:`) for documents that spawn successors rather than being revised in place; emerging report subtypes (executive_summary, technical-research, analysis); an informal distinction between decision proposals and implementation proposals; and significant status value fragmentation (26 unique values observed).
> The `state` vs `status` distinction has proven valuable but needs clearer documentation.
> Several patterns are ready for formalization; others warrant further observation.

## Context / Background

This report analyzes frontmatter patterns observed across 89 cdocs documents (24 devlogs, 20 proposals, 18 reports, 27 reviews) created between 2026-01-30 and 2026-02-05.
The goal is to identify idioms that have emerged organically through use, distinguish patterns worth formalizing from one-offs, and surface inconsistencies that could be standardized.

---

## Evolution Idiom

### Observed Pattern

When a proposal receives `revision_requested` from review but the revisions are substantial enough to warrant a new document, we observe:

1. Original document marked with `state: evolved`
2. Original document receives `evolved_into: cdocs/proposals/...` field pointing to successor
3. Successor document may include `supersedes:` field pointing back

**Examples observed:**

| Original | Successor | Notes |
|----------|-----------|-------|
| `dev-dependency-cross-project-mounts.md` | `lace-plugins-system.md` | Major scope expansion |
| `wezterm-project-picker.md` | `multi-project-wezterm-plugin.md` | Implementation approach changed |
| `multi-project-wezterm-plugin.md` | `port-scanning-wezterm-discovery.md` | Architecture pivot |

### Evolution vs. In-Place Revision

The pattern suggests a threshold question: when should a document evolve vs. be revised in place?

**Observed triggers for evolution:**
- Scope expansion beyond original objective (dev-deps to plugins)
- Fundamental architecture change (registry to port-scanning)
- New author taking ownership of the direction
- Human feedback requesting significant reframe

**In-place revision remained appropriate when:**
- Addressing specific blocking issues from review
- Adding missing sections (test plan, edge cases)
- Clarifying ambiguities without changing direction

### Current State Values

The `state` field uses:
- `live` - Active, canonical document
- `evolved` - Superseded by a successor, kept for history
- `archived` - Work complete, no longer actively referenced

**Missing but potentially useful:**
- `deferred` - Explicitly set aside for future consideration (observed only in `status` field)

---

## Report Subtypes

### Observed Subtype Values

The `subtype:` field appears on 4 reports:

| Subtype | Example | Purpose |
|---------|---------|---------|
| `executive_summary` | `wezterm-sidecar-executive-summary.md` | High-level status for stakeholders |
| `analysis` | `wezterm-overlay-system-deep-dive.md` | Technical deep-dive |
| `technical-research` | `port-scanning-project-discovery-research.md` | Investigation with recommendations |

### Emerging Report Categories (Not Formalized)

Beyond explicit subtypes, report naming and content reveals informal categories:

**Status reports:**
- `wezterm-workstream-status.md`
- `dotfiles-migration-executive-status.md`
- Track progress across multiple documents/phases

**Design decision reports:**
- `packages-lace-design-decisions.md`
- `lace-plugins-design-decisions.md`
- `wezterm-server-feature-design-decisions.md`
- Capture rationale for architectural choices

**Research reports:**
- `chezmoi-migration-research.md`
- `dev-dependency-mounts-research.md`
- `wezterm-plugin-research.md`
- Background investigation before proposals

**Assessment reports:**
- `cdocs-init-quality-assessment.md`
- `neovim-lace-assessment.md`
- Evaluation of existing state

### Recommendation

The `subtype` field is useful for reports.
Consider standardizing: `executive-summary`, `status`, `design-decisions`, `research`, `analysis`, `assessment`.

---

## Proposal Types

### Decision vs. Implementation Proposals

No formal distinction exists, but proposals naturally fall into two categories:

**Decision proposals** - Explore options, make architectural choices:
- Typically have "Background" sections with alternatives considered
- Include "Design Decisions" sections with numbered decisions
- May spawn multiple implementation proposals

**Implementation proposals** - Detailed specs for building:
- Typically have "Phases" sections with concrete steps
- Include "Test Plan" sections
- Reference decisions made in prior documents

**Observed examples:**

| Type | Example |
|------|---------|
| Decision | `devcontainer-feature-based-tooling.md` |
| Implementation | `scaffold-devcontainer-features-wezterm-server.md` |
| Decision | `dev-dependency-cross-project-mounts.md` (evolved) |
| Implementation | `lace-plugins-system.md` |

### RFP (Request for Proposal) Status

The `status: request_for_proposal` value marks stub proposals awaiting elaboration:
- `rfp-plugin-conditional-loading.md`
- `rfp-plugin-host-setup.md`
- `smart-prebuild-cache-busting.md`
- `secure-ssh-key-auto-management-lace-cli.md`

These are intentionally minimal, capturing intent for future work.

---

## Status Field Analysis

### All Observed Status Values (26 unique)

**Common values (10+ occurrences):**
| Status | Count | Document Types |
|--------|-------|----------------|
| `done` | 45 | reviews, reports, devlogs |
| `review_ready` | 7 | proposals, devlogs |

**Proposal-specific values:**
| Status | Count | Meaning |
|--------|-------|---------|
| `accepted` | 4 | Review approved, awaiting implementation |
| `implementation_accepted` | 5 | Implementation proposal approved |
| `implementation_complete` | 1 | Proposal fully implemented |
| `request_for_proposal` | 6 | Stub awaiting elaboration |
| `superseded` | 1 | Replaced by evolved document |
| `deferred` | 1 | Set aside for future |
| `implemented` | 1 | Code complete (variant of implementation_complete) |
| `implementation_ready` | 1 | Proposal ready for implementation |

**Devlog-specific values:**
| Status | Count | Meaning |
|--------|-------|---------|
| `completed` | 5 | Work finished |
| `complete` | 3 | Work finished (inconsistent spelling) |
| `implementation_wip` | 1 | Implementation in progress |
| `handoff` | 1 | Ready for handoff to next agent |

**Report-specific values:**
| Status | Count |
|--------|-------|
| `wip` | 5 |
| `final` | 1 |

**Review-specific:**
All reviews use `status: done` when complete.

### Inconsistencies to Address

1. **`completed` vs `complete` vs `done`** - Three values meaning the same thing
2. **`implementation_accepted` vs `accepted`** - Proposal type implied by document, redundant prefix
3. **`implementation_complete` vs `implemented`** - Same meaning, different spelling
4. **`review_ready` used on devlogs** - Reviews are typically for proposals

### Recommendation

Standardize to:
- `wip` - Work in progress
- `review_ready` - Ready for review
- `done` - Terminal state for all document types
- `accepted` - Proposal approved (drop `implementation_` prefix)
- `request_for_proposal` - Stub awaiting elaboration
- `deferred` - Set aside
- `handoff` - Ready for next agent

---

## State vs. Status Distinction

### Current Usage

| Field | Purpose | Values |
|-------|---------|--------|
| `state` | Document lifecycle | `live`, `evolved`, `archived` |
| `status` | Work progress | `wip`, `review_ready`, `done`, etc. |

### Is This Distinction Useful?

**Yes.** The separation allows:
- A document to be `status: done` but `state: live` (completed reference document)
- A document to be `status: done` but `state: archived` (historical record)
- A document to be `status: accepted` but `state: evolved` (superseded by newer approach)

Without this distinction, we would conflate "is the work finished?" with "is this document current?".

### Clarity Issues

The `last_reviewed.status` field uses different values than the document `status` field:
- `last_reviewed.status: accepted` vs document `status: accepted`
- `last_reviewed.status: revision_requested` (not a document status)

This is correct but may cause confusion.
Consider renaming to `last_reviewed.verdict`.

---

## Tags Analysis

### Most Common Tags (10+ occurrences)

| Tag | Count | Notes |
|-----|-------|-------|
| `wezterm` | 35 | Dominant workstream |
| `devcontainer` | 28 | Core technology |
| `architecture` | 24 | Review focus |
| `plugin`/`plugins` | 16 | Inconsistent plural |
| `dotfiles` | 10 | Workstream |
| `implementation` | 10 | Document type indicator |

### Tag Conventions Emerging

**Review-specific tags:**
- `fresh_agent` - First-time reviewer perspective
- `rereview_agent` - Follow-up review after revisions
- `self` - Self-review by author
- `revision_review` - Review of revised document

**Domain tags:**
- Technology: `wezterm`, `devcontainer`, `chezmoi`, `lua`, `docker-cli`
- Area: `dotfiles`, `plugins`, `prebuild`, `port-scanning`

**Quality tags:**
- `test_plan`, `test_coverage`, `code_quality`
- `architecture`, `design-decisions`

### Inconsistencies

- `plugin` vs `plugins` (both used)
- `design-decisions` vs `design_decisions` (hyphen vs underscore)
- Review tags use underscores (`test_plan`), domain tags use hyphens (`port-scanning`)

---

## Workflow Patterns

### Document Creation to Acceptance Flow

Typical proposal lifecycle:

```
[RFP stub] ─(elaborate)─> [wip] ─(author)─> [review_ready] ─(review)─> [accepted/revision_requested]
                                                                              │
                                           [revision_requested] ─(revise)─> [review_ready] (cycle)
                                                       │
                                           (major change) ─(evolve)─> [new document]
```

### Devlog vs. Report Distinction

**Devlogs** document implementation work:
- Created after proposal acceptance
- Track phases, blockers, decisions made during implementation
- Reference the implementing proposal via `implements:` field

**Reports** document investigation or status:
- Created before proposals (research) or alongside (status tracking)
- May spawn proposals
- Never "implement" anything

### Cross-Reference Fields

Observed relationship fields:
- `implements:` - Devlog implementing a proposal
- `review_of:` - Review examining a document
- `supersedes:` - Document replacing another
- `evolved_into:` - Pointer to successor
- `superseded_by:` - Pointer to replacement
- `parent:` - Sub-proposal relationship
- `related_to:` - Loose association

---

## Recommendations Summary

### Ready for Formalization

1. **Evolution idiom**: Document `state: evolved` + `evolved_into:` pattern
2. **Report subtypes**: Standardize `subtype:` values for reports
3. **Status consolidation**: Reduce 26 values to ~7 core values
4. **Tag normalization**: Pick one style (hyphens vs underscores)

### Needs Further Observation

1. **Decision vs. implementation proposal distinction**: May be useful, but could add overhead
2. **Review verdict field rename**: `last_reviewed.verdict` instead of `last_reviewed.status`
3. **Formal `deferred` state**: Only one example so far

### Anti-Patterns to Avoid

1. **Status inflation**: Creating new status values for edge cases
2. **Redundant prefixes**: `implementation_accepted` when document type is obvious
3. **Inconsistent terminal states**: `done` vs `completed` vs `complete`

---

## Appendix: Status Value Audit

### Full Status Enumeration

| Status Value | Count | Should Become |
|--------------|-------|---------------|
| `done` | 45 | `done` (keep) |
| `review_ready` | 7 | `review_ready` (keep) |
| `completed` | 5 | `done` |
| `wip` | 5 | `wip` (keep) |
| `request_for_proposal` | 6 | `request_for_proposal` (keep) |
| `implementation_accepted` | 5 | `accepted` |
| `accepted` | 4 | `accepted` (keep) |
| `complete` | 3 | `done` |
| `implemented` | 1 | `done` |
| `implementation_complete` | 1 | `done` |
| `implementation_ready` | 1 | `accepted` |
| `implementation_wip` | 1 | `wip` |
| `superseded` | 1 | (remove, use `state: evolved`) |
| `deferred` | 1 | `deferred` (keep) |
| `handoff` | 1 | `handoff` (keep) |
| `final` | 1 | `done` |
