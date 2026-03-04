---
review_of: cdocs/devlogs/2026-03-03-weftwise-migration-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-04T12:00:00-08:00
task_list: lace/weftwise-migration
type: review
state: live
status: done
tags: [fresh_agent, migration, devcontainer, implementation_fidelity, stale_documentation]
---

# Review: Weftwise Migration Implementation Devlog

## Summary Assessment

This devlog documents the migration of weftwise's devcontainer to lace idioms across Phases 1-5.
The actual implementation (devcontainer.json and Dockerfile) is correct and complete: all five phases are reflected in the files, the Dockerfile cleanup is thorough, and the lace customizations section is well-structured.
However, the devlog itself is stale relative to the implementation it documents: it describes local path feature references and deferred Phase 6, while the actual devcontainer.json uses published OCI references and includes `prebuildFeatures`.
The OCI namespace in the implementation (`ghcr.io/weftwiseink/devcontainer-features/<feature>`) also differs from what the proposal specified (`ghcr.io/weftwiseink/lace/<feature>`), though the implementation uses the correct published namespace.

Verdict: **Revise** -- the implementation is sound but the devlog needs updating to match reality.

## Section-by-Section Findings

### Current State Analysis

**Non-blocking.** The current state analysis is thorough and well-organized.
It accurately describes the before-state of both devcontainer.json and Dockerfile, enumerates lace features available, and documents the path resolution discovery.
The path resolution note about CWD-vs-`.devcontainer/` relative paths is valuable and was verified against `fetchFromLocalPath()` in `packages/lace/src/lib/feature-metadata.ts`, which uses `join(featureId, "devcontainer-feature.json")` relative to CWD.

### Feature Reference Strategy (Stale)

**Blocking.** The devlog states: "GHCR publication is NOT available" and "Features are referenced using local relative paths with OCI reference placeholders in comments."
The actual `devcontainer.json` uses published OCI references:
```jsonc
"ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
"ghcr.io/weftwiseink/devcontainer-features/claude-code:1": { "version": "2.1.11" },
"ghcr.io/weftwiseink/devcontainer-features/neovim:1": { "version": "0.11.6" }
```
No local path references remain in the file.
This means GHCR publication happened after the devlog was written, and the devcontainer.json was updated to OCI references, but the devlog was not updated to reflect this transition.

### OCI Namespace Discrepancy (Proposal vs. Implementation)

**Non-blocking.** The proposal specifies `ghcr.io/weftwiseink/lace/<feature>:1` throughout.
The implementation uses `ghcr.io/weftwiseink/devcontainer-features/<feature>:1`.
Cross-referencing the lace repo's README (`ghcr.io/weftwiseink/devcontainer-features`) and lockfile confirms `devcontainer-features` is the correct published namespace.
The proposal should be updated to reflect the actual namespace, but this is a documentation concern, not an implementation error.

### Phase 1: Workspace Layout Detection

**No issues.** The implementation matches the proposal exactly:
- `workspaceMount`, `workspaceFolder`, `postCreateCommand` are absent from devcontainer.json.
- `customizations.lace.workspace` contains `layout: "bare-worktree"` and `mountTarget: "/workspace"`.
- `COMMAND_HISTORY_PATH` build arg is removed from both devcontainer.json and Dockerfile.
- `git.repositoryScanMaxDepth: 2` is preserved in VS Code settings.
- The workspace layout note at the top of devcontainer.json is helpful context.

### Phase 2: Feature Adoption

**No issues with the implementation; blocking issue with the devlog narrative.**
The Dockerfile correctly removes all generic tool installations and adds `# REMOVED:` marker comments.
Specific removals verified in the Dockerfile:
- No Neovim install, no WezTerm install, no runtime dir creation, no SSH dir setup, no Claude Code install, no bash history persistence.
- The `CLAUDE_CODE_VERSION`, `NEOVIM_VERSION`, `WEZTERM_VERSION` ARGs are absent.
- `postStartCommand` is absent from devcontainer.json.
- All three lace features plus the existing git and sshd features are in the `features` section.

The devlog says features use "local relative paths" but the actual file uses OCI references (see Feature Reference Strategy finding above).

### Phase 3: Port Allocation

**No issues.** `appPort` is absent from devcontainer.json.
The comment explaining the removal and the need for `wez-into` dynamic port discovery is present and accurate.

