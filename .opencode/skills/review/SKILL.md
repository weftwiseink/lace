---
name: review
description: Review a CDocs document with structured findings and a verdict
argument-hint: "<path_to_document>"
---

# CDocs Review

Conduct a structured review of a CDocs document.

**Usage:** Typically user-invoked when a document needs evaluation. Claude may also suggest a review when a document reaches `review_ready` status.
Reviews evaluate a document's quality, correctness, and completeness, producing findings and a verdict.

> IMPORTANT: Doc Reviews should keep an eye our for any underconsidered sections, potential pitfalls, and points in need of clarification.
> Reviewer should surface the latter at the end of the review as multiple choice options.


## Invocation

1. `$ARGUMENTS` must provide the path to the document to review (e.g., `cdocs/proposals/2026-01-29-topic.md`).
   If missing, prompt the user for the path from a picker of recently edited plausible `cdocs/`.
2. Read the target document fully.
3. If it is a devlog, review the resulting code diffs and context as well.
4. Determine today's date.
5. Create `cdocs/reviews/YYYY-MM-DD-review-of-{doc-name}.md` using the template below.
6. After writing the review, update the target document's `last_reviewed` frontmatter field.
7. If `cdocs/reviews/` doesn't exist, suggest running `/cdocs:init` first.

## Template

Use the template in `template.md` alongside this skill file.
Fill in:
- `review_of` with the target document path from repo root.
- `first_authored.by` with the current model name or `@username`.
- `first_authored.at` with the current timestamp including timezone.
- `task_list` with the relevant workstream path.
- `type: review`, `state: live`, `status: wip` (set to `done` on completion).
- Tags: describe aspects of the review, ie: `self` for self-review from same chat as work done, `fresh_agent` for the first pass review, `rereview_agent` for a follow-up from the same agent.
  Should also have tags for topics that matter most in the review, ie `architecture`, `test_plan`, `missing_validation` - use judgement and aim for descriptive power, creating new tags as needed.

## Sections

All reviews should include a Summary Assessment and Verdict.
Most reviews should include section-by-section findings and action items
You may also include novel sections not specified - use your judgement and think critically about what best serves the review.

### Summary Assessment
2-4 sentences covering:
- What the document or work is trying to accomplish.
- Overall quality assessment.
- The most important finding(s).
- The verdict (see below).

### Section-by-Section Findings
Evaluate each major section of the target document.
For each finding:
- Reference the specific section or content.
- State the issue clearly.
- Categorize as **blocking** (must fix before acceptance) or **non-blocking** (suggestion/improvement).
- Provide reasoning, not just the verdict.
- When rejecting an approach, suggest an alternative.

### Verdict
One of:
- **Accept:** Approve as-is. Minor non-blocking suggestions may be noted.
- **Revise:** Requires changes before acceptance. All blocking issues should be resolved. Specify what must change.
- **Reject:** Fundamentally flawed. Major rework or abandonment needed. Explain why.

### Action Items
Numbered list of specific tasks:

```
1. [blocking] Reclassify devlog skill as infrastructure, not deliverable.
2. [blocking] Add distribution/installation section.
3. [non-blocking] Consider adding scaling note to status skill.
```

Each action item should be specific enough to act on without re-reading the full review.

## Multi-Round Reviews

For subsequent review rounds:
- If you weren't the original reviewer, read the previous review(s) to understand prior findings.
- Note which prior action items have been addressed.
- Focus on changes since the last round, but keep an eye out for any new issues or potential improvements.
- Update the round number in the target's `last_reviewed.round`.
- If all blocking issues are resolved, verdict should shift toward Accept.

## Updating the Target Document

After completing the review, update the target document's frontmatter:

```yaml
last_reviewed:
  status: revision_requested | accepted | rejected
  by: "@reviewer_model_or_username"
  at: TIMESTAMP
  round: N
```

Map verdict to status:
- Accept -> `accepted`
- Revise -> `revision_requested`
- Reject -> `rejected`

## What Makes a Good Review

- Reference specific sections/content, not vague impressions.
- Explain the reasoning behind concerns.
- Distinguish blocking from non-blocking issues.
- Check for internal consistency across sections and code.
- Verify claims against available evidence.
- Consider maintainability and future impact.
- Suggest alternatives or follow-up research when rejecting approaches.
- Be critical but constructive.
- Follow our general rules on writing conventions.
