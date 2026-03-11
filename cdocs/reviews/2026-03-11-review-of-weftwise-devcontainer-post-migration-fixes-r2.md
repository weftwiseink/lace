---
review_of: cdocs/proposals/2026-03-11-weftwise-devcontainer-post-migration-fixes.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T21:00:00-06:00
task_list: lace/weftwise-migration
type: review
state: live
status: done
tags: [rereview_agent, weftwise, devcontainer, mounts, features, containerEnv, architecture]
---

# Review (Round 2): Weftwise Devcontainer Post-Migration Fixes

## Summary Assessment

The proposal has been substantially rewritten since round 1 and addresses all three blocking issues from that review: Fix 2 (unnecessary `CONTAINER_WORKSPACE_FOLDER`) was removed, feature OCI references now correctly use `@weftwiseink` namespaces, and Fix 4's base image reference is corrected.
The rewritten proposal is well-structured, with a clear BLUF, strong background sections, and a well-scoped four-fix plan.
The most important finding in this round concerns Fix 3 (`CLAUDE_CONFIG_DIR` template): investigation of `up.ts`'s `generateExtendedConfig()` confirms that lace does NOT auto-inject `CLAUDE_CONFIG_DIR` from feature mount metadata, so Fix 3 is genuinely necessary.
One minor structural concern remains around the Dockerfile cleanup scope.

**Verdict: Accept** with non-blocking suggestions.

## Round 1 Action Item Resolution

| # | Round 1 Action Item | Status |
|---|---|---|
| 1 | [blocking] Remove Fix 2 (`CONTAINER_WORKSPACE_FOLDER`) | Resolved. Fix 2 removed entirely. |
| 2 | [blocking] Update feature OCI references to match lace | Resolved. Proposal correctly keeps `@weftwiseink` features and explains why. |
| 3 | [blocking] Correct Fix 4 base image and removal list | Resolved. Fix 4 now references `lace.local/node:24-bookworm` and specifies keep/remove lists. |
| 4 | [non-blocking] Rename Phase 2 after Fix 2 removal | Resolved. Phase structure reorganized into three phases with four fixes. |
| 5 | [non-blocking] Add nushell as a prebuild feature | Resolved. Fix 2 now includes adding nushell. |
| 6 | [non-blocking] Promote lace `.dockerignore` | Resolved. Now part of Fix 4 (Phase 3). |
| 7 | [non-blocking] Confirm all-in-prebuildFeatures structure | Not explicitly addressed, but the proposal's Fix 2 example shows features only in `prebuildFeatures`, consistent with weftwise's existing pattern. |

## Key Investigation: Fix 3 (CLAUDE_CONFIG_DIR) Necessity

The user's review prompt raised an important question: does lace already auto-inject `CLAUDE_CONFIG_DIR` from the `@weftwiseink` claude-code feature metadata, making Fix 3 unnecessary?

**Finding: Fix 3 is necessary.** Investigation of `up.ts:773-786` shows that `generateExtendedConfig()` auto-injects exactly two `containerEnv` variables:

```typescript
// Auto-inject standard container env vars for feature workspace awareness.
const containerEnv = (extended.containerEnv ?? {}) as Record<string, string>;
if (typeof extended.workspaceFolder === "string" && !containerEnv.CONTAINER_WORKSPACE_FOLDER) {
  containerEnv.CONTAINER_WORKSPACE_FOLDER = extended.workspaceFolder;
}
if (options.projectName && !containerEnv.LACE_PROJECT_NAME) {
  containerEnv.LACE_PROJECT_NAME = options.projectName;
}
```

No `CLAUDE_CONFIG_DIR` injection exists anywhere in the lace source (confirmed via grep across `packages/lace/src/lib/`).
Lace's own `devcontainer.json` explicitly declares `"CLAUDE_CONFIG_DIR": "${lace.mount(project/claude-config).target}"` in its `containerEnv` block, confirming that this is a manual declaration, not an auto-injected value.

The mount template system auto-injects mount *specs* (the Docker `--mount` flags) from feature metadata, but it does not auto-inject `containerEnv` entries that reference those mounts.
The `containerEnv` declaration is a separate concern: mount auto-injection ensures the filesystem binding exists; `containerEnv` ensures the application (Claude Code) knows where to look.

