---
title: "CDocs Init Quality Assessment"
first_authored:
  by: claude-opus-4-5
  at: 2026-01-30
task_list: cdocs/reports
type: report
state: live
status: wip
tags: [quality, assessment, cdocs, plugin-architecture]
---

# CDocs Init Quality Assessment

> BLUF: The `/cdocs:init` skill produces a clean, useful directory scaffold and decent README files, but its approach of copying a simplified rules file into `.claude/rules/cdocs.md` is architecturally wrong given the current state of the Claude Code plugin system.
> The plugin already bundles authoritative rules in its own `rules/` directory that its agents read at runtime, so the copied file creates a divergent, simplified duplicate that will drift from the source of truth.
> The init skill is appropriate as a user-invocable command, but should be made auto-invocable on first use of any cdocs skill to reduce friction.

## Context / Background

The `/cdocs:init` skill scaffolds the following structure in a project:

```
cdocs/
  devlogs/README.md
  proposals/README.md
  reviews/README.md
  reports/README.md
  _media/
.claude/rules/cdocs.md
```

This report assesses the quality and idiomaticness of this output, with particular attention to three concerns:

1. Whether the generated README files are appropriate.
2. Whether writing rules into `.claude/rules/cdocs.md` is the right approach.
3. Whether `/cdocs:init` should remain a user-invoked skill or be reconsidered.

Research was conducted by reading all plugin source files (skills, agents, rules, hooks, plugin.json), the scaffolded output, the official Claude Code plugin reference documentation, and relevant GitHub issues about the plugin rules ecosystem.

## Key Findings

### Finding 1: The `.claude/rules/cdocs.md` Approach Is Problematic

The init skill generates a file at `.claude/rules/cdocs.md` containing a simplified summary of CDocs writing conventions, status values, naming conventions, and a frontmatter template.
This approach has three concrete problems:

**1a. It duplicates and diverges from the plugin's authoritative rules.**

The cdocs plugin ships three rule files in its own `rules/` directory:

- `rules/writing-conventions.md`: 84 lines covering BLUF, brevity, sentence-per-line, callouts, history-agnostic framing, commentary decoupling, critical analysis, punctuation, Mermaid diagrams, and emoji avoidance.
- `rules/frontmatter-spec.md`: 96 lines with the complete frontmatter field spec, valid values, and file naming conventions.
- `rules/workflow-patterns.md`: 115 lines covering parallel agents, subagent-driven development, pre-review nit-fix, end-of-turn triage, and completeness checklists.

The generated `.claude/rules/cdocs.md` is 45 lines and covers a small subset.
Critically, it defines different status values than the authoritative frontmatter spec:

| The generated file says | The actual spec says |
|---|---|
| Proposals: `request_for_proposal \| draft \| review \| accepted \| rejected \| superseded` | `request_for_proposal \| wip \| review_ready \| implementation_ready \| evolved \| implementation_accepted \| done` |
| Devlogs: `in_progress \| completed \| abandoned` | `wip \| review_ready \| done` |
| Reviews: `draft \| published` | `wip \| done` |
| Reports: `draft \| published` | `wip \| review_ready \| done` |

This divergence means the generated rules file will actively mislead Claude into using incorrect status values.
The frontmatter validation hook and triage agent operate against the authoritative spec, so documents authored following the generated rules will produce validation warnings.

**1b. The plugin's agents already read rules at runtime from the plugin directory.**

The reviewer agent reads `plugins/cdocs/rules/frontmatter-spec.md` and `plugins/cdocs/rules/writing-conventions.md` at startup.
The nit-fix agent globs `plugins/cdocs/rules/*.md` and reads all discovered rule files.
The triage agent reads `plugins/cdocs/rules/frontmatter-spec.md`.

These agents do not reference `.claude/rules/cdocs.md` at all.
The generated rules file only affects the top-level Claude agent (the one the user interacts with directly), creating a split where the main agent sees simplified/incorrect rules while the subagents see the authoritative ones.

**1c. The Claude Code plugin system does not yet support distributing rules.**

The official plugin.json schema supports: `commands`, `agents`, `skills`, `hooks`, `mcpServers`, `outputStyles`, and `lspServers`.
It does not support a `rules` field.
This is a known gap - GitHub issue #14200 (opened 2025-12-16, 19 upvotes, still open) requests exactly this feature.
Issue #21163 (opened 2026-01-27) was closed as a duplicate of #14200.

Until this feature ships, there is no first-class way for plugins to auto-load rules into a project's `.claude/rules/` directory.
The cdocs plugin's workaround of having `/cdocs:init` generate a rules file is understandable given this limitation, but the execution (a simplified, divergent copy) makes the workaround worse than doing nothing.

### Finding 2: The README Files Are Appropriate

The four generated README files match the templates defined in the init SKILL.md exactly.
They are concise, correctly reference the relevant skill commands, document the naming convention, and list key sections for each document type.

Minor observations:

- The proposals README uses an em-dash ("Full proposals -- BLUF, Objective...") which violates the plugin's own writing conventions rule about preferring colons over em-dashes.
  This is actually in the SKILL.md template itself, so the init skill is faithfully reproducing the template.
  The template should be fixed upstream.
