---
first_authored:
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:07:19.000Z
task_list: lace/cdocs-opencode-installation
type: proposal
state: live
status: implementation_ready
last_reviewed:
  status: accepted
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:41:04.000Z
  round: 2
tags:
  - lace
  - cdocs
  - opencode
  - repo_installation
  - migration
guid: peu-lHXrYx7Z9
---

# Lace CDocs OpenCode Repo Installation

> BLUF: Lace should consume the verified published `@weftwise/cdocs-opencode` package before replacing local `.opencode` artifacts.
> The repo already references the package in `opencode.json`, and this session observed `/cdocs` command listings in OpenCode.
> That evidence makes dependency and visibility verification the first step, not command-wrapper churn or new materialization assumptions.
> Verification must run with local `.opencode/skills/` and `.opencode/commands/` copies absent or ignored so those copies do not hide package failures.

## Objective

Make CDocs usable from OpenCode in the lace repo through a reproducible repo-local package dependency.
Lace should depend on the published `@weftwise/cdocs-opencode` package, not on copied `clauthier` build output or a sibling source checkout.

The implementation should reconcile local `.opencode` artifacts only after package verification shows which artifacts are still required.
It should avoid global OpenCode configuration and should preserve Claude Code compatibility files unless a separate cleanup proposal removes them.

## Background

Lace already has an `opencode.json` file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@weftwise/cdocs-opencode"],
  "permission": {
    "*": {
      "*": "allow"
    }
  }
}
```

That file declares the intended package dependency, but it does not prove that package artifacts are installed or visible to the harness.
Lace also has `.opencode/package.json`:

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "1.15.10"
  }
}
```

The local OpenCode package manifest does not currently depend on `@weftwise/cdocs-opencode`.
It may support local plugin development, OpenCode package resolution, or neither.
This proposal does not assume its role before verification.

Lace currently has local `.opencode/commands/` wrappers for `devlog`, `implement`, `init`, `nit_fix`, `propose`, `report`, `review`, `rfp`, `status`, and `triage`.
Those wrappers are mechanical skill loaders that pass `$ARGUMENTS`.
Lace also has local `.opencode/skills/` copies for the same workflows.

The upstream source has moved ahead of those copied artifacts.
Current `clauthier` source includes an additional `iterate` skill and a `judge` agent.
The current published npm package, `@weftwise/cdocs-opencode@0.1.0`, is stale relative to `clauthier` source.
The paired upstream proposal `cdocs/proposals/2026-05-27-cdocs-opencode-plugin-publication.md` owns publication and package contract work.

Lace's `.devcontainer/devcontainer.json` repo-mounts `github.com/weftwiseink/clauthier`.
That mount is useful for source development and dogfooding, but it must not be required for routine CDocs OpenCode runtime behavior.
The observed OpenCode UI showed `/cdocs` command listings, which reduces the need to assume lace must maintain command wrappers.
It does not prove the published package works because existing local `.opencode` copies can hide package failures.

## Proposed Solution

Use a dependency-first installation path gated by upstream publication.
After upstream publishes and verifies a current `@weftwise/cdocs-opencode` package, update lace's repo-local package dependency or configuration to consume that exact contract.
Then verify OpenCode from the lace repo root with local copied CDocs artifacts absent or ignored.

Only after that verification should lace reconcile `.opencode/skills/`, `.opencode/commands/`, `.opencode/rules/`, or `.opencode/agents/`.
The goal is not to preserve local copies by default.
The goal is to keep only the repo-local files that the verified package contract actually requires.

The preferred first implementation path is:

1. Confirm the upstream package version and installation contract.
2. Update `opencode.json`, `.opencode/package.json`, or another repo-local dependency mechanism only as required by that contract.
3. Run package and runtime verification with local copied CDocs artifacts removed, renamed, or isolated in a disposable worktree.
4. Keep, remove, or regenerate local artifacts based on observed package behavior.
5. Commit only the files that are part of the verified repo-local install path.

