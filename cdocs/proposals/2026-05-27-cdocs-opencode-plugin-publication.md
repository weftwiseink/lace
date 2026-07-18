---
first_authored:
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:07:19.000Z
task_list: cdocs/opencode-plugin-publication
type: proposal
state: live
status: implementation_ready
last_reviewed:
  status: accepted
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:41:03.000Z
  round: 2
tags:
  - cdocs
  - opencode
  - clauthier
  - npm
  - publication
guid: psD2udm3E79MM
---

# CDocs OpenCode Plugin Publication

> BLUF: Publish and verify the current `@weftwise/cdocs-opencode` package before adding more OpenCode delivery machinery.
> npm currently exposes `@weftwise/cdocs-opencode@0.1.0`, but that package is stale relative to `clauthier` source.
> The next implementation should bump, rebuild, publish, and test the package in clean consumers with no local `clauthier` checkout and no hand-copied `.opencode` artifacts hiding failures.
> Command generation, agent materialization, runtime materialization, ownership markers, and lifecycle hardening are conditional follow-up work only if verification proves they are needed.

## Objective

Publish a current CDocs OpenCode package from `~/code/weft/clauthier/main` and make that package the verified source of truth for OpenCode CDocs artifacts.
The implementation should prove the real consumer contract before lace depends on it.

The first outcome is intentionally narrow: a published npm version newer than `0.1.0`, a verified OpenCode behavior matrix, and updated upstream documentation.
Local copies in lace should be removed or retained only after verification shows which package artifacts OpenCode actually discovers.

## Background

The CDocs source repo is `~/code/weft/clauthier/main`.
The paired downstream consumer is `~/code/weft/lace/main`.
The root `clauthier/package.json` is private and provides OpenCode build scripts:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsx scripts/build-opencode.ts",
    "build:cdocs": "tsx scripts/build-opencode.ts cdocs"
  }
}
```

`scripts/build-opencode.ts` generates the npm package at `build/cdocs/opencode/`.
The generated package is named `@weftwise/cdocs-opencode`, and its version is copied from `plugins/cdocs/.claude-plugin/plugin.json`.
The current source manifest still reports `0.1.0`.
`npm view @weftwise/cdocs-opencode version --json` also returns `"0.1.0"`.

The published package is stale while keeping that same version.
`npm pack @weftwise/cdocs-opencode@0.1.0 --dry-run` shows 10 skills and 3 agents.
Current `clauthier` source contains 11 CDocs skills and 4 CDocs agents, including `plugins/cdocs/skills/iterate/` and `plugins/cdocs/agents/judge.md`.

The existing build already copies skills, rules, converted agents, `plugins/cdocs/hooks/cdocs-hooks.ts`, `plugins/cdocs/scripts/postinstall.js`, and package metadata into the generated package.
The postinstall script copies package skills and rules into a consuming project's `.opencode/` directory, using `INIT_CWD || process.cwd()` as its project root.
It does not copy agents or commands.

The OpenCode runtime contract is not yet proven by repository structure.
`plugins/cdocs/hooks/cdocs-hooks.ts` implements frontmatter validation through `tool.execute.after`, but OpenCode events do not expose enough agent identity to port Claude Code's agent-scoped path restriction model.
`plugins/cdocs/README.md` documents npm installation and says postinstall copies skills and rules automatically.
It does not prove whether OpenCode discovers commands or agents from package contents, project files, or some OpenCode-specific behavior.

Lace already declares `"plugin": ["@weftwise/cdocs-opencode"]` in `opencode.json`.
It also has local `.opencode/skills/` and `.opencode/commands/` copies.
Those command wrappers are mechanical skill loaders that pass `$ARGUMENTS`.
The observed OpenCode UI already showed `/cdocs` command listings in lace, so the package should be verified before assuming new command generation is required.

## Proposed Solution

Use a verification-first publication path.
First bump the CDocs plugin version, build the current generated package, publish it from `build/cdocs/opencode/`, and verify it in clean OpenCode consumers.
Only add command generation, agent materialization, runtime materialization, ownership markers, or release automation after a concrete verification failure justifies that extra surface.

The minimum downstream config to verify is:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@weftwise/cdocs-opencode"]
}
```

Verification must answer six questions:

