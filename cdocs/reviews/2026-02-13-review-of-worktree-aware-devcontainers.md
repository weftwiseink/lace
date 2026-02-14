---
review_of: cdocs/reports/2026-02-13-worktree-aware-devcontainers.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T16:30:00-08:00
task_list: lace/worktree-support
type: review
state: live
status: done
tags: [fresh_agent, architecture, completeness, technical_accuracy, worktrees]
---

# Review: Worktree-Aware Devcontainers

## Summary Assessment

This report maps the landscape of bare-repo worktree support for devcontainers and proposes a four-tier roadmap for lace adoption, from documentation through full multi-worktree orchestration.
The analysis is thorough, well-structured, and technically grounded: the tiered breakdown is the right framing, the ecosystem survey is broad, and the recommended sweet spot (Tier 2) is well-justified.
The most significant gap is an underexplored tension between lace's parent-mount approach and the devcontainers CLI's `--mount-git-worktree-common-dir` approach, and a missing discussion of what happens when `lace up` is invoked from a worktree directory versus the bare-repo root.
Verdict: **Accept** with non-blocking suggestions.

## Section-by-Section Findings

### BLUF

The BLUF is strong: it states the problem, the current position, the recommended tier, and the rationale.
One minor note: it uses "enhancing rather than replacing the devcontainer spec" which is a good framing but slightly mischaracterizes the proposal, since `customizations.lace.worktree` is a lace-specific extension, not a spec enhancement. **Non-blocking.**

### Context / Background

**The bare-repo worktree pattern (lines 20-29)**

The directory layout is correctly described.
The claim about ecosystem adoption (Cursor, Cline, Dagger, BranchBox, Claude Code) is consistent with the prior reports in this repository. **Accurate.**

**The devcontainer gap (lines 33-37)**

The `.git` file resolution failure is correctly described.
The claim "Every `git` command fails with `fatal: not a git repository`" is accurate for the case where the `.git` file has an absolute path pointing to a host-only location, or where the parent directory is not mounted. **Accurate.**

**What lace does today (lines 49-57)**

The 5-step `lace up` pipeline description is accurate per the source code at `/var/home/mjr/code/weft/lace/packages/lace/src/lib/up.ts`.
The claim that `workspaceMount` and `workspaceFolder` pass through unchanged is correct: the template resolver walks all string values but only resolves `${lace.port()}` patterns (via `LACE_PORT_PATTERN` at line 33 of `template-resolver.ts`), and the `generateExtendedConfig` function does not modify mount-related fields. **Verified against source.**

### Key Findings

**Ecosystem state (lines 61-73)**

The devcontainers/cli v0.81.0 `--mount-git-worktree-common-dir` claim references PR #1127.
I cannot verify the specific version number (v0.81.0, January 2026) against the actual release, but the PR reference is provided for traceability.
The claim that it requires relative paths is consistent with the Git 2.48 relative-worktree-paths feature description. **Plausible, with citation.**

The claim "No spec proposal exists for worktree support" is stated as of the writing date.
The distinction between CLI implementation and spec is important and correctly drawn.

**What breaks without worktree awareness (lines 77-86)**

The failure mode table is well-constructed.
The `git gc --prune=now` entry correctly identifies the risk: aggressive pruning can delete objects referenced by other worktrees' detached HEADs or pending work.
The `git stash` entry is accurate and aligns with the prior report's finding about global stash.

One omission: the table does not mention what happens when `lace up` is invoked from within a worktree directory.
Currently, `lace up` reads `.devcontainer/devcontainer.json` relative to `workspaceFolder` (defaulting to `process.cwd()`).
If a user runs `lace up` from `my-project/feature-auth/`, lace looks for `my-project/feature-auth/.devcontainer/devcontainer.json`.
In most bare-repo worktree setups, `.devcontainer/` lives in the worktree (checked out from the branch), so this works.
But if the user has a shared `.devcontainer/` in the bare-repo root (not checked out), lace would fail to find it.
This scenario should at least be mentioned in the "what breaks" table or in the Tier 1 validation checks. **Non-blocking** but worth adding.

### Lace's structural advantages (lines 89-93)

