---
review_of: cdocs/proposals/2026-03-11-weftwise-devcontainer-post-migration-fixes.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T19:30:00-06:00
task_list: lace/weftwise-migration
type: review
state: live
status: done
tags: [fresh_agent, stale_assumptions, missing_coverage, architecture, weftwise, devcontainer]
---

# Review: Weftwise Devcontainer Post-Migration Fixes

## Summary Assessment

This proposal bundles four independent post-migration fixes for the weftwise devcontainer: a critical `.dockerignore` (Fix 1), `CONTAINER_WORKSPACE_FOLDER` injection (Fix 2), git feature version upgrade (Fix 3), and lace Dockerfile cleanup (Fix 4).
Fix 1 is well-diagnosed and correctly addresses the Docker build blocker.
However, the proposal is working from stale assumptions in two significant areas: Fix 2 proposes manually adding `CONTAINER_WORKSPACE_FOLDER` to `containerEnv`, but lace already auto-injects this variable in `up.ts` lines 777-782 (making Fix 2 unnecessary for lace users), and the feature OCI references throughout the proposal use the original migration's `ghcr.io/weftwiseink/lace/` namespace, which has since been replaced by `ghcr.io/weftwiseink/devcontainer-features/` and third-party feature references.
Additionally, the proposal omits several lace improvements that weftwise should adopt: nushell as a prebuild feature (lace uses `ghcr.io/eitsupi/devcontainer-features/nushell:0`), and the shift to Anthropic's official claude-code feature (`ghcr.io/anthropics/devcontainer-features/claude-code:1`) rather than a custom weftwiseink build.

**Verdict: Revise.** Fix 1 is sound and should proceed. Fixes 2-4 need updating to reflect the current state of lace.

## Section-by-Section Findings

### BLUF and Objective

The BLUF is well-structured and clearly communicates the four fixes and their motivation.
The framing as "post-migration follow-ups from the same workstream" is appropriate: these are genuinely cohesive changes that do not warrant four separate proposals.

**Non-blocking:** The BLUF states that all changes are in the weftwise repo "except the Dockerfile cleanup, which is in lace." This is accurate, but the BLUF does not flag that Fix 2 may be unnecessary, which undersells the staleness issue.

### Background: The Docker Build Failure

This section is excellent.
It correctly summarizes the failure analysis report's findings, explains the pnpm symlink mechanism clearly, and properly attributes the root cause to a missing `.dockerignore` rather than a lace migration defect.
No issues.

### Background: WezTerm Workspace Awareness

**Blocking:** This section states that "the weftwise devcontainer.json does not set this variable, so panes open in `/home/node` instead of `/workspace/main`."
This is misleading.
Lace's `generateExtendedConfig()` in `up.ts` lines 773-786 already auto-injects `CONTAINER_WORKSPACE_FOLDER` into the intermediate `.lace/devcontainer.json` when `workspaceFolder` is set and the user has not explicitly defined the variable.
This was implemented as part of the wezterm-server workspace awareness proposal (`cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md`), which reached `implementation_accepted` status.
The code is live:

```typescript
if (
  typeof extended.workspaceFolder === "string" &&
  !containerEnv.CONTAINER_WORKSPACE_FOLDER
) {
  containerEnv.CONTAINER_WORKSPACE_FOLDER = extended.workspaceFolder;
}
```

Since weftwise uses `lace up` and has `customizations.lace.workspace` configured for bare-worktree layout, lace will auto-inject `CONTAINER_WORKSPACE_FOLDER` without any `devcontainer.json` changes.
The only scenario where manual addition would be needed is for non-lace users running raw `devcontainer up`, which is not the weftwise workflow.

### Background: Git Extension Support

This section is accurate and well-reasoned.
The cross-reference to the `rebuild-prebuild-before-validation` proposal is appropriate, and the note about `--skip-validation` as a workaround is honest about the current limitation.

**Non-blocking:** The section mentions the git prebuild feature is configured as `"ghcr.io/devcontainers/features/git:1": {}` without a version pin.
Lace's own devcontainer.json uses `"ghcr.io/devcontainers/features/git:1": { "version": "latest" }` in `prebuildFeatures`, confirming that the proposed fix (Fix 3) is consistent with lace's own configuration.
Good alignment.

### Background: Lace Dockerfile Cleanup

This section correctly identifies that lace's `.devcontainer/Dockerfile` still contains weftwise-specific Electron/Playwright content.
The observation that it works by accident (because `node_modules` lives under `packages/lace/`) is a valuable catch.

**Non-blocking:** The Dockerfile already uses `FROM lace.local/node:24-bookworm` (prebuild image) rather than `FROM node:24-bookworm`.
The proposal's Phase 3 says to "Preserve the `node:24-bookworm` base image" but the actual Dockerfile uses the prebuild base.
This should be reconciled.

### Fix 1: Create `.dockerignore` in Weftwise (Critical)

