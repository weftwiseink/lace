---
review_of: cdocs/proposals/2026-02-09-lace-devcontainer-self-hosting.md
first_authored:
  by: "claude-opus-4-6"
  at: "2026-02-09T10:00:00-08:00"
task_list: devcontainer/self-hosting
type: review
state: live
status: done
tags: [self, rereview_agent, prebuild_split, port-allocation, implementation_verification]
---

# Review R4: Migrate Lace Devcontainer to Lace Idioms (Self-Hosting)

## Prior Review Status

R1/R2 (same document, `cdocs/reviews/2026-02-09-review-of-lace-devcontainer-self-hosting.md`) identified a blocking issue: the original proposal moved wezterm-server to `prebuildFeatures`, which would break port auto-injection. The fix was applied. R3 was user feedback requesting: (a) move git and sshd to `prebuildFeatures`, (b) delete `open-lace-workspace`, (c) update the proposal. All three have been addressed.

Prior action items and resolution:
1. **[blocking] Keep wezterm-server in features** -- RESOLVED. wezterm-server stays in `features`. git and sshd moved to `prebuildFeatures` (non-port features).
2. **[non-blocking] Add note about customizations.lace** -- RESOLVED. The `lace` section now contains `prebuildFeatures` rather than being empty.
3. **[non-blocking] Verify sshd feature creates .ssh dirs** -- RESOLVED. Proposal and Dockerfile correctly note that sshd does NOT create per-user `.ssh` dirs. The Dockerfile SSH dir setup is retained.
4. **[non-blocking] Clarify localWorkspaceFolder mount path** -- NOT ADDRESSED but low priority. The mount works correctly when opened from the main/ worktree, which is the documented workflow.

## Summary Assessment

The revised proposal addresses all prior blocking feedback and incorporates the user's R3 requests. The feature split (git/sshd to `prebuildFeatures`, wezterm-server/claude-code/neovim/nushell in `features`) is correctly motivated by the port auto-injection constraint. The `open-lace-workspace` deletion is well-justified. The implementation matches the proposal. One minor inconsistency between the proposal's Dockerfile section and the actual Dockerfile state needs correction. Verdict: **Accept**.

## Section-by-Section Findings

### BLUF

Comprehensive and accurate. Covers all five changes (prebuildFeatures split, appPort template, bind mount, default_cwd fix, open-lace-workspace deletion). The NOTE about R1/R2/R3 review history provides useful context.

No issues.

### Background -- Current State

**[non-blocking]** The "Current state" section describes the pre-migration state. The new bullet point about `bin/open-lace-workspace` is a good addition. However, the bullet about "Dockerfile SSH setup (lines 93-98)" references line numbers from the pre-migration Dockerfile. Since the proposal is now describing both the problem and the solution, the line references are still valid for the "current state" description (they refer to the original file, not the modified one).

### Background -- How lace port provisioning works

The NOTE has been updated to correctly distinguish between port-declaring features (must stay in `features`) and non-port features (can live in either block). This is accurate and well-stated.

### Proposed Solution -- Section 1: devcontainer.json

The code block now shows the correct split:
- `prebuildFeatures`: git, sshd (no port metadata)
- `features`: claude-code, neovim, nushell, wezterm-server (port metadata)

**Verified against implementation:** The actual `.devcontainer/devcontainer.json` matches the proposal exactly. The `prebuildFeatures` block contains git:1 and sshd:1. The `features` block contains claude-code:1, neovim-homebrew:1, nushell:0, and wezterm-server:1 with the version pin. The appPort uses the asymmetric template. JSONC validated programmatically.

The "feature split rationale" paragraph is clear and accurate. The NOTE about `validateNoOverlap()` is a good addition.

No issues.

### Proposed Solution -- Section 2: Dockerfile changes

**[non-blocking]** Minor inconsistency: the proposal says "Remove the wezterm config directory creation and COPY" but the actual Dockerfile retains the wezterm config directory creation (lines 100-104) because the bind mount target directory needs to exist. The COPY was removed, but the `mkdir -p` and `chown` for `.config/wezterm` remain. The proposal's code block shows the wezterm lines as "# REMOVE" commented out, which is misleading -- only the COPY was removed, the mkdir/chown stay. The Implementation Phase 2 correctly says "Keep the wezterm config directory creation (mount target needs to exist) but remove the COPY," which contradicts the code block.

### Proposed Solution -- Section 3: wezterm.lua

Correct. The bind mount approach and `default_cwd` fix are well-motivated.

### Design Decisions -- Split features between prebuildFeatures and features

Well-reasoned with two clear principles. The comparison to the dotfiles devcontainer pattern is accurate. The note about the dotfiles container sidestepping the port constraint is an important observation.

### Design Decisions -- Delete open-lace-workspace

Justified. Gen 2 tooling supersedes it, the port migration breaks it, and historical cdocs references are correctly left as archives.

### Edge Cases

**Prebuild image rewrites Dockerfile FROM**: This is an important new section. The claim that `lace prebuild` will rewrite `FROM node:24-bookworm` to `FROM lace.local/node:24-bookworm-...` is correct -- verified against `prebuild.ts` lines 113-158 and 304-306. The `up.ts` pipeline runs prebuild (lines 276-296) before generating the extended config (lines 324-347), so the Dockerfile FROM is rewritten before `devcontainer up` is invoked.

### Implementation Phases

Phase 4 (Delete open-lace-workspace) is a good addition. Phase 5 (verification) is appropriate for manual testing.

## Verdict

**Accept.** All prior blocking issues are resolved. The feature split is correctly motivated by the port auto-injection constraint. The implementation matches the proposal (verified against actual file contents). The one non-blocking finding (Dockerfile section code block vs. actual state) is cosmetic and does not affect correctness.

## Action Items

1. [non-blocking] Update the Dockerfile section code block in the proposal to accurately reflect that the wezterm config directory creation (`mkdir -p`, `chown`) is KEPT (only the COPY is removed). The current code block shows both as "# REMOVE" which is misleading since the Implementation Phases section correctly says "Keep the wezterm config directory creation."
2. [non-blocking] Consider adding a note about the `localWorkspaceFolder` mount behavior with worktrees (carried over from R1 -- low priority since the worktree workflow is documented).
