---
name: triage
description: Triage cdocs documents for frontmatter maintenance and workflow recommendations
argument-hint: "[file1.md file2.md ...]"
---

# CDocs Triage

Dispatch the triage agent to analyze cdocs frontmatter, apply mechanical fixes, and recommend workflow actions.

**Usage:** Auto-invoked at the end of agent turns that created or modified cdocs documents.
The user can also invoke it directly.

## Invocation

### With file paths
```
/cdocs:triage cdocs/proposals/2026-01-29-topic.md cdocs/devlogs/2026-01-29-topic.md
```
Triage the specified files.

### Without arguments
```
/cdocs:triage
```
Scan for cdocs files modified in the current turn (based on recent Write/Edit operations on `cdocs/**/*.md` paths). If none found, prompt the user for paths or suggest running `/cdocs:status` to find documents.

## Behavior

1. **Collect file paths**: from `$ARGUMENTS` or from recent cdocs modifications in the current turn.
2. **Invoke the triage agent**: use the Task tool with `subagent_type: "triage"`, passing the list of absolute file paths in the prompt.
3. **Receive triage report**: the agent returns a report with mechanical fixes already applied, plus status and workflow recommendations.
4. **Verify changes**: after the triage agent completes, re-read the modified files to confirm only expected files were changed and edits are correct.
5. **Apply status recommendations**: evaluate each status transition recommendation. Apply sensible ones via Edit. Defer or ask the user if unsure.
6. **Route workflow actions**: dispatch based on the agent's workflow recommendations (see below).

## Dispatching the Triage Agent

Use the Task tool:
- `subagent_type`: `"triage"`
- `prompt`: Include the absolute file paths to triage, one per line. Example:

```
Triage the following cdocs files:

/absolute/path/to/cdocs/proposals/2026-01-29-topic.md
/absolute/path/to/cdocs/devlogs/2026-01-29-session.md
```

The agent reads the frontmatter spec at runtime, applies mechanical fixes (tags, timestamps, missing fields) directly via Edit, and returns a structured report with status and workflow recommendations.

## Acting on Workflow Recommendations

| Recommendation | Action | Agent |
|----------------|--------|-------|
| `[REVIEW]` | Invoke the reviewer agent via Task tool with `subagent_type: "reviewer"`. Pass the document path. | Reviewer agent (sonnet) |
| `[REVISE]` | Read the review's action items, revise the document inline. | Top-level agent (has authoring context) |
| `[ESCALATE]` | Report to the user with options. Review round >= 3 without acceptance indicates the loop needs human judgment. | Top-level agent presents options |
| `[STATUS]` | Apply the recommended frontmatter status update directly via Edit. | Top-level agent |
| `[NONE]` | No action needed. | - |

### Review Dispatch Details

When acting on a `[REVIEW]` recommendation:

1. Invoke the reviewer agent via Task tool with `subagent_type: "reviewer"`.
2. Pass the document path in the prompt. The reviewer agent has the review skill preloaded via its `skills` frontmatter field and reads rules at runtime: no inlining needed.
3. The reviewer agent writes the review to `cdocs/reviews/` and updates the target document's `last_reviewed` frontmatter.
4. After the reviewer agent completes, re-run triage on the review document to validate its frontmatter (the main agent dispatches this since agents cannot spawn subagents).
5. Report the review verdict to the user.

### Revision Dispatch Details

When acting on a `[REVISE]` recommendation:

1. Read the review document to find the action items.
2. Address each blocking action item in the original document.
3. Update non-blocking items where practical.
4. Update the document's `status` to `review_ready` after revision.
5. Run triage again to trigger re-review.

### Escalation Details

When acting on an `[ESCALATE]` recommendation:

1. Summarize the review history (rounds, key blocking issues).
2. Present options to the user:
   - Continue revising (another round).
   - Accept as-is despite open issues.
   - Defer or archive the document.
   - Start fresh with a new approach.

## When to Invoke Triage

Triage should run at the **end of agent turns** that involved substantive cdocs work:
- After creating a new cdocs document (devlog, proposal, review, report).
- After significant edits to an existing cdocs document.
- After completing a revision cycle.

Triage should **not** run:
- After trivial edits (typo fixes, formatting-only changes).
- Mid-authoring (while still writing a document).
- On non-cdocs files.

## Context Management

If the current session has already performed multiple major tasks (authoring + review + revision), triage may recommend deferring further workflow actions to a fresh session.
Claude Code's automatic compaction handles the mechanical concern; the deeper question is whether the agent has enough fresh perspective for quality revisions.