Well-specified.
The exclusion list is comprehensive, the rationale table is clear, and the entries are consistent with standard Node.js Docker practices.

**Non-blocking:** The proposal places the `.dockerignore` at the repo root, which is correct given `"context": ".."` in the weftwise devcontainer.json.
Edge case E1 correctly notes the coupling between context path and `.dockerignore` location.

### Fix 2: Add `CONTAINER_WORKSPACE_FOLDER` to containerEnv

**Blocking:** As established above, this fix is unnecessary for lace users.
Lace auto-injects `CONTAINER_WORKSPACE_FOLDER` during config generation.
Adding it manually to `containerEnv` would result in the user-defined value taking precedence over lace's injection (which is harmless since they resolve to the same path), but it is redundant work that obscures how the system actually functions.

The `${containerWorkspaceFolder}` devcontainer CLI variable and lace's injected literal path also resolve differently: the devcontainer CLI variable is substituted at container creation time, while lace injects the resolved literal (e.g., `/workspace/main`) during `generateExtendedConfig`.
For bare-worktree layouts they should match, but the distinction matters for understanding the system.

**Recommendation:** Remove Fix 2 entirely, or reclassify it as a documentation note: "Lace auto-injects `CONTAINER_WORKSPACE_FOLDER` via `generateExtendedConfig()`. No weftwise changes needed. Non-lace users can add it manually."

### Fix 3: Upgrade Git Feature to `"version": "latest"`

This fix is straightforward and correct.
The rationale for `"latest"` over a pinned version is sound, and the match with lace's own configuration validates the approach.

