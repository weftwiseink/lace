---
review_of: cdocs/proposals/2026-03-24-lace-fundamentals-feature.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-24T21:30:00-07:00
task_list: lace/fundamentals-feature
type: review
state: live
status: done
tags: [rereview_agent, architecture, mount_declarations, git_identity, install_decomposition, internal_consistency]
---

# Review (Round 3): Lace Fundamentals Devcontainer Feature

## Summary Assessment

This is a round 3 review of a proposal that was accepted on round 2 and then substantially revised to address user REVIEW_NOTEs.
The revision introduces five significant changes: feature mount requests for dotfiles and screenshots, install.sh decomposition into step scripts, git as a dependency, staple tool installation, and project-aware git identity via `GIT_CONFIG_*`.
The revisions are largely well-executed and improve the proposal.
The most significant finding is an internal contradiction between the feature metadata (which declares a `screenshots` mount at line 170) and Decision 6 (which states "The fundamentals feature does not declare a screenshot mount" at line 623).
A second blocking issue is a dead `dotfilesPath` option that is declared in the feature metadata and read in install.sh but never consumed by any script.

**Verdict: Revise.** Two blocking issues require resolution.

## Prior Round Status

### Round 1 blocking issues
Both resolved in the round 2 revision and confirmed by the round 2 reviewer.

### Round 2 non-blocking issue
The test plan `AllowTcpForwarding` value has been corrected.
Line 693 verifies `AllowTcpForwarding local`, matching the install script.

### Round 1 non-blocking items (3-8)
Several remain unaddressed but are still non-blocking.
These are appropriate for the implementer to consider during implementation.

## Section-by-Section Findings

### Mount Declarations (Feature Metadata, lines 146-181)

The mount declarations for `authorized-keys` and `dotfiles` follow the established pattern from `claude-code` and `neovim` correctly.
Both use valid `LaceMountDeclaration` fields: `target`, `description`, `sourceMustBe`, `hint`, `recommendedSource` (where appropriate), and `readonly`.

The `authorized-keys` mount uses `readonly: true` and `sourceMustBe: "file"`, which is correct: it mounts a public key file.
The `hint` provides a concrete `ssh-keygen` command, which is helpful for first-time setup.

The `dotfiles` mount intentionally omits `recommendedSource` with a well-reasoned NOTE (line 200-203) explaining that dotfiles repos vary in location.
This is the right call.

**Finding (blocking): Internal contradiction between feature metadata and Decision 6 regarding screenshots mount.**
The feature metadata at lines 170-177 declares a `screenshots` mount in `customizations.lace.mounts`:

```json
"screenshots": {
    "target": "/mnt/user/screenshots",
    "recommendedSource": "~/Pictures/Screenshots",
    "description": "Host screenshots directory for Claude Code image references",
    "readonly": true,
    "sourceMustBe": "directory",
    "hint": "Configure in ~/.config/lace/user.json mounts section, or override source in settings.json"
}
```

Decision 6 (lines 621-628) states: "The fundamentals feature does not declare a screenshot mount."
It then argues that screenshots are a user-level concern handled by `user.json`, and that coupling screenshot mounts to the fundamentals feature would "create an unnecessary dependency and duplicate the user.json mount system."

These contradict each other.
The BLUF (line 19) and the key design points (line 194) both reference the screenshot mount as part of the feature.
The feature metadata declares it.
But Decision 6 argues against declaring it.

Additionally, declaring a screenshots mount in the feature creates a namespace conflict.
Per `buildMountDeclarationsMap()` in `template-resolver.ts` (line 307), feature-declared mounts are namespaced as `<shortId>/<mountName>`, so this mount becomes `lace-fundamentals/screenshots`.
The user-level config proposal declares a `user/screenshots` mount at the same target path (`/mnt/user/screenshots`).
`validateMountTargetConflicts()` (line 348 in `template-resolver.ts`) would flag this as a duplicate target, causing a validation error when both the feature and `user.json` declare the same mount.

Resolution options:
- **Option A**: Remove the screenshots mount from the feature metadata. Decision 6 is correct: screenshots belong in `user.json`. Remove lines 170-177 and the relevant BLUF/key-design-points references.
- **Option B**: Keep the screenshots mount in the feature metadata, remove Decision 6, and update the user-level config proposal to not declare screenshots (since the feature handles it). The `hint` already points users to `user.json` for configuration.
- **Option C**: Keep both, and add target-conflict deduplication logic where feature mounts and user mounts can share a target. This adds implementation complexity with no clear benefit.

Option A is recommended: it matches the stated rationale and avoids the namespace/target conflict.

**Finding (non-blocking): The `readonly` field in mount declarations is novel for features.**
No existing feature in the codebase uses `readonly` in mount declarations (verified by grep across `devcontainers/features/src/`).
The field is valid per the `LaceMountDeclaration` interface (line 71 in `feature-metadata.ts`), but it has not been tested in the feature metadata extraction path (`extractLaceCustomizations`).
The implementer should verify that `readonly` propagates correctly through `parseMountDeclarationEntry()` into the generated Docker mount flags.

### Install Script Decomposition (lines 209-479)

