---
review_of: cdocs/proposals/2026-02-16-rfp-worktrunk-project-naming.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T20:15:00-06:00
task_list: worktrunk/project-naming
type: review
state: live
status: done
tags: [fresh_agent, bash, go_template, docker, discovery, phase3]
---

# Review: Phase 3 Bash Script Changes (Worktrunk Project Naming)

## Summary Assessment

Phase 3 replaces `basename`-only project name derivation in `bin/lace-discover` and `bin/wez-into` with label-based lookup using Docker's `--format` Go template syntax, falling back to `basename` for pre-label containers.
The implementation is clean, correct, and matches the proposal spec precisely.
All five verification points from the user's request check out with no issues found.
Verdict: **Accept**.

## Section-by-Section Findings

### 1. Go Template Syntax in `discover_raw()` (lace-discover:61-63)

```bash
--format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Ports}}\t{{.Label "lace.project_name"}}'
```

**Finding: Correct.** The `{{.Label "lace.project_name"}}` syntax is the proper Docker Go template accessor for container labels.
It matches the existing `{{.Label "devcontainer.local_folder"}}` pattern already in use.
When the label is absent (pre-label containers), Docker renders an empty string, which is exactly what the fallback logic needs.

The comment on line 60 correctly documents the new field: `# Format: container_id \t local_folder \t ports \t project_name`.

### 2. Go Template Syntax in `discover_stopped()` (wez-into:118-121)

```bash
--format '{{.Label "devcontainer.local_folder"}}\t{{.Label "lace.project_name"}}'
```

**Finding: Correct.** Same template syntax, consistent with `lace-discover`.
The `2>/dev/null` suppression and pipe into the while-read loop are preserved from the original structure.

### 3. IFS Field Count in `discover_projects()` (lace-discover:68)

```bash
while IFS=$'\t' read -r container_id local_folder ports project_name; do
```

**Finding: Correct.** The format template produces 4 tab-separated fields: `ID`, `local_folder`, `Ports`, `project_name`.
The `IFS=$'\t' read -r` captures exactly 4 variables.
When `lace.project_name` is absent, `project_name` receives an empty string (Docker outputs an empty field, and `read` assigns the remainder of the last field which is empty).

### 4. IFS Handling in `discover_stopped()` (wez-into:122)

```bash
| while IFS=$'\t' read -r local_folder project_name; do
```

**Finding: Correct.** The format template produces 2 tab-separated fields.
The `IFS=$'\t' read -r` captures exactly 2 variables.
This is consistent with the original structure (which had `IFS=` for a single field) adapted for the new two-field format.

### 5. Fallback Syntax (lace-discover:73, wez-into:125)

```bash
name="${project_name:-$(basename "$local_folder")}"
```

**Finding: Correct.** This is standard bash parameter expansion: if `$project_name` is unset or empty, evaluate and use `$(basename "$local_folder")`.
The `basename` call is properly quoted.
The command substitution is only executed when the label is absent, so there is no performance penalty for labeled containers.
Both files use identical syntax, which is good for consistency.

### 6. No Old basename-Only Code Paths

**Finding: Clean.** A grep for `basename` in `bin/` shows only three occurrences:

1. `bin/wez-into:18` -- `SCRIPT_NAME="$(basename "$0")"` (unrelated, script name)
2. `bin/wez-into:125` -- inside the fallback (correct)
3. `bin/lace-discover:73` -- inside the fallback (correct)

No standalone `name=$(basename "$local_folder")` lines remain.
No commented-out old logic.
No dead code paths.

### 7. Output Format Preservation

**Finding: Correct.** The external output format is unchanged:

- Text: `name:port:user:local_folder` (colon-separated, 4 fields)
- JSON: `{"name":"...","port":N,"user":"...","path":"...","container_id":"..."}`
- `discover_stopped()`: `name\tworkspace_path` (tab-separated, 2 fields)

Only the derivation of the `name` value changed. The `path` field still comes directly from `devcontainer.local_folder`, not from any label.

All downstream consumers in `wez-into` (`IFS=: read -r name p user path`, `IFS=$'\t' read -r sname spath`) continue to work without modification because the field count, delimiters, and semantics are preserved.

### 8. Consistency Between the Two Scripts

**Finding: Good.** Both `lace-discover` and `wez-into` use the same approach:

- Add `lace.project_name` to the Docker `--format` template
- Read the new field via `IFS=$'\t' read`
- Apply the fallback via `${project_name:-$(basename "$local_folder")}`

The symmetry reduces maintenance burden and cognitive load.

### 9. Edge Case: Empty Label Value vs. Missing Label

Docker's Go template `{{.Label "lace.project_name"}}` returns an empty string for both "label not set" and "label set to empty string".
The `${project_name:-...}` fallback handles both cases identically (treats empty as unset).
This is the correct behavior: an empty label should fall back to `basename` just like a missing one.

## Verdict

**Accept.** The Phase 3 bash changes are correct, clean, and faithful to the proposal spec.
Go template syntax is valid, IFS field counts match, fallback expansion is proper bash, no legacy code paths remain, and output formats are preserved.
No blocking issues found.

## Action Items

1. [non-blocking] Consider adding a brief inline comment in `discover_raw()` noting that `{{.Label "lace.project_name"}}` yields empty string for pre-label containers, to make the fallback contract explicit at the source rather than only at the consumer. The current comment on line 72 covers it at the consumer side, which is arguably sufficient.
