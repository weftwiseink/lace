---
review_of: cdocs/proposals/2026-05-27-lace-cdocs-opencode-repo-installation.md
first_authored:
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:13:24.000Z
task_list: lace/cdocs-opencode-installation/review
type: review
state: live
status: done
tags:
  - fresh_agent
  - opencode
  - cdocs
  - repo_installation
guid: pkGUxWCLkPGbo
---

# Review: Lace CDocs OpenCode Repo Installation

## Summary Assessment

The proposal defines how lace should consume CDocs OpenCode support through a repo-local installation backed by the published `@weftwise/cdocs-opencode` package.
It is careful about the observed current state: `opencode.json` already names the plugin, `.opencode/package.json` does not depend on it, local skills and commands already exist, and the devcontainer mounts clauthier for source access.
The most important strength is that the proposal treats upstream publication and installation semantics as a dependency gate instead of papering over gaps with local source paths, copied build output, global config, `file:`, or `npm link`.
**Verdict: Accept.**

## Section-by-Section Findings

### Objective and Background

The objective is correctly scoped to a reproducible repo-local OpenCode installation for lace.
The background matches observed repo state: `opencode.json` references `@weftwise/cdocs-opencode`, `.opencode/package.json` only depends on `@opencode-ai/plugin`, `.opencode/skills/` and `.opencode/commands/` contain the listed CDocs workflows, and `.devcontainer/devcontainer.json` repo-mounts `github.com/weftwiseink/clauthier`.
**Non-blocking:** The proposal mentions `@weftwise/cdocs-opencode@0.1.0` as stale without verifying npm during the review.
That is acceptable because the proposal explicitly makes publication verification a Phase 0 gate.
The implementation devlog should record the exact `npm view` and `npm pack --dry-run` results before changing lace.

### Proposed Solution

The two-layer contract is sound: `opencode.json` declares the plugin package, while package-owned materialization covers any project files the OpenCode harness only discovers from `.opencode/`.
This aligns with the observed session behavior that local `.opencode/skills/` are loaded, without incorrectly preserving hand-copied local artifacts as source of truth.
**Non-blocking:** The final state intentionally allows either committed materialized artifacts or direct package discovery.
That flexibility is appropriate at proposal time because upstream owns the package contract.
Implementation should not leave both paths half-active without documenting which one OpenCode actually uses.

### Upstream Dependency Gate

This section is the key correctness control.
It blocks lace work until a reviewed published package newer than `0.1.0` exists and includes or materializes the expected skills, rules, agents, commands, and hook plugin.
It also correctly says not to work around upstream incompleteness with the local clauthier checkout.
**No blocking issues.**

### Repo-Local Install Path

The proposal explicitly avoids the common path bug: assuming that installing from `.opencode/` writes to the lace repo's `.opencode/` path.
It calls out the current postinstall behavior using `INIT_CWD || process.cwd()` and identifies the nested `.opencode/.opencode/` failure mode.
This is precise enough for implementation and directly satisfies the review constraint.
**Non-blocking:** If upstream documents more than one supported install command, the implementation should choose one canonical repo-local command and record why that command preserves the correct project root.

### Artifact Reconciliation

The reconciliation approach correctly treats package-owned content as source of truth while preserving room for deliberately thin lace-local command wrappers.
It also identifies drift risks: existing local copies can hide missing package artifacts, command wrappers can point at renamed skills, and `iterate` should only be added if the accepted package actually provides it.
**No blocking issues.**

### Runtime Verification and Test Plan

The test plan is strong for this type of proposal.
It verifies upstream package contents, repo state, artifact alignment, absence of nested `.opencode/.opencode/`, absence of staged `.opencode/node_modules/`, and runtime behavior from the lace repo root without global OpenCode config or a clauthier sibling checkout.
The disposable-worktree or temporary-rename check is especially important because existing local `.opencode/skills/` and `.opencode/commands/` can create false confidence.
**Non-blocking:** The test plan should be treated as the minimum acceptance floor during implementation, not as optional validation, because the current repo already contains local artifacts that can mask dependency-resolution failures.

### Important Design Decisions and Edge Cases

The design decisions are internally consistent: lace is a package consumer, installation remains repo-local, development mounts are not runtime dependencies, package manager behavior must be proven, and Claude Code artifacts remain out of scope.
The edge cases cover the main operational risks, including stale publication, wrong-directory postinstall, OpenCode discovery ordering, local-copy masking, command drift, tracked-versus-regenerated materialization, and possible redundancy of `@opencode-ai/plugin`.
**No blocking issues.**

### Implementation Phases

The phased plan is appropriately conservative.
Phase 0 prevents downstream changes before upstream publication exists.
Phase 1 records drift.
Phase 2 applies only the documented contract.
Phase 3 reconciles artifacts.
Phase 4 verifies harness behavior.
Phase 5 adds minimal usage docs only if needed.
**Non-blocking:** Phase 2 should explicitly fail closed if upstream's documentation is ambiguous about whether `.opencode/package.json` participates in plugin resolution.
The proposal already implies this.
Making it an implementation rule in the devlog will prevent accidental lockfile churn.

## Verdict

**Accept.**
The proposal is correct against the observed lace repo state and avoids the dangerous shortcuts called out in the review prompt.
It is implementable after the upstream package publication proposal lands and gives the top-level agent enough guardrails to avoid local clauthier source, copied build output, global OpenCode config, `file:`, `npm link`, and wrong-root `.opencode` materialization.
All findings are non-blocking implementation cautions.

## Action Items

1. **[non-blocking, implementation note]** In the implementation devlog, record the exact `npm view @weftwise/cdocs-opencode version --json` and `npm pack @weftwise/cdocs-opencode@<version> --dry-run` results before changing lace.
2. **[non-blocking, implementation note]** Choose one canonical repo-local install or materialization command from upstream documentation, and record why it preserves the lace repo root rather than writing to `.opencode/.opencode/`.
3. **[non-blocking, implementation note]** Treat the disposable-worktree or temporary-artifact-removal runtime check as required verification, because existing `.opencode/skills/` and `.opencode/commands/` can hide package failures.
4. **[non-blocking, implementation note]** Do not commit `.opencode/package.json` or lockfile changes unless runtime verification proves that path participates in OpenCode plugin resolution.