The decomposition into `steps/` scripts is clean and well-structured.
The orchestrator (`install.sh`) is minimal: it reads option variables, determines the script directory, and sources each step in dependency order.

**The sourcing order is correct**: `staples.sh` first (installs `curl` if missing), then `ssh-hardening.sh` and `ssh-directory.sh` (require sshd from `dependsOn`), then `chezmoi.sh` (requires `curl`), then `git-identity.sh` (requires `git` from `dependsOn`), then `shell.sh`.

Variable passing from the orchestrator to step scripts relies on shell sourcing (`. "$SCRIPT_DIR/steps/..."`) which shares the variable scope.
The steps correctly reference variables declared in the orchestrator: `$ENABLE_SSH_HARDENING`, `$_REMOTE_USER`, `$DEFAULT_SHELL`, `$SSH_PORT`.
This is the standard pattern for sourced shell scripts and works correctly.

**Finding (blocking): The `dotfilesPath` option is declared but never consumed.**
The feature metadata (lines 131-135) declares a `dotfilesPath` option with default `/mnt/lace/repos/dotfiles`.
The orchestrator reads it into `DOTFILES_PATH` (line 247): `DOTFILES_PATH="${DOTFILESPATH:-/mnt/lace/repos/dotfiles}"`.
No step script references `$DOTFILES_PATH`.
The init script (created by `steps/git-identity.sh`) reads from the runtime env var `LACE_DOTFILES_PATH` (line 402), not from the build-time `DOTFILES_PATH`.
The heredoc uses single quotes (`<<'INITEOF'`), so `$DOTFILES_PATH` would not be interpolated even if referenced inside it.

The result is a feature option that has no effect.
Phase 3 (line 791) states that lace sets `LACE_DOTFILES_PATH` in containerEnv from the resolved dotfiles repo mount target, so the runtime path is handled by lace, not the feature option.

Resolution: remove the `dotfilesPath` option from the feature metadata entirely.
The runtime path is determined by lace's mount resolution and injected via `LACE_DOTFILES_PATH`.
The option would only be useful if the install script needed the path at build time, but it does not: dotfiles application happens at container start, not during image build.
Remove the `DOTFILES_PATH` variable from the orchestrator as well.

### Git Dependency (lines 142-144, 198, 530-533)

The `dependsOn` with two entries (sshd and git) is valid per the devcontainer feature spec.

**Finding (non-blocking): Multiple `dependsOn` entries are untested in this codebase.**
Existing features (`claude-code`, `portless`) each have a single `dependsOn` entry.
The devcontainer CLI supports multiple dependencies (it topologically sorts the feature graph), but lace's `fetchAllFeatureMetadata()` pipeline has not been exercised with a feature that depends on two upstream features simultaneously.
The implementer should add a test case verifying that both sshd and git metadata are fetched and the install order is correct.

The rationale for depending on git (line 198, 531) is `GIT_CONFIG_*` env var support requiring git 2.31+.
The `ghcr.io/devcontainers/features/git:1` feature installs the latest git, which satisfies this requirement.

### Staples (lines 441-479)

The staples list (`curl`, `jq`, `less`) is appropriate and well-justified.
Each tool has a clear rationale in the NOTE at lines 554-560.
The check-before-install pattern (lines 466-469) avoids unnecessary package manager invocations.
Package manager detection (apt-get vs apk) covers Debian/Ubuntu and Alpine base images.

**Finding (non-blocking): The `eval` usage in staples.sh (lines 474-475) is safe but worth noting.**
`eval "$PKG_INSTALL $MISSING"` concatenates a package manager command with package names.
Since `$MISSING` is built from a controlled `$STAPLES` list (not user input), this is safe from injection.
However, if `STAPLES` is ever extended with user-supplied package names (e.g., via a feature option), this would become an injection vector.
A comment noting this constraint would be prudent.

### Project-Aware Git Identity (lines 365-418, 497-501)

The two-layer identity mechanism is well-designed:
1. `user.json` defaults are written to `~/.gitconfig` by the init script.
2. Projects override via `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*` env vars in `containerEnv`.

The init script correctly handles:
- Missing env vars (skips with no error).
- Differing committer/author names (logs a note, lines 389-392).
- The fundamental git limitation that `.gitconfig` has no `committer.name`/`committer.email` fields.

**Finding (non-blocking): The proposal does not show a concrete example of project-level `GIT_CONFIG_*` override in `containerEnv`.**
The mechanism is described in prose (lines 497-501) and the Mermaid diagram, but no example `devcontainer.json` snippet shows how a project would actually set:

```json
"containerEnv": {
    "GIT_CONFIG_COUNT": "2",
    "GIT_CONFIG_KEY_0": "user.name",
    "GIT_CONFIG_VALUE_0": "Work Name",
    "GIT_CONFIG_KEY_1": "user.email",
    "GIT_CONFIG_VALUE_1": "work@example.com"
}
```

Adding a concrete example would make the mechanism more approachable for implementers and project maintainers who need to use it.

### Test Plan (lines 687-748)

