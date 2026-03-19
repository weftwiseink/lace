---
paths:
  - "cdocs/**/*.md"
---

# CDocs Frontmatter Specification

Every CDocs document requires YAML frontmatter.
This spec defines the fields, their types, and valid values.

## Template

```yaml
---
review_of?: cdocs/.../YYYY-MM-DD-doc-name.md   # reviews only
first_authored:
  by: "@claude-opus-4-5-20251101"                  # or "@username"
  at: 2026-01-29T08:00:00-08:00                    # ISO 8601 with TZ
task_list: workstream/task-name
type: devlog | proposal | review | report
state: live | deferred | archived
status: wip                                        # see per-type values below
last_reviewed?:                                    # not on reviews themselves
  status: revision_requested | accepted | rejected
  by: "@reviewer"
  at: 2026-01-29T09:00:00-08:00
  round: 1
tags: [architecture, future_work, ...]
---
```

## Field Definitions

### `review_of` (optional, reviews only)
Path to the subject document from repo root.
Only present on review-type documents.

### `first_authored` (required)
- **`by`**: Full API-valid model name prefixed with `@` (e.g., `@claude-opus-4-5-20251101`), or `@username` for human authors.
- **`at`**: ISO 8601 timestamp with timezone offset. Always include TZ for maximum usefulness.

### `task_list` (required)
Claude task list tracking for a constrained/inter-related arc of work.
Use `/` namespacing to capture workstream hierarchy: `organization/initial-scaffolding`, `cdocs/plugin-architecture/core-skills`.

### `type` (required)
Corresponds to subdirectory under `cdocs/`:
- `devlog`: Development logs in `cdocs/devlogs/`
- `proposal`: Design proposals in `cdocs/proposals/`
- `review`: Document reviews in `cdocs/reviews/`
- `report`: Reports in `cdocs/reports/`

May be expanded as new doc types are added.

### `state` (required)
High-level condition of the document and/or its related work:
- `live`: Active, current.
- `deferred`: Postponed for later. Common with proposals tagged `future_work`.
- `archived`: No longer active or relevant.

### `status` (required)
Starts at `wip`. Additional values depend on type:
- `request_for_proposal`: Stub proposal requesting future elaboration. Proposals only.
- `wip`: Work in progress. All types.
- `review_ready`: Statement of work complete, ready for review. Used by devlogs, proposals, reports.
  - For devlogs, reviews apply to the work that was done, not just the document.
- `implementation_ready`: Proposal design has been reviewed and accepted, ready to implement. Proposals only.
- `evolved`: Proposal has been superseded by a new version or follow-up proposal.
- `implementation_accepted`: Proposal's implementation has been completed and accepted.
- `done`: Work complete and verified.

### `last_reviewed` (optional, not on reviews)
Tracks review history. Reviews themselves do not have this field.
- **`status`**: `revision_requested`, `accepted`, `rejected`. May be expanded per type.
- **`by`**: Same format as `first_authored.by`.
- **`at`**: Same format as `first_authored.at`.
- **`round`**: Integer count of review rounds.

### `tags` (required)
Limited freeform set of the most relevant topics.
- Reviews should use tags like: `self`, `fresh_agent`, `rereview_agent`, `runtime_validated`, `ui_validated`, `architecture`.
- Proposals might use: `future_work`, `architecture`, `claude_skills`.
- Keep the set focused. Prefer reusing existing tags over inventing new ones.

## File Naming

All cdocs use `{YYYY-MM-DD}-{dash-case}.md` format.
Examples:
- `2026-01-29-cdocs-plugin-architecture.md`
- `2026-01-29-review-of-cdocs-plugin-architecture.md`

## Media

Media files are dated, saved to `cdocs/_media/`, and embedded into the relevant doc.
Format: `YYYY-MM-DD-description.ext`