The implementation should not use `file:` dependencies, `npm link`, absolute path dependencies, or copied `build/cdocs/opencode/` output.
It should not install CDocs into `~/.config/opencode/`.
It should not make the `clauthier` repo mount part of runtime resolution.
It should not delete `CLAUDE.md` or `.claude/rules/` as part of this proposal.

### Upstream Dependency Gate

Before changing lace, confirm that `@weftwise/cdocs-opencode` has been published at a reviewed version newer than `0.1.0`.
Confirm that the package tarball includes the current CDocs skills, rules, agents, and hook plugin.
Confirm that upstream verification states whether commands are directly visible, package-provided, or still expected to be local wrappers.
Confirm whether repo-local materialized files should be committed, regenerated by install, or generated at startup.

Stop if upstream publication is incomplete.
Do not work around an incomplete package by using the local `clauthier` checkout.

### Repo-Local Install Path

Use the upstream documented install path after it has been verified.
If OpenCode automatic npm plugin installation is sufficient, keep `opencode.json` as the primary dependency declaration and avoid unnecessary manifest churn.
If explicit package pinning is required, add `@weftwise/cdocs-opencode` to the repo-local manifest that OpenCode actually uses.

If `.opencode/package.json` is used for version pinning, update `.opencode/package-lock.json` only if lockfile use is part of the verified install path.
Do not assume that running npm from `.opencode/` is correct.
The current package postinstall computes its destination as `PROJECT_ROOT/.opencode`, where `PROJECT_ROOT` is `INIT_CWD || process.cwd()`.
An install from the wrong root can create a nested `.opencode/.opencode/` tree, so the implementation must explicitly test and avoid that failure mode.

### Artifact Reconciliation

Start by testing without the existing local CDocs `.opencode/skills/` and `.opencode/commands/` copies.
Use a disposable worktree, temporary rename, or equivalent safe method that cannot be committed accidentally.

If OpenCode exposes CDocs workflows from the package alone, remove or stop relying on hand-copied local artifacts.
If OpenCode requires project-level skills or rules that the package materializes, treat package-owned content as the source of truth unless a lace-specific customization is found and documented.
If command wrappers are still required locally, keep only mechanical wrappers that load one installed skill and pass `$ARGUMENTS`.

Add an `iterate` command wrapper only if the installed package provides an `iterate` skill and upstream intentionally leaves command wrappers to consumers.
Remove or update wrappers that point to missing or renamed skills.
Do not add workflow logic to lace-local command wrappers.

### Runtime Verification

Verify OpenCode from the lace repo root.
The verification must work with `.opencode/node_modules/` absent before install, without relying on `~/code/weft/clauthier/main`, and without global OpenCode config changes.

The runtime check must show that the CDocs proposal workflow used by this repo is available to the OpenCode harness.
It must also show whether the observed `/cdocs` command listings come from the package, from OpenCode itself, or from local project files.

## Important Design Decisions

### Treat the Published Package as the Source of Truth

Lace should be a consumer of CDocs OpenCode support, not a second packaging site.
This keeps upstream defects in `clauthier` and downstream installation defects in lace.
It also prevents the local skill set from drifting behind source, as it has with `iterate` and `judge`.

### Prefer Minimal Downstream Changes

The repo already lists the package in `opencode.json`.
The observed OpenCode UI already showed `/cdocs` command listings.
The first downstream change should therefore be limited to the package dependency or config path that verification proves is necessary.
Local artifact replacement is follow-up reconciliation, not the starting assumption.

### Keep the Installation Repo-Local

The user asked for a repo-local installation proposal.
The implementation should not modify `~/.config/opencode/` or other global state.
Repo-local installation keeps the workflow reviewable in the lace repo and reproducible for contributors.

### Separate Development Mounts From Runtime Dependencies

The `clauthier` repo mount in `.devcontainer/devcontainer.json` can remain for source work.
It must not be used as the runtime dependency path for CDocs OpenCode support.
A contributor should be able to use CDocs in lace without having the same sibling checkout.

### Do Not Guess the Package Manager Contract