1. Does OpenCode install and load the published package from `opencode.json` without a local `clauthier` checkout?
2. Are CDocs skills visible when no hand-copied `.opencode/skills/` directory is present?
3. Are `/cdocs` command listings available without lace-local command wrappers?
4. Are agents visible or dispatchable from the package, or are project-level agent files still required?
5. Does the frontmatter validation hook run from the published package?
6. Does `postinstall.js` run with a project root that is safe for repo-local materialization?

If the rebuilt package passes these checks, the implementation should stop there and document the verified contract.
If a check fails, implement the smallest targeted follow-up that fixes that observed failure.

### Package Publication

Bump `plugins/cdocs/.claude-plugin/plugin.json` above `0.1.0` because npm should not reuse the same version for different package contents.
Run `npm run build:cdocs` from `clauthier`, then run `npm pack --dry-run` from `build/cdocs/opencode/`.
The pack list should contain current skills, current agents, rules, the hook plugin, the postinstall script, and package metadata.

Publish only from `build/cdocs/opencode/`.
After publication, verify the version with `npm view @weftwise/cdocs-opencode version` and repeat consumer checks against the registry package.
Use npm provenance if the registry and GitHub workflow support it, but do not make release automation a prerequisite for this first correction.

### Conditional Follow-Up Work

Keep follow-up work tied to failed checks.
Do not generate OpenCode command wrappers unless commands are not visible without lace-local wrappers.
Do not extend `postinstall.js` to copy agents unless package-internal agents are not discoverable and project-level agent files are required.
Do not add runtime materialization unless postinstall cannot safely materialize required files.
Do not add ownership markers or refresh semantics unless package-owned project files must be written and updated over time.

If command wrappers become necessary, generate or materialize only mechanical wrappers that load the corresponding skill and pass `$ARGUMENTS`.
If `/init` collides with an OpenCode built-in, prefer a CDocs-specific command such as `/cdocs-init` rather than overriding built-in behavior.
If underscore skill names are a problem in OpenCode, add a narrow compatibility wrapper for `nit_fix` rather than renaming canonical source paths.

### Documentation

Update `plugins/cdocs/README.md` after verification so OpenCode installation instructions match observed behavior.
The README should distinguish published package consumption from source-repo development and should state that downstream repos must not hand-copy files from `build/cdocs/opencode/`.

Document the package versioning and release path, any required OpenCode restart, and any known OpenCode parity gaps.
The parity gaps include the lack of agent-scoped path restriction in OpenCode hook events.

## Important Design Decisions

### Start With the Existing Package Shape

The source repo already has an OpenCode package build path.
That build already includes skills, rules, converted agents, hook code, postinstall, and package metadata.
Publishing a current version and measuring real OpenCode behavior is lower risk than designing replacement delivery paths first.

### Publish the Generated Package

`clauthier/package.json` is private and represents the source repo.
The generated package under `build/cdocs/opencode/` is the npm product.
Publishing that directory preserves the private root boundary and avoids exposing unrelated source-repo metadata.

### Treat Discovery as a Runtime Contract

A file in the npm tarball does not prove OpenCode can discover it.
A file copied into `.opencode/` does not prove it will be refreshed safely after package upgrades.
The release contract must be based on actual OpenCode behavior in a consumer project.

### Keep Lace as a Consumer

Lace should not patch `clauthier` internals during downstream installation work.
It should wait for this proposal's verified package contract and then depend on that contract.
The clauthier repo mount in lace may remain useful for development, but it must not be required for normal CDocs OpenCode use.

## Edge Cases / Challenging Scenarios

### Local Files May Hide Package Failures

Lace already has local `.opencode/skills/` and `.opencode/commands/` copies.
Those files can make CDocs appear functional even if npm package loading is broken.
Verification must use a scratch project or a disposable lace worktree where local CDocs copies are absent or ignored.

### OpenCode May Install Plugins Outside the Project

OpenCode may install npm plugins into a cache rather than the consuming project.
If lifecycle scripts run from that cache, the current `postinstall.js` may not know where the project `.opencode/` directory is.
This must be tested before relying on postinstall materialization.

### Runtime Materialization May Require Restart

If later work adds runtime materialization, OpenCode may discover project skills before plugin initialization.
That could require one restart before new skills are visible.
This is acceptable only if it is documented and the lace installation proposal accounts for it.

### User Files May Collide With Generated Files

Consumers may already have `.opencode/commands/propose.md` or `.opencode/skills/propose/SKILL.md`.
The package must not blindly overwrite user-authored files if future work starts writing those paths.
Ownership markers and refresh semantics are needed only if that future package-owned write path is adopted.

