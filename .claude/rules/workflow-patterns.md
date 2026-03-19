# CDocs Workflow Patterns

General workflow patterns for development sessions.
These apply to all substantive work, not just specific doc types.

## Dispatching Parallel Agents (Tactical Use)

When 3+ independent failures occur, investigate in parallel instead of sequentially.

**Use when:**
- 3+ test failures across different files/subsystems
- Each failure's domain is clearly identifiable (e.g., editor sync, authorship tracking, UI components)
- Failures appear independent (different root causes)
- No shared state between investigations

**Don't use when:**
- Single failure or 2 related failures
- Root cause unclear (need exploratory debugging first)
- Failures likely share underlying cause
- Agents would edit same files (conflict risk)

**Document in devlog:** Synthesize parallel agent findings into coherent narrative in "Issues Encountered and Solved" section.

## Subagent-Driven Development (Complex Multi-Task Plans)

Use for structured execution of complex implementation plans with 5+ tasks.

**Use when:**
- Proposal has 5+ implementation phases
- Tasks are largely independent
- Each task has clear success criteria
- Implementation is well-understood upfront

**Don't use when:**
- Exploratory implementation (learning as you go)
- Tightly coupled tasks requiring cross-task context
- Simple 1-3 task changes
- Heavy UI/collaboration work requiring manual verification

**Critical requirements:**
- Maintain devlog as single source of truth (synthesize subagent findings)
- Always perform final manual verification via dev server
- Document high-level technical decisions in devlog
- Capture emergent issues that required deviation from plan

## Pre-Review Nit Fix

Before marking a document `review_ready`, run `/cdocs:nit_fix` to clean up mechanical convention violations.
This reduces reviewer noise: the reviewer focuses on substance rather than formatting.

**Recommended pipeline:** author -> nit-fix -> triage -> review.

1. Author completes the document draft.
2. Invoke `/cdocs:nit_fix` on the document. The nit-fix agent (haiku, tools: Read/Glob/Grep/Edit) reads all `rules/*.md` files, applies mechanical fixes (sentence-per-line, callout attribution, punctuation, emoji removal), and reports judgment-required violations.
3. Address any judgment-required violations manually.
4. Invoke `/cdocs:triage` to validate frontmatter and trigger the review workflow.
5. The reviewer sees a clean document and focuses on content quality.

**Use when:**
- A document is ready for review (about to transition to `review_ready`).
- Batch cleanup across the corpus is desired.
- The author wants to check convention compliance during drafting.

**Don't use when:**
- Still mid-authoring (the document is actively being written).
- Only frontmatter changes were made (triage handles frontmatter).

## End-of-Turn Triage

After completing substantive work on cdocs documents, invoke `/cdocs:triage` to maintain frontmatter accuracy and trigger workflow continuations.

**Invoke when:**
- A new cdocs document was created (devlog, proposal, review, report)
- Significant edits were made to an existing cdocs document
- A revision cycle was completed

**Don't invoke when:**
- Only trivial edits were made (typos, formatting)
- Still mid-authoring (document not yet complete for this turn)
- No cdocs files were touched

**How it works:**
1. The top-level agent invokes the triage agent via Task tool (`subagent_type: "triage"`) with the list of modified cdocs file paths.
2. The triage agent (haiku, tools: Read/Glob/Grep/Edit) reads each file, applies mechanical frontmatter fixes directly (tags, timestamps, missing fields), and returns a report with status and workflow recommendations.
3. The top-level agent verifies changes, applies status recommendations, and dispatches workflow actions:
   - `[REVIEW]`: invoke the reviewer agent (`subagent_type: "reviewer"`).
   - `[REVISE]`: revise inline per review action items.
   - `[ESCALATE]`: present options to the user (round >= 3 without acceptance).
   - `[STATUS]`: apply frontmatter status update.
   - `[NONE]`: no action needed.
4. After review completes, re-triage the review document to validate its frontmatter.

**Architecture:** Three formal agents in `plugins/cdocs/agents/`:
- **nit-fix** (haiku): writing convention enforcement on document body prose. Reads all `rules/*.md` files at runtime, applies mechanical fixes, reports judgment-required violations. Infrastructure-enforced tool allowlist (no Write/Bash).
- **triage** (haiku): mechanical frontmatter analysis and fixes. Infrastructure-enforced tool allowlist (no Write/Bash).
- **reviewer** (sonnet): structured document reviews. Preloads the review skill via `skills: [cdocs:review]`, reads rules at runtime.

Each agent has a thin dispatcher skill: `/cdocs:nit_fix`, `/cdocs:triage`, and the triage skill dispatches the reviewer.
Skills own orchestration (when to invoke, how to route); agents own their prompts (what to analyze, how to fix/review).
See individual skill files for dispatch details.

## Completeness and Clarity Checklist

Before completing any task, review:

1. Check relevant checklists for the type of work completed.
   - **Proposals**: See the propose skill for the author checklist.
   - **Devlogs**: Ensure devlog contains sufficient context for work resumption.
   - **Documentation**: Final pass for NOTE(), TODO(), WARN() callouts.
2. Verify adherence to communication guidelines (BLUF, brevity, critical analysis).
3. Ensure no important context is lost (findings, decisions, complications).
4. Verify that all deviations and complications are surfaced front and center.

It is far worse to gloss over a problem and present it as a success than to acknowledge an issue.
