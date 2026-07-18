---
review_of: cdocs/proposals/2026-05-27-cdocs-opencode-plugin-publication.md
first_authored:
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:41:03.000Z
task_list: cdocs/opencode-plugin-publication/review-r2
type: review
state: live
status: done
tags:
  - rereview_agent
  - opencode
  - cdocs
  - publication
guid: pBQ9SAqG5qTR_
---

# Review: CDocs OpenCode Plugin Publication Round 2

## Summary Assessment

This round reviews the amended proposal after it narrowed scope to publish and verify the existing OpenCode package before adding more delivery machinery.
The simplified proposal is coherent, implementable, and better aligned with the current uncertainty in OpenCode package discovery than the broader first-round shape.
It preserves the important false-positive guard: verification must run in clean consumers and disposable lace contexts without local `.opencode/skills/` or `.opencode/commands/` copies hiding package failures.
**Verdict: Accept.**

## Prior Review Follow-Up

The prior review accepted the proposal with non-blocking implementation cautions around hook loading, command naming, runtime materialization restart behavior, release assertions, and scratch-project verification.
The amended proposal addresses those concerns at the proposal level by making command generation, agent materialization, runtime materialization, ownership markers, and release automation conditional on observed failures rather than presumed requirements.
It also explicitly requires clean scratch verification, registry-package verification, pack-list assertions for `skills/iterate/` and `agents/judge.md`, and hook behavior verification from the published package.

## Section-by-Section Findings

### Objective and Background

The objective is appropriately narrow: publish a current `@weftwise/cdocs-opencode` package from `~/code/weft/clauthier/main` and verify the real consumer contract before lace depends on it.
The repository facts match the document: `clauthier/package.json` is private, `plugins/cdocs/.claude-plugin/plugin.json` still reports `0.1.0`, `npm view @weftwise/cdocs-opencode version --json` returns `"0.1.0"`, lace declares the package in `opencode.json`, and lace has local `.opencode/skills/` and `.opencode/commands/` copies.
The build-script description is also accurate: `scripts/build-opencode.ts` generates `build/cdocs/opencode/`, syncs version from the plugin manifest, copies skills/rules, converts agents, copies `plugins/cdocs-hooks.ts`, copies `postinstall.js`, and does not generate commands.

**Adequate.** No blocking or non-blocking changes are required.

### Proposed Solution

The publish-and-verify-first path is coherent because it treats OpenCode discovery as an empirical runtime contract instead of inferring behavior from tarball layout or existing lace-local artifacts.
The six verification questions cover the high-risk surfaces: package loading, skill visibility, `/cdocs` command listings, agent visibility, hook execution, and postinstall project-root safety.
This is enough to decide whether the current package shape works or whether targeted follow-up code is needed.

**Adequate.** No blocking or non-blocking changes are required.

### Conditional Follow-Up Work

The conditionality is correctly stated.
Command generation is only required if commands are not visible without lace-local wrappers.
Agent materialization is only required if package-internal agents are not discoverable and project-level agent files are required.
Runtime materialization is only required if postinstall cannot safely materialize required files.
Ownership markers and refresh semantics are only required if package-owned project files must be written and updated over time.

This framing avoids premature build-system and lifecycle complexity while still leaving clear fallback paths if verification fails.

**Adequate.** No blocking or non-blocking changes are required.

### False-Positive Protection

The proposal preserves enough protection against false positives from local `.opencode` files.
It requires a scratch project with no local `clauthier` checkout, a post-publication registry-package verification pass, and a disposable lace worktree where local CDocs `.opencode` copies are absent or ignored.
It also explicitly states that repository structure and tarball contents are useful evidence but not sufficient by themselves.

**Adequate.** No blocking or non-blocking changes are required.

### Test Plan and Verification Methodology

The test plan is implementable and appropriately staged.
Static checks assert package identity, version, `main`, and pack contents, including the currently missing source deltas `skills/iterate/` and `agents/judge.md`.
Consumer checks then prove OpenCode behavior from clean projects rather than from the source checkout or lace's copied files.
Downstream checks defer lace cleanup until upstream behavior is known, which is the right separation of concerns.

**Adequate.** No blocking or non-blocking changes are required.

### Style and Proposal Conventions

The document follows the `/propose` conventions for a fully fledged implementation proposal: BLUF, objective, background, proposed solution, design decisions, edge cases, test plan, verification methodology, implementation phases, and summary are all present.
The style is readable and consistent with the sibling lace installation proposal: it is direct, history-agnostic in the main body, and uses one sentence or thought per source line.
The amendment's simpler scope improves readability by reducing speculative implementation detail while preserving the decisions an implementer needs.

**Adequate.** No blocking or non-blocking changes are required.

## Verdict

**Accept.**
The simplified proposal is implementation-ready.
It identifies the stale publication problem, defines a minimal publish-and-verify path, guards against local `.opencode` false positives, and correctly keeps command generation, materialization, ownership markers, and release automation conditional on verified need.

## Action Items

1. **[blocking]** None.
2. **[non-blocking]** During implementation, record the clean-consumer verification results and the exact package version in the implementation devlog or upstream README.