Both claims are accurate:
1. Port allocation is verified: `PortAllocator` in the source manages persistent assignments.
2. The `.lace/devcontainer.json` generation pipeline is confirmed as the correct injection point.

### Tier Analysis (lines 96-251)

**Tier 0 (Documentation)**

Correctly characterized as necessary but insufficient. No issues.

**Tier 1 (Workspace validation)**

The detection table (lines 113-119) is practical and well-scoped.
The `.git` file check (is it a file vs directory) is the right entry point.
The `safe.directory` suggestion is appropriate.

One consideration not mentioned: the validation should also check whether the `workspaceFolder` path matches the expected worktree subdirectory within the mount target.
For example, if `workspaceMount` targets `/workspace` and the current worktree directory is `main/`, then `workspaceFolder` should be `/workspace/main`.
A mismatch here is a common configuration error. **Non-blocking.**

**Tier 2 (Template expressions + auto-configuration)**

This is the meat of the proposal.
The `${lace.workspaceMount()}` and `${lace.workspaceFolder()}` template expressions are a natural extension of the existing `${lace.port()}` pattern.
The alternative `customizations.lace.worktree` block is the better design: it is declarative and does not conflate mount configuration with template resolution.

Technical concern: the report proposes auto-injecting `safe.directory` into `postCreateCommand`.
The current `generateExtendedConfig` already has logic for appending to `postCreateCommand` (for symlink commands from repo mounts, lines 471-489 of `up.ts`).
This is architecturally consistent, but the report does not mention the existing `postCreateCommand` merging logic or the potential for conflict if the user already has a `postCreateCommand`.
The implementation will need to handle string, array, and object formats, which the existing code already does.
This is more of an implementation detail than a report gap, but noting the prior art would strengthen the "moderate-to-high effort" assessment. **Non-blocking.**

The report mentions two approaches (lace template expressions vs. `customizations.lace.worktree` block) but does not clearly recommend one over the other.
The BLUF references "template expressions" but the Recommendations section (line 356) uses the `customizations.lace.worktree` approach.
It would be cleaner to explicitly note that the `customizations.lace.worktree` block is the recommended path and that the template expressions (`${lace.workspaceMount()}`) are an alternative that was considered but not preferred. **Non-blocking.**

**Tier 3 (Worktrunk)**

Well-scoped as future work.
The `lace worktrunk` CLI sketch is illustrative and correctly identifies the key capabilities.
The trade-offs are honest, particularly around disk usage and `.devcontainer/devcontainer.json` ownership.

One underexplored question: port allocation scope.
Currently, `PortAllocator` uses a `.lace/port-assignments.json` file relative to the workspace folder.
If each worktree is a separate workspace folder, each gets its own `.lace/port-assignments.json`.
The report claims port isolation is "already solved by `${lace.port()}`" (line 327), but in the multi-worktree scenario, each worktree would need to draw from the same port range without collisions.
The current `PortAllocator` uses a range-based allocation (22425-22499) and hashes the workspace path to derive a starting port, but if two worktrees in the same bare repo get different hashes, they could still collide within the range.
This deserves a note in the Tier 3 trade-offs. **Non-blocking.**

### Tier comparison matrix (lines 242-251)

Clean and accurate summary of the tiers.
The "Spec alignment" row correctly notes that Tiers 2 and 3 are lace-specific extensions.

### Ecosystem Landscape (lines 253-278)

The comparison table is useful.
The "What lace uniquely brings" list is accurate: OCI feature metadata, persistent port allocation, prebuild caching, WezTerm integration, and repo mounts are all verified in the source code.

I cannot independently verify the claims about BranchBox, DevTree, and Sprout's feature sets, but the references are provided. **Non-blocking**, assuming good faith on cited tool capabilities.

### The `.git` File Problem: Deeper Analysis (lines 280-315)

The two-hop path resolution chain (worktree/.git -> .bare/worktrees/main -> .bare/) is correctly described.
The explanation of why mounting `..` at `/workspace` resolves the chain is accurate.