- The README files do not have frontmatter, which is appropriate since they are not cdocs documents themselves.

### Finding 3: Init-as-User-Command Is the Right Pattern, but Should Also Auto-Scaffold

The `/cdocs:init` skill follows an established pattern seen across the development ecosystem: `npm init`, `eslint --init`, `git init`, `cargo init`, `poetry init`.
These are all one-time setup commands that create directory structures and configuration files.

However, the cdocs plugin has a usability gap: if a user invokes `/cdocs:devlog my-feature` before running `/cdocs:init`, the devlog skill's step 5 says "If `cdocs/devlogs/` doesn't exist, suggest running `/cdocs:init` first."
This creates an unnecessary round-trip.

A better pattern (used by tools like `cargo` and `rails`): keep init as a user-invocable command, but also have other skills auto-scaffold the minimum required directory structure on first use.
The report SKILL.md already contains: "If `cdocs/reports/` doesn't exist, suggest running `/cdocs:init` first" - this should be changed to "If `cdocs/reports/` doesn't exist, create it (and its parent `cdocs/` if needed)."

The `--minimal` flag is a good design choice for users who want the directory structure without the README files.

### Finding 4: The Init Skill Has No Idempotency Guardrails

The SKILL.md notes section says "Do not overwrite existing files" and "Check for existing content before writing READMEs to avoid clobbering user modifications."
These are instructions to Claude, not enforced guardrails.
Since Claude is stateless between sessions, it depends entirely on Claude reading and following these instructions each time.

The hook system could enforce this: a PreToolUse hook on Write could check whether the target file already exists and block overwrites of README files in cdocs directories.
This would be more reliable than prompt instructions alone.

## Analysis

### The Rules Duplication Problem Is the Most Urgent Issue

The status value divergence is not a minor cosmetic issue - it will cause concrete problems.
Documents authored with `status: draft` or `status: in_progress` will fail the triage agent's status validation.
The frontmatter validation hook checks for `status:` presence but not value validity, so the error surfaces late (during triage, not during authoring).

The cleanest fix, given the current plugin system limitations, is one of:

1. **Delete the rules file generation entirely from init.**
   The plugin's agents already read the authoritative rules.
   The main Claude agent receives the SKILL.md content when skills are invoked, which contains the relevant conventions.
   The `rules/` directory in the plugin root is present but not auto-loaded by Claude Code - this is the platform gap.

2. **Generate a stub that references the plugin rules instead of duplicating them.**
   For example, `.claude/rules/cdocs.md` could contain:
   ```
   # CDocs Conventions

   This project uses the CDocs plugin for structured documentation.
   When working with files in `cdocs/`, follow the conventions defined
   in the cdocs plugin's rule files (loaded by cdocs agents at runtime).

   See `/cdocs:report`, `/cdocs:propose`, `/cdocs:devlog`, `/cdocs:review`
   for authoring guidelines.
   ```
   This avoids duplication while still making the main agent aware that cdocs conventions exist.

3. **Generate an exact copy of the authoritative rules, not a simplified version.**
   This is the worst option because it still drifts over time, but at least starts correct.

### Init Should Remain a Skill, Not Become Automatic-Only

Making init purely automatic (triggered by first use of any cdocs skill) would remove user control over when scaffolding happens.
Some users may want to inspect or customize the scaffold before committing.
The right approach is: keep it as a user-invocable skill AND add auto-scaffolding of the bare directory structure (without READMEs or rules) to other skills as a fallback.

## Recommendations

1. **Remove or replace the `.claude/rules/cdocs.md` generation.**
   Either delete it entirely (option 1 above) or replace it with a thin reference stub (option 2).
   Do not ship a simplified copy that diverges from the authoritative spec.
   This is the highest-priority fix.

2. **Fix the status values in the SKILL.md template itself.**
   The init SKILL.md's "Status Values" section in the generated cdocs.md template uses non-canonical status values (`draft`, `in_progress`, `published`, `completed`, `abandoned`).
   These should either match the frontmatter-spec.md or be removed.

3. **Add auto-scaffolding to other skills as a fallback.**
   Each cdocs skill that creates files (devlog, propose, report, review) should create the necessary directory with `mkdir -p` if it does not exist, rather than suggesting the user run `/cdocs:init` manually.
   This reduces friction for new users while preserving init as the deliberate setup command.

4. **Fix the em-dash in the proposals README template.**
   The proposals README template in init SKILL.md uses em-dashes, violating the plugin's own `writing-conventions.md` rule.
   Replace with colons.

5. **Track the upstream platform issue.**
   GitHub issue #14200 requests first-class `rules` support in plugin.json.
   When that ships, the cdocs plugin should add `"rules": "./rules"` to its plugin.json and remove any workarounds.
   This would make the plugin's three rule files load automatically alongside user/project rules, which is the architecturally correct solution.

6. **Consider a PreToolUse hook for idempotency.**
   Rather than relying on prompt instructions to avoid overwriting existing files during init, a hook could enforce this deterministically.