The test plan has been updated to include the new components.
SSH hardening verification (item 1) correctly lists all seven directives including `AllowTcpForwarding local`.
Feature metadata validation (item 4) verifies `dependsOn` includes sshd but does not mention verifying git.

**Finding (non-blocking): Test item 4 should verify `dependsOn` includes both sshd and git.**
Line 708 states: "Parse `devcontainer-feature.json` and verify `dependsOn` includes sshd."
The git dependency (added in this revision) is not mentioned in the test verification.
Add: "Verify `dependsOn` includes both sshd and git."

**Finding (non-blocking): No test coverage for staples installation.**
The test plan does not include verification that `curl`, `jq`, and `less` are available after the feature installs.
A manual verification step or scenario test should confirm core utilities are present.

**Finding (non-blocking): No test coverage for the `dotfilesPath` option behavior (if retained).**
If the option is removed per the blocking finding above, this is moot.
If retained, tests should verify the option actually affects behavior.

### Implementation Phases (lines 750-857)

The five phases are well-ordered and have clear success criteria.

**Finding (non-blocking): Phase 1 success criteria (line 762) should include staples verification.**
The criteria list SSH hardening, git, chezmoi, and init script, but do not mention verifying that core utilities are installed.
Add: "Core utilities (`curl`, `jq`, `less`) are installed" to the success criteria (this is present at line 762, good).

Actually, re-reading line 762: "Core utilities (`curl`, `jq`, `less`) are installed" is listed.
No issue here.

**Finding (non-blocking): Phase 4 before/after (lines 820-844) removes the explicit `git:1` declaration.**
The comment at line 842 explains that fundamentals pulls git via `dependsOn`.
This is correct and matches the design.
However, the current devcontainer.json has `"ghcr.io/devcontainers/features/git:1": { "version": "latest" }` with a version option.
The fundamentals feature's `dependsOn` uses `"ghcr.io/devcontainers/features/git:1": {}` with no version option.
The devcontainer CLI's dependency resolution does not pass options from the dependent feature to the dependency: the git feature will install with its own defaults (which is the latest stable).
This is likely fine (the explicit `"version": "latest"` just sets the default), but worth noting.

## Internal Consistency Check

### BLUF vs Feature Metadata vs Design Decisions

The BLUF (line 19) mentions "declares lace mount metadata for authorized keys, dotfiles, and screenshots as requested mounts."
The feature metadata declares all three.
Decision 6 contradicts by stating the feature does not declare a screenshot mount.
This is the primary blocking inconsistency (covered above).

### Mermaid Diagram vs Init Script

The Mermaid diagram (lines 505-519) correctly shows:
- `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` flowing through the init script to `~/.gitconfig`.
- `GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` flowing directly to git via env vars.
- The dotfiles mount flowing through the init script to chezmoi apply.
- The screenshots mount flowing through lace mount resolution.

This is consistent with the init script code.

### Step Script Variable References

All step scripts correctly reference variables from the orchestrator's scope:
- `ssh-hardening.sh`: `$ENABLE_SSH_HARDENING`, `$SSH_PORT` (both declared in orchestrator).
- `ssh-directory.sh`: `$_REMOTE_USER` (declared in orchestrator).
- `chezmoi.sh`: no orchestrator variables (self-contained).
- `git-identity.sh`: no orchestrator variables (creates a standalone init script).
- `shell.sh`: `$DEFAULT_SHELL`, `$_REMOTE_USER` (both declared in orchestrator).

No missing variable references.

## Verdict

**Revise.** Two blocking issues:

1. The internal contradiction between the feature metadata's screenshots mount declaration and Decision 6's statement that the feature does not declare a screenshot mount.
   This also creates a mount target conflict with the user-level config proposal.
2. The `dotfilesPath` option is declared but never consumed by any script: it is a dead option.

The remaining findings are non-blocking improvements.
The install.sh decomposition is clean, the git dependency addition is correct, the staples list is appropriate, and the project-aware git identity mechanism is well-designed.

## Action Items

1. [blocking] Resolve the screenshots mount contradiction. Remove the `screenshots` mount from the feature metadata (lines 170-177) and update the BLUF, key design points (line 194), and Phase 1 success criteria to reflect that screenshots are a user.json concern per Decision 6. Alternatively, remove Decision 6 and update the user-level config proposal, but Option A is recommended.
2. [blocking] Remove the `dotfilesPath` option from the feature metadata (lines 131-135) and the `DOTFILES_PATH` variable from the orchestrator (line 247). The runtime dotfiles path is determined by lace via `LACE_DOTFILES_PATH` in containerEnv, making this option dead.
3. [non-blocking] Add a concrete `GIT_CONFIG_*` example in `containerEnv` showing how a project overrides git identity.
4. [non-blocking] Update test item 4 to verify `dependsOn` includes both sshd and git (not just sshd).
5. [non-blocking] Add test coverage for staples installation (verify `curl`, `jq`, `less` availability).
6. [non-blocking] Verify that the `readonly` field in feature mount declarations propagates correctly through the mount resolution pipeline during implementation (no existing feature uses this field).
7. [non-blocking] Add a comment in `staples.sh` noting that the `eval` pattern is safe only because `$STAPLES` is a controlled list.