The current `.opencode/package.json` may or may not matter to OpenCode's npm plugin resolver.
The implementation should prove whether OpenCode resolves plugins from its own cache, project `node_modules`, `.opencode/node_modules`, or some combination.
Lace should commit only package manifest and lockfile changes that are part of the verified harness path.

### Preserve Claude Code Artifacts in This Scope

`CLAUDE.md` and `.claude/rules/` are still present and referenced by this repo.
This proposal does not remove them.
Any hard cutover away from Claude Code should be a separate proposal because it affects existing CDocs rule loading and historical workflow compatibility.

## Edge Cases / Challenging Scenarios

### Upstream Package Is Missing or Stale

If the accepted package version is not published, lace must stop at the dependency gate.
If the package still lacks current skills, agents, or hook support, lace must stop at the dependency gate.
Using a local `file:` dependency would hide the upstream publication failure and violate the goal of depending on published support.

### Existing Local Copies Hide Package Failures

Existing `.opencode/skills/` and `.opencode/commands/` can make CDocs appear functional even if the package is missing.
Verification should include a disposable worktree or temporary rename of local artifacts so package dependency failures are visible.
This is especially important because the current OpenCode UI already showed `/cdocs` command listings.

### Postinstall Writes to the Wrong Directory

The current package postinstall uses `INIT_CWD || process.cwd()` as the project root.
An install from the wrong working directory can create nested `.opencode/.opencode` artifacts.
The lace implementation must verify the install invocation before accepting generated paths.

### OpenCode Discovers Skills Before Materialization

If package materialization happens after OpenCode skill discovery, the harness may need a restart before workflows appear.
The upstream package should document this if it remains part of the accepted contract.
Lace should document the restart only if it remains part of the accepted contract.

### Commands Drift From Skills

Local command wrappers can point at missing skills after upstream renames.
If local wrappers remain, the implementation should compare commands against installed skills during reconciliation.

### Materialized Files May Be Tracked or Untracked

If the harness needs materialized files before OpenCode starts, lace may need to commit package-owned files under `.opencode/`.
If the package can reliably materialize files during install or startup, lace may only commit config and lockfile changes.
The upstream contract should decide this.
The lace implementation should not invent a third path.

### `@opencode-ai/plugin` May Be Redundant

`.opencode/package.json` currently depends on `@opencode-ai/plugin`.
That dependency may only support local plugin development.
Do not remove it until runtime verification proves it is unused.
Do not keep it as a workaround for upstream package metadata defects without documenting why.

## Test Plan

### Upstream Package Gate

Run `npm view @weftwise/cdocs-opencode version --json`.
Verify the accepted version is published and newer than `0.1.0`.
Run `npm pack @weftwise/cdocs-opencode@<version> --dry-run`.
Verify the pack list contains current skills, current agents, rules, hook plugin, and materialization scripts if package materialization remains part of the contract.

Verify whether commands are expected from package contents, OpenCode's `/cdocs` command grouping, or lace-local wrappers.
Verify that the package documentation states how a consuming project should materialize or discover artifacts.

### Repo State Checks

Verify `opencode.json` references the accepted package name or version specifier.
Verify no `file:`, `link:`, or absolute path dependency points at `clauthier`.
Verify `.opencode/node_modules/` is not staged.
Verify any `.opencode/package-lock.json` change resolves the package from npm if lockfile use is accepted.
Verify `.devcontainer/devcontainer.json` clauthier repo mount is not referenced by OpenCode runtime config.

### Artifact Checks

Verify package-backed or materialized skills include every expected CDocs skill from the accepted package.
Verify package-backed or materialized agents include every expected CDocs agent from the accepted package if agent availability is part of the contract.
Verify `.opencode/rules/cdocs/` exists only if rules are project-materialized or intentionally retained.
Verify command wrappers align with installed skills if local wrappers remain.
Verify `iterate` is present only when provided by the accepted package.
Verify no nested `.opencode/.opencode/` directory was created.

### Runtime Checks

