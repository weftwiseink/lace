---
review_of: cdocs/proposals/2026-03-24-lace-fundamentals-feature.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-24T22:30:00-07:00
task_list: lace/fundamentals-feature
type: review
state: live
status: done
tags: [rereview_agent, architecture, mount_declarations, internal_consistency, blocking_resolution]
---

# Review (Round 4): Lace Fundamentals Devcontainer Feature

## Summary Assessment

This is a round 4 review focused on verifying that the two blocking issues from round 3 were resolved: the screenshots mount contradiction between feature metadata and Decision 6, and the dead `dotfilesPath` option.
The `dotfilesPath` issue is fully resolved.
The screenshots mount contradiction is substantially resolved (Decision 6 was rewritten, metadata target changed to `/mnt/lace/screenshots`), but two stale path references remain from the incomplete find-and-replace.
These stale references are non-blocking: they are cosmetic errors in a Mermaid diagram and a prose sentence, not in the feature metadata or scripts.
The proposal is otherwise internally consistent and ready for implementation.

**Verdict: Accept** with two non-blocking items to clean up.

## Prior Round Status

### Round 3 blocking issue 1: screenshots mount contradiction

**Resolved with residual stale references.**

The core contradiction is fixed.
Decision 6 (line 614) was rewritten from "The fundamentals feature does not declare a screenshot mount" to "The fundamentals feature declares `dotfiles` and `screenshots` as requested mounts in `customizations.lace.mounts`."
This is now consistent with the feature metadata (lines 165-172) and the BLUF (line 19).

The feature metadata's screenshots mount target was changed from `/mnt/user/screenshots` to `/mnt/lace/screenshots` (line 166).
This eliminates the mount target conflict with the sister proposal's `user/screenshots` mount at `/mnt/user/screenshots`.
The namespaces are now distinct: `lace-fundamentals/screenshots` at `/mnt/lace/screenshots` vs `user/screenshots` at `/mnt/user/screenshots`.

Two stale references to the old path remain:

1. **Mermaid diagram (line 508)**: `H["/mnt/user/screenshots\n(read-only bind mount)"]` should be `/mnt/lace/screenshots`.
2. **Decision 6 prose (line 624)**: "The screenshots mount target (`/mnt/user/screenshots`)" should be `/mnt/lace/screenshots`.

These are cosmetic: the actual feature metadata (the implementable artifact) uses the correct path.

### Round 3 blocking issue 2: dead `dotfilesPath` option

**Fully resolved.**

The `dotfilesPath` option has been removed from the feature metadata (lines 120-136 now contain only `sshPort`, `defaultShell`, `enableSshHardening`).
The `DOTFILES_PATH` variable has been removed from the orchestrator (lines 239-244 now contain only `SSH_PORT`, `DEFAULT_SHELL`, `ENABLE_SSH_HARDENING`, `_REMOTE_USER`, `SCRIPT_DIR`).
The init script (line 395) correctly reads `LACE_DOTFILES_PATH` from the runtime environment, which is the intended mechanism per Phase 3 (line 789).

### Round 3 non-blocking items

Items 3-7 from the round 3 review remain unaddressed.
These are appropriate for the implementer to consider during implementation and do not block acceptance.

## Section-by-Section Findings

### Feature Metadata (lines 112-177)

The metadata is consistent and well-formed.
Three options (`sshPort`, `defaultShell`, `enableSshHardening`), two dependencies (`sshd:1`, `git:1`), and three mount declarations (`authorized-keys`, `dotfiles`, `screenshots`) with correct field usage.
No dead options, no undeclared references.

### Install Script and Step Scripts (lines 203-472)

The orchestrator declares four variables matching the three feature options plus `_REMOTE_USER`.
All step scripts reference only variables that exist in the orchestrator scope.
The step sourcing order is correct for dependency resolution.
No references to removed `dotfilesPath`/`DOTFILES_PATH`.

### Init Script (lines 370-411)

