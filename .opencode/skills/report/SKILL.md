---
name: report
description: Generate a structured report (status, analysis, incident, audit, or retrospective)
argument-hint: "[topic]"
---

# CDocs Report

**Usage:** Typically user-invoked when findings need to be documented. Claude may also suggest a report after completing research, analysis, or investigation work.

Research and produce a structured report on a given topic.
Topics may be:
- Library and architecture research in preparation for writing a proposal.
- Analysis and synthesis of patterns in the codebase.
- Assessment of the current status of a specific line of work.
- The result of some analysis or investigation such as performance testing, profiling, or a spike/prototype.
- Any other ad-hoc work that fits the broad exploration/synthesis model.

Reports might optionally result in some suggestions, but they are usually less conclusive than a decision proposal and should be framed as reference recommendations for deeper consideration of all options (ie, maybe the report is part of a series done on each option).

Reports are audience-facing documents that summarize findings, status, or analysis.
They differ from devlogs: reports answer "what did we learn/accomplish?" while devlogs answer "how did we do the work?"

Some reports are ad-hoc topic notes or supplemental materials - it is the most flexible cdoc type.

## Invocation

1. If `$ARGUMENTS` provides a topic, use it. Otherwise, prompt the user.
2. Determine the report subtype (see below). If ambiguous, ask the user.
3. Determine today's date.
4. Create `cdocs/reports/YYYY-MM-DD-topic.md` using the template below.
5. If `cdocs/reports/` doesn't exist, suggest running `/cdocs:init` first.

## Template

Use the template in `template.md` alongside this skill file.
Fill in:
- `first_authored.by` with the current model name or `@username`.
- `first_authored.at` with the current timestamp including timezone.
- `task_list` with the relevant workstream path.
- `type: report`, `state: live`, `status: wip`.
- Tags relevant to the report, including the subtype (e.g., `status`, `investigation`, `incident`).

## Core Sections

All reports should include a BLUF and key findings.
Most reports should include the other core sections as well, but use your judgement.
Most reports should also include custom sections specific to the topic.

- **> BLUF:** 2-4 sentences: what, why, key finding, main recommendation.
- **Context / Background:** What prompted this report, relevant history.
- **Key Findings:** Bulleted discoveries, data, observations.
- As many detailed sections as applicable for the topic
- **Recommendations:** if any

Remember: reports are rather freeform by default and should be tailored to the task at hand.

## Reports vs. Devlogs

| Aspect | Report | Devlog |
|--------|--------|--------|
| Audience | Stakeholders, cross-team, future self | Implementers, handoff agents |
| Polish | Edited, conclusions-focused | Stream-of-consciousness during work |
| Focus | What was learned/accomplished | How the work was done |
| Format | Skimmable (BLUF, bullets) | Chronological narrative |
| Lifecycle | Archived as reference | Living document during task |