Start OpenCode from the lace repo root in a clean shell.
Verify CDocs skills are available to the harness.
Verify `/cdocs` command listings appear with local hand-copied CDocs command wrappers absent or ignored.
Verify `/propose`, `/review`, and `/status` use package-backed skill content.
Verify a malformed temporary CDocs file triggers frontmatter validation if hook verification is practical.
Delete the temporary file after validation.
Repeat the runtime check in a disposable worktree without a `clauthier` sibling path dependency.

## Verification Methodology

Use dependency-first verification.
First prove the accepted upstream package exists and contains the expected artifacts.
Then prove lace consumes that package through repo-local config or a documented repo-local install command.
Then prove package-owned artifacts are visible to OpenCode from the lace repo root.
Then prove the workflow still works when local hand-copied artifacts are absent or replaced by package-owned materialization.
Then prove no global OpenCode config or `clauthier` source path is required.

Record the commands and results in the implementation devlog.
The verification floor is a fresh lace checkout with no `.opencode/node_modules/`, no local CDocs `.opencode` copies hiding package behavior, and no sibling `clauthier` dependency.
After the documented repo-local install step, OpenCode from the lace root must expose the CDocs workflow and load `@weftwise/cdocs-opencode`.

## Implementation Phases

### Phase 0: Wait for Upstream Publication

Confirm that the paired clauthier publication proposal is implemented and that the package version is newer than `0.1.0`.
Confirm the published package contract, including command, agent, hook, and materialization behavior.
Stop if the package is missing, stale, or undocumented.

Success criteria: lace has a specific package version and installation contract to consume.

### Phase 1: Establish a Clean Lace Baseline

Record current `opencode.json`, `.opencode/package.json`, `.opencode/commands/`, and `.opencode/skills/` state.
Record whether `.opencode/rules/cdocs/` and `.opencode/agents/` exist.
Create a disposable verification branch or worktree for artifact replacement checks.
Record the observed `/cdocs` command listings and the conditions under which they appear.

Success criteria: local drift and cleanup scope are visible before installation changes.

### Phase 2: Apply the Package Contract

Apply the upstream documented install path.
Pin the package in `opencode.json`, `.opencode/package.json`, or another repo-local mechanism only if verification confirms that mechanism is effective.
Update lockfiles only when they are part of the effective install path.
Do not use local `clauthier` paths.

Success criteria: lace declares and installs the published package through the accepted repo-local mechanism.

### Phase 3: Verify Without Local CDocs Copies

Temporarily remove, rename, or isolate local CDocs `.opencode/skills/` and `.opencode/commands/` copies in a disposable environment.
Start OpenCode from the lace root.
Verify CDocs skills, `/cdocs` command listings, agents, hooks, and install root behavior according to the accepted package contract.
Verify no global config or `clauthier` checkout is required.

Success criteria: the package works without false positives from local copied artifacts.

### Phase 4: Reconcile `.opencode` Artifacts Only As Needed

Remove hand-copied skills if package discovery makes them unnecessary.
Replace hand-copied skills or rules with package-owned materialized files only if project files remain required.
Add, retain, or remove agents and commands according to the upstream package contract.
Keep local command wrappers only if upstream intentionally leaves commands to consumers.

Success criteria: local CDocs artifacts either come from the package or are explicitly documented as thin lace-local wrappers.

### Phase 5: Document Minimal Usage

Add concise developer documentation only if needed after verification.
The documentation should state the repo-local install command and the package versioning source.
It should not instruct contributors to modify global OpenCode config or copy files from `clauthier` build output.

Success criteria: a contributor can refresh the repo-local CDocs OpenCode installation without chat history.

## Summary

This proposal keeps downstream lace installation dependent on a verified upstream package contract.
The expected implementation is small: consume the published package through the effective repo-local mechanism, verify package-backed OpenCode behavior without local copies hiding failures, and reconcile `.opencode` artifacts only where verification proves they are still needed.

The main correctness risk is false confidence from existing local copies or from the `clauthier` repo mount.
The implementation should make those dependencies unnecessary rather than silently relying on them.
