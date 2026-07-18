---
review_of: cdocs/proposals/2026-05-27-cdocs-opencode-plugin-publication.md
first_authored:
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:13:27.000Z
task_list: cdocs/opencode-plugin-publication/review
type: review
state: live
status: done
tags:
  - fresh_agent
  - opencode
  - cdocs
  - publication
guid: pZROOgOzCuwUi
---

# Review: CDocs OpenCode Plugin Publication

## Summary Assessment

This proposal defines the upstream `clauthier` work needed to make `@weftwise/cdocs-opencode` a complete, published OpenCode package before lace consumes it as a normal dependency.
The proposal is accurate against the observed repo and npm state: current `clauthier` source has 11 skills and 4 agents, the published package is still `0.1.0` with 10 skills and 3 agents, and lace currently relies on local `.opencode/skills/` and `.opencode/commands/` copies.
The main risks are correctly identified and assigned upstream: materialization/discovery, command delivery, agent delivery, stale package versioning, and empirical OpenCode verification.
**Verdict: Accept.**

## Section-by-Section Findings

### Objective and Background

The objective is crisp: publish CDocs OpenCode support from `clauthier` as the source of truth and remove lace's need for ad-hoc copied artifacts.
The background claims match observed state: `clauthier/package.json` is private, `scripts/build-opencode.ts` emits `build/cdocs/opencode/`, the source manifest is still `0.1.0`, npm reports `@weftwise/cdocs-opencode` as `0.1.0`, and the published tarball lacks `skills/iterate/` and `agents/judge.md`.

**Non-blocking:** The proposal mentions the OpenCode hook entrypoint and validates the hook through downstream frontmatter-warning checks, but the static package checks only say to verify `main` points at the hook.
Because the generated package currently publishes a TypeScript `plugins/cdocs-hooks.ts` entrypoint, implementation should explicitly prove OpenCode can load that entrypoint from the installed package, not just that the path exists.

### Proposed Solution

The five package surfaces are the correct contract boundary: hook plugin, skills, rules, agents, and command wrappers.
The proposal also correctly keeps `plugins/cdocs/skills/`, `plugins/cdocs/rules/`, and `plugins/cdocs/agents/` canonical in the source repo while treating `scripts/build-opencode.ts` as the OpenCode generation boundary.

**Non-blocking:** Command generation is described at the right level for a proposal, but implementation should record the exact command naming table in the devlog or generated-package documentation.
This matters because `/init` is already called out as a collision risk and because lace currently has `.opencode/commands/init.md` and `.opencode/commands/nit_fix.md` local copies that could hide package command naming defects.

### Artifact Materialization

This is the strongest part of the proposal.
It does not assume npm tarball contents imply OpenCode visibility, it requires empirical testing of OpenCode's npm plugin installer, and it defines a safe fallback if postinstall cannot identify the consuming project root.
The ownership-marker and no-overwrite requirements are also necessary before downstream repos remove local copies.

**Non-blocking:** If runtime materialization is chosen, the implementation should verify both the first-run behavior and the subsequent-run refresh behavior.
A runtime materializer that writes files only after OpenCode has already scanned project skills may require a restart.
The proposal notes this, but the implementation should record whether the first run emits a clear user-facing notice.

### Publication Workflow

The workflow requirements are sound.
They keep PR validation non-publishing, publish only from `build/cdocs/opencode/`, require pack-list assertions, and require verification of npm metadata after publication.
This directly addresses the stale `0.1.0` state observed in npm.

**Non-blocking:** The package-content assertions should fail on both missing expected files and unexpected stale version reuse.
In practice, that means asserting `package.json.version` is greater than `0.1.0` for the next release and asserting the pack list includes `skills/iterate/`, `agents/judge.md`, generated commands, rules, scripts, and the hook plugin.

### Documentation

The documentation section correctly separates published package consumption from source-repo development and requires known OpenCode parity gaps to be documented.
This is important because the hook source states that OpenCode cannot currently reproduce Claude Code's agent-scoped path restriction model.

**Non-blocking:** The README update should include the exact supported installation path and expected materialization location.
The downstream lace proposal correctly warns that installing from the wrong working directory can create nested `.opencode/.opencode/` output with the current `INIT_CWD || process.cwd()` strategy.
The upstream README should make that impossible to miss if postinstall remains part of the contract.

### Upstream / Downstream Separation

The proposal clearly keeps upstream package contract work in `clauthier` and downstream consumption work in lace.
It explicitly says lace should wait for the package contract, should not patch `clauthier` internals, and should not require a local `~/code/weft/clauthier/main` checkout for routine OpenCode CDocs use.

**Adequate.** This separation is consistent with the paired lace installation proposal, which blocks on upstream publication and avoids `file:`, `npm link`, absolute path dependencies, or copied build output.

### Edge Cases and Test Plan

The edge cases cover the actual high-risk failure modes: OpenCode plugin cache installation, materialization after discovery, generated-file collisions, stale publication, unproven agent delivery, and skill naming differences.
The test plan is appropriately empirical and includes static package checks, build-script checks, scratch consumer checks, downstream lace checks, and post-publication verification.

**Non-blocking:** Add one explicit verification step that starts OpenCode from a scratch project with no local `.opencode/skills/` or `.opencode/commands/` present before install.
That guards against the same false confidence currently possible in lace, where local hand-copied artifacts make CDocs appear available even if the package contract is incomplete.

## Verdict

**Accept.**
The proposal is implementable and correctly scopes the work upstream.
It accurately describes the stale published package, the current source/package delta, lace's partial local setup, and the unresolved OpenCode materialization contract.
The remaining concerns are implementation-time verification details rather than proposal blockers.

## Action Items

1. **[non-blocking]** During implementation, explicitly verify OpenCode can load the package hook entrypoint from the installed npm package, not only that `package.json.main` points at `plugins/cdocs-hooks.ts`.
2. **[non-blocking]** Record the final command naming table, including `/cdocs-init` versus `/init` and any `nit_fix` versus `nit-fix` compatibility decision.
3. **[non-blocking]** If runtime materialization is chosen, verify and document whether the first run requires an OpenCode restart and whether users receive a clear notice.
4. **[non-blocking]** Make release assertions fail if the next package version is not greater than `0.1.0` or if the pack list omits `skills/iterate/`, `agents/judge.md`, generated commands, rules, scripts, or the hook plugin.
5. **[non-blocking]** Add a scratch-project verification case with no pre-existing local `.opencode/skills/` or `.opencode/commands/` so copied local artifacts cannot mask package delivery failures.