### Phase 4: Mount Declarations

**No issues.** The static `mounts` array is absent.
`customizations.lace.mounts` declares `nushell-config` with the correct target, recommendedSource, description, and sourceMustBe fields matching the proposal.
The comments documenting feature-injected mounts are clear and accurate.

### Phase 5: Host Validation

**No issues.** `customizations.lace.validate.fileExists` is present with the SSH key path, error severity, and remediation hint, matching the proposal exactly.

### Phase 6 Status (Blocking Inconsistency)

**Blocking.** The devlog's "Deferred Phases" section states Phase 6 is "BLOCKED" on GHCR publication.
However, the actual devcontainer.json contains a `prebuildFeatures` section:
```jsonc
"prebuildFeatures": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
    "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": { "version": "2.1.11" },
    "ghcr.io/weftwiseink/devcontainer-features/neovim:1": { "version": "0.11.6" }
}
```
This means Phase 6 was implemented (or at least the config was added) after the devlog was written.
The devlog should either document Phase 6 as completed or note that the `prebuildFeatures` declaration was added ahead of full verification.

### Dockerfile Cleanup

**No issues.** The Dockerfile is reduced to project-specific concerns:
- System dependencies for Playwright/Electron remain.
- pnpm/corepack setup remains.
- git-delta installation remains.
- Electron pre-install and Playwright browser install remain.
- Project dependency install and build remain.
- Sudoers setup remains (needed by sshd feature).
- All generic tool installations are removed with marker comments.

The Dockerfile is 131 lines, consistent with the devlog's claim of "~110 lines" (close enough given comments and blank lines).

### Path Fix and .gitignore

**No issues.** The `.gitignore` contains the `.lace/` entry with a descriptive comment.
The path fix from `../../../` to `../../` is no longer visible in the file since OCI references replaced local paths, but the devlog's documentation of the discovery is valuable for posterity.

### Verification Evidence

**Credible but dated.** The `lace up --skip-devcontainer-up` output is internally consistent:
- 5 features validated (git, sshd, wezterm-server, claude-code, neovim).
- Port allocated from the 22425-22499 range (22425).
- Four mount sources resolved with correct paths.
- Exit code 0 with no failed phase.

The output shows mount sources like `/home/mjr/.config/nushell` and `/home/mjr/.claude`, suggesting settings overrides were in place.
The generated `.lace/devcontainer.json` description includes all expected fields.

The "What still needs manual verification" list is honest about gaps: actual container build, feature installation, mux server auto-start, SSH connection, and mount source validation have not been tested.

### Writing Conventions

**Non-blocking.** The devlog uses em-dashes in two places ("Three bind mounts -- bash history..." and "Two devcontainer features: `ghcr.io/...`") which the writing conventions recommend against, preferring colons.
The sentence-per-line convention is generally followed.

## Verdict

**Revise.**

The implementation itself is well-executed: the devcontainer.json and Dockerfile match the proposal's intent for Phases 1-5, and the Dockerfile cleanup is thorough.
The blocking issue is that the devlog is stale: it describes a state (local path references, Phase 6 blocked) that no longer matches the actual files.
A reader relying on the devlog would have an inaccurate picture of the current implementation.

## Action Items

1. [blocking] Update the "Feature Reference Strategy" section to reflect that GHCR publication is complete and features now use OCI references (`ghcr.io/weftwiseink/devcontainer-features/<feature>:1`). Remove or qualify the "GHCR publication is NOT available" statement.
2. [blocking] Update the "Deferred Phases" section to reflect that `prebuildFeatures` is now present in the devcontainer.json. Either document Phase 6 as implemented or note the config was added ahead of full verification.
3. [blocking] Update the Implementation Log to reflect the transition from local paths to OCI references, whether as a new phase entry or an amendment to Phase 2.
4. [non-blocking] Update the proposal's OCI namespace from `ghcr.io/weftwiseink/lace/<feature>` to `ghcr.io/weftwiseink/devcontainer-features/<feature>` to match reality.
5. [non-blocking] Replace em-dashes with colons per writing conventions.
6. [non-blocking] Consider adding a "Phase 6" entry to the Implementation Log since the `prebuildFeatures` declaration is present in the devcontainer.json, even if full verification is deferred.