The proposal's Fix 3 replaces `"/home/node/.claude"` with `"${lace.mount(claude-code/config).target}"`, which is the correct lace-idiomatic approach.
The mount namespace `claude-code/config` (from the `@weftwiseink` feature's metadata) is correctly identified and distinct from lace's own `project/claude-config` namespace.

## Section-by-Section Findings

### BLUF and NOTE Callout

The BLUF is clear and comprehensive.
The NOTE callout documenting the round 1 rewrite history is well-placed and follows the history-agnostic framing convention correctly: it uses a callout rather than in-line narrative.

**Non-blocking:** The BLUF lists five issues ("manual mount override strings", "hardcodes CLAUDE_CONFIG_DIR", "pins git to Debian's 2.39.x", "missing nushell prebuild feature", "lace Dockerfile contains weftwise content") but the proposal has four fixes.
The first two BLUF items map to Fixes 1 and 3 respectively, which is clear, but the numbering asymmetry is worth noting.

### Background: Mount Override Workaround

This section is excellent.
It correctly explains the `_REMOTE_USER` resolution history, references the implementing commit (`b69475f`), and properly notes that the manual overrides were a workaround that is no longer needed.
The NOTE callout comparing lace's project-level mount approach vs. weftwise's feature-level mount approach is a valuable distinction for future readers.

### Background: Why Weftwise Uses @weftwiseink Features

This section directly addresses round 1's blocking issue about feature OCI references.
It clearly explains the purpose of the custom features (carrying `customizations.lace.mounts` and `customizations.lace.ports` metadata) and why switching to official/community features would lose lace integration.
The reference to feature source paths is helpful for implementers.

### Background: Template Usage for containerEnv

This section is accurate.
The comparison between lace's `project/claude-config` namespace and weftwise's `claude-code/config` namespace is correctly explained.
The rationale for preferring the template form (resilience to user/path changes) is sound.

### Background: Git Extension Support

Accurate and well-referenced.
The cross-reference to `rebuild-prebuild-before-validation` is appropriate, and the `--skip-validation` workaround is honestly presented.

### Background: Missing Nushell Feature

Clean and correctly scoped.
Addresses round 1's non-blocking suggestion to add nushell.

### Background: Lace Dockerfile Cleanup

This section correctly identifies the problem: lace's Dockerfile was copied from weftwise and still contains Electron/Playwright content.
The `FROM lace.local/node:24-bookworm` base image is correctly noted (addressing round 1's blocking issue about base image reference).

### Fix 1: Remove Manual Mount Overrides

Well-specified.
The before/after comparison is clear.
The "after" state uses comments to document what the auto-injected mounts will be, which is a good practice for maintainability.

### Fix 2: Upgrade Git Feature and Add Nushell

The combined fix is well-structured.
The change summary (git version, drop version pins, add nushell) is clear.

**Non-blocking:** The proposal drops the version pin on the neovim feature (`v0.11.6`), but the `@weftwiseink` neovim feature's `devcontainer-feature.json` has `"default": "v0.11.6"` as the option default.
Dropping the pin in `devcontainer.json` means the feature's internal default (`v0.11.6`) takes effect.
This is functionally equivalent to the current behavior and the proposal's stated intent (prebuild cache provides stability) still holds, but the mechanism is different from what the text implies: "the installed tool version is whatever the feature's install script resolves" is true, and the default is the feature's own `v0.11.6`, not "latest."
This is not a problem, just worth noting for accuracy.

### Fix 3: Use Mount Template for CLAUDE_CONFIG_DIR

As established in the investigation above, this fix is necessary and correctly specified.
The mount namespace `claude-code/config` is correct per the feature metadata.

### Fix 4: Simplify Lace's Own Dockerfile

The keep/remove lists are comprehensive and match the actual Dockerfile content at `/var/home/mjr/code/weft/lace/main/.devcontainer/Dockerfile`.
Verified against the current Dockerfile:

**Remove list accuracy:**
- `ARG ELECTRON_VERSION`, `ARG PLAYWRIGHT_VERSION`: present on lines 4-5. Correct.
- Playwright/Chromium/Electron apt dependencies: present on lines 31-55. Correct.
- `xvfb`, `xauth`, GTK deps: present on lines 50-54. Correct.
- Electron pre-install: present on lines 119-120. Correct.
- Playwright pre-install: present on lines 122-123. Correct.
- `pnpm build:electron` step: present on lines 135-139. Correct.
- Sculptor TODO comments: present on lines 141-144. Correct.

**Keep list accuracy:**
- `FROM lace.local/node:24-bookworm`: line 2. Correct.
- System tools (`curl`, `psmisc`, `sudo`): these are in the same `apt-get install` block as the Playwright deps (lines 27-56). The implementation will need to rewrite the `apt-get install` command to keep only `curl`, `psmisc`, `sudo` and remove the rest. The proposal does not call this out explicitly. This is a minor implementation detail, not a blocking concern.
- Corepack/pnpm setup: lines 62-63. Correct.
- Git-delta install: lines 84-87. Correct.
- Bash history persistence: lines 73-78. Correct.
- SSH authorized_keys setup: lines 94-99. Correct.
- Passwordless sudo: lines 101-104. Correct.
- npm global directory: lines 66-67, 110-111. Correct.
- `COPY` and `pnpm install --frozen-lockfile`: lines 126-127. Correct.

**Non-blocking:** The `.dockerignore` addition in Fix 4 is appropriate.
The proposal states "prevent the same latent COPY . . bug class that affected weftwise."
Lace does have `COPY --chown=${USERNAME}:${USERNAME} . .` on line 133, confirming the risk.

**Non-blocking:** Lines 129-133 of the Dockerfile contain Electron-specific comments and the `COPY . .` step.
The `COPY . .` step is presumably still needed for lace's own source (for `pnpm install --frozen-lockfile` to work with the full workspace), but the Electron-related comments on lines 129-130 should be removed as part of this cleanup.
The proposal's "Sculptor TODO comments" removal covers lines 141-144 but does not explicitly mention the Electron binary comment on lines 129-130.
This is a minor omission.

### Important Design Decisions

All four decisions are well-reasoned:

1. **Keep @weftwiseink features:** Correctly justified. Addresses round 1's core misunderstanding.
2. **Drop feature version pins:** Sound reasoning about prebuild cache stability.
3. **Git "latest":** Consistent with lace's own configuration.
4. **Add nushell feature:** Clean rationale following lace's convention.

### Edge Cases

E1 through E4 are well-considered and practical.

E2 (nushell config conflict) correctly identifies the bind mount overlay behavior.
E4 (mount template resolution depends on metadata fetch) correctly notes this is an existing risk, not a new one.

### Implementation Phases

The three-phase structure is clean, with each phase independently implementable.
Verification steps are concrete and testable.
Constraints are appropriate (phase isolation prevents cascading failures).

**Non-blocking:** Phase 2 verification says "`lace up` (or `lace up --skip-validation`) succeeds."
Given that Phase 1 upgrades git and Phase 2 removes mount overrides, by the time Phase 2 runs the container should already have the new git version.
The `--skip-validation` parenthetical may no longer be needed if Phase 1 was completed with a successful rebuild.
This is a minor point.

## Verdict

**Accept.** The proposal has addressed all three blocking issues from round 1.
The rewrite correctly retains `@weftwiseink` features, removes the unnecessary `CONTAINER_WORKSPACE_FOLDER` fix, and corrects the Dockerfile base image reference.
Fix 3 (`CLAUDE_CONFIG_DIR` template) has been validated as necessary: lace does not auto-inject this env var from feature metadata.
The remaining suggestions are non-blocking and can be addressed during implementation.

## Action Items

1. [non-blocking] Consider noting in Fix 2's text that dropping the neovim version pin still results in `v0.11.6` being installed (the feature's internal default), not "latest." The prebuild-cache-provides-stability reasoning is still correct, but the mechanism is the feature's default value, not dynamic resolution.
2. [non-blocking] During Fix 4 implementation, rewrite the `apt-get install` block (currently lines 27-56) to keep only `curl`, `psmisc`, `sudo` and remove all Playwright/Chromium/Electron/GTK dependencies. Also remove the Electron binary comment on lines 129-130.
3. [non-blocking] Phase 2 verification's `--skip-validation` parenthetical can likely be dropped if Phase 1 was completed with a successful `--rebuild`.
