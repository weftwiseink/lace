---
name: nit_fix
description: Enforce writing conventions on cdocs documents
argument-hint: "[file1.md file2.md ...]"
---

# CDocs Nit Fix

Dispatch the nit-fix agent to enforce writing conventions on cdocs documents: apply mechanical fixes and report judgment-required violations.

**Usage:** Invoked before review to clean up convention violations.
The user can also invoke it directly on any cdocs document.

## Invocation

### With file paths
```
/cdocs:nit_fix cdocs/proposals/2026-01-29-topic.md cdocs/devlogs/2026-01-29-topic.md
```
Run nit-fix on the specified files.

### Without arguments
```
/cdocs:nit_fix
```
Scan `cdocs/**/*.md` for all cdocs documents and run nit-fix on all of them (batch mode).

## Behavior

1. **Collect file paths**: from `$ARGUMENTS` or by globbing `cdocs/**/*.md` (excluding README files).
2. **Invoke the nit-fix agent**: use the Task tool with `subagent_type: "nit-fix"`, passing the list of absolute file paths in the prompt.
3. **Receive nit-fix report**: the agent returns a report with mechanical fixes already applied, plus judgment-required violations.
4. **Present results**: show the report to the caller. Highlight judgment-required violations that need manual attention.

## Dispatching the Nit-Fix Agent

Use the Task tool:
- `subagent_type`: `"nit-fix"`
- `prompt`: Include the absolute file paths to process, one per line. Example:

```
Enforce writing conventions on the following cdocs files:

/absolute/path/to/cdocs/proposals/2026-01-29-topic.md
/absolute/path/to/cdocs/devlogs/2026-01-29-session.md
```

The agent reads all rule files from `plugins/cdocs/rules/` at runtime, classifies conventions as mechanical or judgment-required, applies mechanical fixes directly via Edit, and returns a structured report.

## Interpreting Results

The agent returns a structured report with three sections:

- **FIXES APPLIED**: mechanical convention fixes already applied to the files. No action needed.
- **JUDGMENT REQUIRED**: violations that need the author's attention. The caller should address these manually.
- **CLEAN**: files with no violations.

If judgment-required violations exist, present them to the caller with the line numbers and context from the report.

## When to Invoke

- Before marking a document `review_ready` (pre-review cleanup).
- After completing a draft of any cdocs document.
- When the user wants to check convention compliance across the corpus.

## When NOT to Invoke

- Mid-authoring (the document is still being written).
- On non-cdocs files (the agent only processes cdocs documents).
- After trivial edits (typos, single-word changes) where convention violations are unlikely.
