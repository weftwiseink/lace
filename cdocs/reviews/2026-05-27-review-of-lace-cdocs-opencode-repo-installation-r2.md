---
review_of: cdocs/proposals/2026-05-27-lace-cdocs-opencode-repo-installation.md
first_authored:
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:41:04.000Z
task_list: lace/cdocs-opencode-installation/review-r2
type: review
state: live
status: done
tags:
  - rereview_agent
  - opencode
  - cdocs
  - repo_installation
guid: pz4nO3ibZG1VB
---

# Review: Lace CDocs OpenCode Repo Installation Round 2

## Summary Assessment

The amended proposal narrows lace's work to consuming a verified published `@weftwise/cdocs-opencode` package before reconciling local `.opencode` artifacts.
That dependency-first shape is coherent, implementable, and better aligned with the paired upstream publication proposal than the earlier local-artifact-focused framing.
The current text accounts for the observed repo facts, explicitly avoids wrong-root `.opencode/.opencode` installation assumptions, and reads like the sibling OpenCode proposals.
**Verdict: Accept.**

## Prior Review Follow-Up

The prior review accepted the proposal with non-blocking implementation cautions.
The amended proposal preserves those controls and makes several of them more explicit: upstream package verification is now a Phase 0 gate, local `.opencode/skills/` and `.opencode/commands/` copies must be absent or ignored during runtime verification, `.opencode/package.json` is treated as unproven until the install contract is verified, and the nested `.opencode/.opencode/` failure mode is called out directly.
No prior blocking action items remain.

## Section-by-Section Findings

### Objective and Background

The objective is appropriately scoped to repo-local package consumption rather than copied `clauthier` output, `file:` dependencies, or global OpenCode config.
The background matches the current repository.
`opencode.json` declares `@weftwise/cdocs-opencode`.
`.opencode/package.json` only depends on `@opencode-ai/plugin`.
`.opencode/commands/` contains mechanical CDocs wrappers.
`.opencode/skills/` contains local CDocs skill copies.
`.devcontainer/devcontainer.json` mounts `github.com/weftwiseink/clauthier` as a development repo mount.
The proposal also correctly treats the observed `/cdocs` listings as suggestive but not conclusive because local artifacts can mask package failures.
**No blocking issues.**

### Dependency-First Install Path

The install path is coherent and implementable.
It waits for upstream publication of a reviewed version newer than the currently published `0.1.0`, then applies only the repo-local config or dependency mechanism documented by that package contract.
That sequencing prevents lace from inventing a downstream installation scheme before OpenCode plugin resolution, materialization, command visibility, agents, and hooks are empirically known.
**No blocking issues.**

### `opencode.json` and `.opencode/package.json`

The proposal correctly distinguishes the two files.
`opencode.json` is already the intended plugin declaration, while `.opencode/package.json` is acknowledged as an existing manifest whose role in OpenCode package resolution is not yet proven.
The proposal's instruction to update `.opencode/package.json` or its lockfile only if the verified contract requires it avoids unnecessary manifest churn.
**No blocking issues.**

### Local Commands, Skills, Rules, and Agents

The artifact reconciliation section correctly starts by testing with local copied CDocs skills and command wrappers absent or isolated.
It allows keeping only thin mechanical command wrappers if upstream intentionally leaves wrappers to consumers, and it avoids adding `iterate` or other wrappers unless the accepted package contract provides the corresponding skill.
It also covers package-owned rules and agents without assuming they already exist in lace, which matches the current repo where `.opencode/agents/` and `.opencode/rules/` are absent.
**No blocking issues.**

### Clauthier Repo Mount

The proposal correctly accounts for the `clauthier` repo mount as a source-development convenience, not a runtime dependency.
It explicitly rejects local `file:`, `npm link`, absolute-path, and copied-build-output approaches and requires runtime verification without relying on `~/code/weft/clauthier/main`.
That is the right boundary between the paired upstream publication work and this downstream lace installation work.
**No blocking issues.**

### Wrong-Root `.opencode/.opencode` Risk

The proposal directly addresses the wrong-root install hazard.
It notes that the current package postinstall uses `INIT_CWD || process.cwd()` and that running installation from the wrong directory can write nested `.opencode/.opencode/` artifacts.
The test plan includes a specific check that no nested `.opencode/.opencode/` directory was created, which is sufficient for implementation readiness.
**No blocking issues.**

### Style and Proposal Conventions

The style is readable and consistent with sibling proposals from this round: a BLUF, concrete repo facts, explicit design decisions, edge cases, test plan, verification methodology, phased implementation, and concise summary.
The scope is now simpler and more direct than the earlier version while still preserving enough operational detail for implementation.
**No blocking issues.**

## Verdict

**Accept.**
The proposal is implementation-ready once the paired upstream publication proposal produces a verified package contract.
It satisfies the review criteria: dependency-first installation is coherent, all relevant lace OpenCode artifacts are accounted for, the clauthier repo mount is not treated as a runtime dependency, wrong-root materialization is explicitly guarded against, and the document aligns with current `/propose` style.

## Action Items

1. **[blocking]** None.
2. **[non-blocking, implementation note]** During implementation, keep Phase 0 fail-closed: do not change lace if the published package remains stale or the package contract is ambiguous.
3. **[non-blocking, implementation note]** Record the clean-artifact runtime verification in the devlog so future reviewers can see that local `.opencode/skills/` and `.opencode/commands/` did not hide package failures.