**Non-blocking:** The proposal does not mention whether the git feature should be in `prebuildFeatures` only (as in lace's current config) or in both `features` and `prebuildFeatures`.
The failure analysis report notes that weftwise currently has all features in `prebuildFeatures` only, which is the same pattern lace uses.
The proposal should confirm this is the intended structure.

### Fix 4: Simplify Lace's Own Dockerfile

**Blocking:** This fix is in-scope and well-motivated, but the removal list is incomplete.
The current lace Dockerfile (verified at `/var/home/mjr/code/weft/lace/main/.devcontainer/Dockerfile`) also contains:

1. `ARG COMMAND_HISTORY_PATH="/commandhistory"` and associated bash history persistence lines (lines 9, 73-78) that should be evaluated for removal. Lace uses nushell as its primary shell and has a `bash-history` mount declaration for legacy support: the Dockerfile's bash history setup may be redundant with or orthogonal to the mount system.

2. The SSH authorized_keys directory setup (lines 96-99) which the proposal's removal list does not mention but which may be handled by the wezterm-server feature.

3. The Dockerfile's `FROM` line uses `lace.local/node:24-bookworm` (the prebuild image), not `node:24-bookworm` as the proposal states in Phase 3 constraints.

**Non-blocking:** Phase 3 mentions creating a `.dockerignore` for lace "if it does not already exist." Verified: no `.dockerignore` exists in the lace repo. This is a valid addition, especially since lace also uses `"context": ".."` and has a `COPY . .` step.

### Important Design Decisions

The four design decisions are well-reasoned and concise.
The bundling justification (Decision 1) is appropriate.
The `.dockerignore` mirroring `.gitignore` convention (Decision 2) is standard practice.
The `"version": "latest"` rationale (Decision 3) is sound.
The manual cleanup over generation (Decision 4) is pragmatic.

No issues.

### Edge Cases

E1 through E4 are well-considered.
E2 correctly identifies the chicken-and-egg with `--rebuild` and cross-references the companion proposal.

**Non-blocking:** E4 explains that `${containerWorkspaceFolder}` works for both bare-worktree and standard clone layouts, but does not mention that lace's auto-injection makes this edge case moot for lace users.

### Implementation Phases

Phase 1 is clean and independently implementable.

**Blocking (Phase 2):** Phase 2 bundles `CONTAINER_WORKSPACE_FOLDER` addition with the git feature upgrade.
If Fix 2 is removed (per the finding above), Phase 2 simplifies to only the git feature change and should be renamed accordingly.

Phase 3 is well-structured but has the `FROM` image discrepancy noted above.

### Missing Coverage: Feature OCI References

**Blocking:** The proposal uses `ghcr.io/weftwiseink/lace/` as the feature OCI namespace throughout its references (inherited from the original migration proposal).
Lace's own devcontainer.json now uses different references:

| Feature | Original Migration Reference | Current Lace Reference |
|---------|------------------------------|------------------------|
| wezterm-server | `ghcr.io/weftwiseink/lace/wezterm-server:1` | `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1` |
| claude-code | `ghcr.io/weftwiseink/lace/claude-code:1` | `ghcr.io/anthropics/devcontainer-features/claude-code:1` |
| neovim | `ghcr.io/weftwiseink/lace/neovim:1` | `ghcr.io/devcontainers-extra/features/neovim-homebrew:1` |

The claude-code feature migrated to Anthropic's official feature, and neovim migrated to a community homebrew-based feature.
The wezterm-server namespace changed from `/lace/` to `/devcontainer-features/`.
These are breaking changes if weftwise's devcontainer.json still references the old paths.
The proposal should either update weftwise's feature references or confirm that the old references are still valid aliases.

### Missing Coverage: Nushell Prebuild Feature

**Non-blocking:** Lace's own devcontainer.json includes `"ghcr.io/eitsupi/devcontainer-features/nushell:0": {}` in `prebuildFeatures`.
The weftwise migration proposal identifies nushell as the primary shell and declares a `nushell-config` mount.
However, neither the original migration nor this post-migration proposal includes nushell as a prebuild feature.
If weftwise uses nushell as its primary shell, having it available in the prebuild image (matching lace's pattern) would improve the developer experience.
This could be a separate follow-up but is worth noting as a gap.

### Missing Coverage: Lace `.dockerignore`

**Non-blocking:** The proposal mentions creating a lace `.dockerignore` in Phase 3 "if it does not already exist." Verified: it does not exist.
However, this is buried in Phase 3 as a secondary concern.
Given that lace's Dockerfile also uses `COPY . .` with `"context": ".."`, the absence of a `.dockerignore` is the same class of latent bug as the weftwise issue.
Lace currently avoids the problem because `node_modules` lives under `packages/lace/` (outside the context root), but this is fragile.
Consider promoting the lace `.dockerignore` to a first-class fix rather than a parenthetical in Phase 3.

## Verdict

**Revise.** The proposal has three blocking issues:

1. Fix 2 (`CONTAINER_WORKSPACE_FOLDER`) is unnecessary: lace already auto-injects this variable. The fix should be removed or reclassified as documentation.
2. Feature OCI references throughout the proposal use stale `ghcr.io/weftwiseink/lace/` paths that no longer match lace's current configuration. Weftwise's feature references should be updated to match lace's current references.
3. Fix 4's description of lace's Dockerfile base image is incorrect (`node:24-bookworm` vs actual `lace.local/node:24-bookworm`) and the removal list is incomplete.

## Action Items

1. [blocking] Remove Fix 2 or reclassify as a documentation note. Lace auto-injects `CONTAINER_WORKSPACE_FOLDER` via `generateExtendedConfig()` in `up.ts:777-782`. No weftwise `devcontainer.json` changes needed.
2. [blocking] Update all feature OCI references to match lace's current configuration: `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1`, `ghcr.io/anthropics/devcontainer-features/claude-code:1`, `ghcr.io/devcontainers-extra/features/neovim-homebrew:1`. Verify these references are correct for weftwise's feature configuration.
3. [blocking] Correct Fix 4 (Phase 3) to reference `lace.local/node:24-bookworm` as the actual base image and expand the removal list to account for bash history persistence infrastructure and SSH directory setup that may be feature-handled.
4. [non-blocking] Rename Phase 2 to reflect git feature upgrade only (after Fix 2 removal).
5. [non-blocking] Consider adding nushell as a prebuild feature for weftwise, matching lace's `ghcr.io/eitsupi/devcontainer-features/nushell:0` configuration.
6. [non-blocking] Promote lace `.dockerignore` creation from a parenthetical in Phase 3 to a more prominent position, given it addresses the same latent bug class as the critical Fix 1.
7. [non-blocking] Confirm whether weftwise's all-in-`prebuildFeatures` structure (no top-level `features` section) is intentional and compatible with feature entrypoint activation (the failure analysis report flagged this as an open question).

## Questions for the Author

The following items surfaced during review and may benefit from clarification.

**Q1: Are the weftwiseink/lace/ OCI references still valid?**

(a) The old `ghcr.io/weftwiseink/lace/` references are still published and valid alongside the new paths (both work).
(b) The old references have been deprecated and weftwise should migrate to the new paths.
(c) Weftwise was never updated from the original migration and still uses the old references: this proposal should include the migration.

**Q2: Should weftwise adopt Anthropic's official claude-code feature?**

(a) Yes, migrate to `ghcr.io/anthropics/devcontainer-features/claude-code:1` (matching lace).
(b) No, keep the weftwiseink-published claude-code feature for weftwise-specific reasons.
(c) Defer: this is out of scope for the post-migration fixes.

**Q3: Is the SSH authorized_keys directory setup in lace's Dockerfile still needed?**

The wezterm-server feature's `install.sh` creates runtime directories and SSH infrastructure.
Lines 96-99 of lace's Dockerfile also create `/home/node/.ssh` with correct permissions.
Is this still needed, or does the feature now handle it?

(a) The Dockerfile SSH setup is still needed (the feature does not create per-user `.ssh`).
(b) The feature handles it: the Dockerfile lines can be removed in Fix 4.
(c) Unsure: needs investigation.
