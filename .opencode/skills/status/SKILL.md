---
name: status
description: Query and manage CDocs document metadata (status, state, tags, filters)
argument-hint: "[filter or path] [--update status=value]"
---

# CDocs Status

Query and manage CDocs document metadata.

**Usage:** User-invoked for doc inventory and metadata updates. Claude may also auto-invoke to check document state when relevant to ongoing work.
Provides a lightweight "docs as DB" interface over `cdocs/` frontmatter.

## Invocation Modes

### List all documents
```
/cdocs:status
```
Scan all `cdocs/**/*.md` files (excluding READMEs), parse frontmatter, and display a summary table.

### Filter documents
```
/cdocs:status --type=proposal
/cdocs:status --status=wip
/cdocs:status --state=live --type=devlog
/cdocs:status --tag=architecture
```
Apply filters to narrow the results. Multiple filters are AND-combined.

### Update a document's metadata
```
/cdocs:status cdocs/proposals/2026-01-29-topic.md --update status=review_ready
/cdocs:status cdocs/proposals/2026-01-29-topic.md --update state=archived
```
Update a specific document's frontmatter field.

## Behavior

### Query Mode
1. Use Glob to find all `cdocs/**/*.md` files.
2. Filter out README.md files.
3. Read each file and extract YAML frontmatter.
4. Display a summary table:

```
| File                                    | Type     | State | Status       | Tags                    |
|-----------------------------------------|----------|-------|--------------|-------------------------|
| devlogs/2026-01-29-plugin-impl.md       | devlog   | live  | wip          | architecture, plugin    |
| proposals/2026-01-29-plugin-arch.md     | proposal | live  | review_ready | architecture, plugin    |
| reviews/2026-01-29-review-plugin.md     | review   | live  | done         | self, architecture      |
```

5. Apply filters from `$ARGUMENTS` if present.
6. Report total counts and breakdown by type/status.

### Update Mode
1. Parse the file path and field=value from `$ARGUMENTS`.
2. Read the target file.
3. Update the specified frontmatter field using Edit.
4. Confirm the change.

## Supported Filters

| Filter | Values |
|--------|--------|
| `--type` | `devlog`, `proposal`, `review`, `report` |
| `--state` | `live`, `deferred`, `archived` |
| `--status` | `request_for_proposal`, `wip`, `review_ready`, `implementation_ready`, `evolved`, `implementation_accepted`, `done` |
| `--tag` | Any tag value (partial match) |

## Scaling Note

This skill reads every cdocs file to parse frontmatter.
Practical up to ~100 documents.
For larger corpora, consider:
- A frontmatter index file (`cdocs/.index.json`) maintained by hooks.
- Promoting to an MCP server for richer query capabilities.