The absolute vs. relative path landscape table (lines 302-306) has a subtle inaccuracy: Git 2.48's default is still absolute for `git worktree add` unless `--relative-paths` is passed or `worktree.useRelativePaths` is configured.
The report correctly states this ("Absolute (unless configured)") in the second row, but the body text at line 295 says "Git 2.48+ default" which could be misread as implying Git 2.48 changed the default to relative.
It did not: 2.48 added the `--relative-paths` flag and config option, but the default remained absolute. **Non-blocking**, but the phrasing at line 295 should be tightened.

### Risk Assessment (lines 318-337)

Comprehensive and well-categorized.
The "lace could mitigate" vs. "lace cannot mitigate" split is the right framing.
The `gc.pruneExpire=never` suggestion is a good defensive measure.
The submodule limitation callout is important and often overlooked.

### Recommendations (lines 339-387)

The phased approach (Tier 1 immediate, Tier 2 near-term, Tier 3 future) is sensible.
The explicit "not recommended" sections for the git-wrapper and devcontainer-feature approaches are well-reasoned.

The devcontainer-feature rejection (lines 385-387) makes a correct architectural point: features run during image build and cannot modify mount configuration.
This is a strong argument.

### Appendix: Reference Configuration (lines 389-443)

The current lace devcontainer config shown (lines 393-406) matches the actual `.devcontainer/devcontainer.json` at `/var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json` in structure and intent, though the real config is more complex (it has build, runArgs, mounts, features, etc.).
The appendix correctly extracts the worktree-relevant subset for illustration.

The "proposed Tier 2 equivalent" (lines 410-425) has a JSONC syntax issue: the comment `// workspaceMount and workspaceFolder auto-generated by lace` after the `customizations` block is missing a comma after the closing brace of `customizations`.
This is a display-only issue (the config is illustrative, not executable), but it could confuse readers. **Non-blocking.**

### Frontmatter

The frontmatter is well-formed per the cdocs spec.
`type: report`, `state: live`, `status: wip` are appropriate.
Tags are descriptive and relevant.
The `task_list: lace/worktree-support` establishes a new workstream, which is appropriate for this scope.
No `last_reviewed` field, which is correct for a document that has not yet been reviewed.

### Writing Conventions

The report follows BLUF, uses sentence-per-line in most places, avoids emojis, and uses colons appropriately.
Two em-dashes appear (lines 14, 69), which the writing conventions say should be used sparingly.
The usage here is acceptable.
No other convention violations noted.

## Verdict

**Accept.**
This is a high-quality analysis report that correctly characterizes the problem space, evaluates lace's position within it, and proposes a well-tiered roadmap.
The technical claims about lace internals are verified against the source code.
The recommendations are appropriately scoped and the phasing is pragmatic.
The non-blocking findings below would strengthen the report but do not prevent acceptance.

## Action Items

1. [non-blocking] Add a row to the "what breaks" table (lines 77-86) for the case where `lace up` is invoked from a worktree that lacks its own `.devcontainer/` directory (shared config in bare-repo root).
2. [non-blocking] In the Tier 2 section, explicitly state that the `customizations.lace.worktree` block is the recommended approach over the `${lace.workspaceMount()}` template expressions, to resolve the ambiguity between the two alternatives presented.
3. [non-blocking] In the Tier 2 section, note the existing `postCreateCommand` merging logic in `generateExtendedConfig` (up.ts lines 471-489) as prior art that reduces the implementation effort for `safe.directory` auto-injection.
4. [non-blocking] In the Tier 3 trade-offs, add a note about `PortAllocator` scope: each worktree as a separate workspace folder gets its own `.lace/port-assignments.json`, which could lead to collisions if two worktrees independently allocate from the same range. A shared allocation file at the bare-repo root level may be needed.
5. [non-blocking] Tighten the phrasing at line 295 ("Git 2.48+ default") to make clear that Git 2.48 added the `--relative-paths` option but did not change the default behavior.
6. [non-blocking] Fix the missing comma in the Tier 2 illustrative JSON (line 421, after the `customizations` closing brace).
7. [non-blocking] Add a Tier 1 validation check for `workspaceFolder` path consistency: if `workspaceMount` targets a directory and a worktree is detected, verify that `workspaceFolder` points to the correct worktree subdirectory within the mount target.