Reads `LACE_DOTFILES_PATH` from environment (not from a build-time option), defaulting to `/mnt/lace/repos/dotfiles`.
This default matches the feature's dotfiles mount target (line 160).
Git identity handling and chezmoi apply logic are unchanged and correct.

### Mermaid Diagrams (lines 498-521)

**Finding (non-blocking): Stale path in environment variable flow diagram.**
Line 508 shows `/mnt/user/screenshots` as the screenshots mount target.
The feature metadata declares `/mnt/lace/screenshots` (line 166).
Update the Mermaid diagram node to match.

### Decision 6 (lines 614-627)

The decision heading and opening paragraph correctly describe the feature as declaring both dotfiles and screenshots mounts.
The rationale paragraphs (lines 619-622) are well-argued.

**Finding (non-blocking): Stale path in Decision 6 body.**
Line 624 states: "The screenshots mount target (`/mnt/user/screenshots`) is namespaced under `lace-fundamentals/screenshots`."
The actual target is `/mnt/lace/screenshots`.
This is a leftover from the revision: the heading and opening were updated but this specific sentence was missed.

### Edge Cases (lines 628-683)

**Finding (non-blocking): "No screenshot mount is injected" (line 639) is slightly misleading.**
The "No user.json configured" edge case states: "No screenshot mount is injected. Tools that reference screenshots get a 'file not found' error."
The feature metadata always declares a `screenshots` mount regardless of user.json.
What is absent without user.json is the mount *source* configuration.
In practice, lace would prompt the user to configure a source for the `lace-fundamentals/screenshots` mount, not silently skip it.
The statement would be more accurate as: "The screenshots mount source is not configured. Lace prompts the user to configure it, or tools that reference screenshots get a 'file not found' error if the mount is skipped."

This is a minor clarity issue, not a functional error.

### Cross-Document Consistency

The sister proposal (`2026-03-24-lace-user-level-config.md`) declares `user/screenshots` at `/mnt/user/screenshots` (line 112).
The fundamentals feature declares `lace-fundamentals/screenshots` at `/mnt/lace/screenshots` (line 166).
These are distinct namespaces targeting distinct paths: no `validateMountTargetConflicts()` collision.

The relationship between the two mounts is: the feature provides a screenshots mount for the container; the user.json provides a user-level screenshots mount.
If both are configured, two bind mounts exist at different container paths.
This is arguably redundant (two mounts for the same host directory at different container paths), but it is valid and conflict-free.
The implementer may want to document that projects should reference `/mnt/lace/screenshots` (from the feature) rather than `/mnt/user/screenshots` (from user.json) for consistency, or consider whether both are truly needed.

## Verdict

**Accept.**

Both round 3 blocking issues are resolved in substance.
The feature metadata, orchestrator, step scripts, init script, design decisions, and test plan are internally consistent.
The two stale path references (Mermaid diagram line 508, Decision 6 line 624) are cosmetic errors that do not affect implementability and can be fixed in-flight.

## Action Items

1. [non-blocking] Update Mermaid diagram line 508: change `/mnt/user/screenshots` to `/mnt/lace/screenshots`.
2. [non-blocking] Update Decision 6 line 624: change `(/mnt/user/screenshots)` to `(/mnt/lace/screenshots)`.
3. [non-blocking] Clarify the "No user.json configured" edge case (line 639): the feature always declares the screenshots mount; what is missing without user.json is the source configuration, which triggers lace's mount setup prompt.
4. [non-blocking, carry-forward from round 3] Add a concrete `GIT_CONFIG_*` example in `containerEnv` showing project-level git identity override.
5. [non-blocking, carry-forward from round 3] Update test item 4 to verify `dependsOn` includes both sshd and git.
6. [non-blocking, carry-forward from round 3] Add test coverage for staples installation.
7. [non-blocking, carry-forward from round 3] Verify `readonly` field propagation through mount resolution pipeline during implementation.