### The Published Package Is Already Stale

The current npm package is stale relative to source under the same `0.1.0` version.
The next release needs a version bump and pack-list assertions so that stale publication does not recur.

## Test Plan

### Static Package Checks

Run `npm run build:cdocs` in `clauthier`.
Inspect `build/cdocs/opencode/package.json` and verify the package name, version, and `main` entry.
The version must be greater than the currently published `0.1.0`, and `main` must point at the OpenCode hook plugin.

Run `npm pack --dry-run` in `build/cdocs/opencode/`.
Assert that the pack list contains current skills, current agents, rules, the hook plugin, and the postinstall script.
Assert specifically that it contains `skills/iterate/` and `agents/judge.md`.
Do not require generated commands in the pack list unless verification proves package-owned command wrappers are necessary.

### Consumer Installation Checks

Create a scratch project with no dependency on a local `clauthier` checkout.
Configure it with an `opencode.json` that references `@weftwise/cdocs-opencode`.
Start OpenCode in that scratch project and verify whether OpenCode installs the package and whether lifecycle scripts see the project root.

Verify skills, `/cdocs` command listings, agents, and hook behavior from the consumer.
For hooks, edit a malformed temporary CDocs file and confirm that frontmatter warnings fire.
Repeat the scratch test against the published registry package after release.

### Downstream Contract Checks

In a disposable lace worktree, remove or ignore local CDocs `.opencode` copies.
Keep `opencode.json` pointed at the published package.
Verify that the CDocs workflow works without referencing `~/code/weft/clauthier/main`.
Do not land downstream lace cleanup as part of this upstream proposal.

## Verification Methodology

Use a release-candidate loop.
Build the generated OpenCode package from `clauthier`, pack it locally, and consume it in a scratch OpenCode project with no copied CDocs artifacts.
Fix only verified discovery or materialization gaps.

After that local loop passes, publish a new npm version and verify the registry package in a second scratch project.
Hand the exact package version and verified contract to the lace installation work.
The acceptance standard is empirical OpenCode behavior in a consumer project.
Repository structure and tarball contents are useful evidence, but neither is sufficient by itself.

## Implementation Phases

### Phase 1: Establish the Publication Baseline

Record the currently published version and dry-run pack list for `@weftwise/cdocs-opencode`.
Record the current source skill and agent inventories in `clauthier`, including `iterate` and `judge`.
Choose the next package version.

Success criteria: maintainers know exactly what differs between source and npm before publishing.

### Phase 2: Bump, Build, Pack, and Publish

Bump `plugins/cdocs/.claude-plugin/plugin.json` above `0.1.0`.
Run `npm run build:cdocs`, assert package contents, and run `npm pack --dry-run` from `build/cdocs/opencode/`.
Publish from `build/cdocs/opencode/` and verify npm metadata afterward.

Success criteria: npm contains a current package version built from source.

### Phase 3: Verify OpenCode Visibility

Test the published package in a scratch project without local CDocs copies.
Verify skills, `/cdocs` command listings, agents, hooks, and postinstall behavior according to actual OpenCode behavior.
Record where lifecycle scripts write files.

Success criteria: the downstream contract is based on observed OpenCode behavior rather than assumptions.

### Phase 4: Fix Only Proven Gaps

If commands are missing, add the smallest package-owned command wrapper path.
If agents are missing, add the smallest package-owned agent discovery or materialization path.
If lifecycle context is wrong, add the smallest safe install or runtime materialization path.
If package-owned project files must be refreshed, add ownership markers and overwrite rules for those files only.

Success criteria: any added complexity maps directly to a failed verification check.

### Phase 5: Document and Hand Off to Lace

Update `plugins/cdocs/README.md` with verified OpenCode installation instructions.
Document source development separately from package consumption.
Document the exact package version, any required restart or initialization step, and any remaining parity gaps.
Tell the lace installation work which local artifacts can be removed, retained, or regenerated.

Success criteria: lace can proceed without modifying `clauthier` and without depending on a local `clauthier` checkout.

## Summary

This proposal keeps upstream publication focused on the first necessary correction: replace the stale `0.1.0` npm package with a current published package and verify it in real OpenCode consumers.
More elaborate package machinery is deliberately conditional.

The main correctness risk is false confidence from local `.opencode` copies hiding npm package failures.
The lace installation proposal should wait for the verified package contract rather than papering over those gaps locally.
