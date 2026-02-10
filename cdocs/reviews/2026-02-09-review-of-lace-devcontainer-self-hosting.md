---
review_of: cdocs/proposals/2026-02-09-lace-devcontainer-self-hosting.md
first_authored:
  by: "claude-opus-4-6"
  at: "2026-02-09T12:15:00-08:00"
task_list: devcontainer/self-hosting
type: review
state: archived
status: done
tags: [self, architecture, port-allocation, blocking-finding]
---

# Review: Migrate Lace Devcontainer to Lace Idioms (Self-Hosting)

## Summary Assessment

This proposal addresses a real and important gap: the lace monorepo's own devcontainer is invisible to lace's tooling because it uses a hardcoded port outside the discovery range. The background analysis, edge cases, and follow-up scoping are thorough. However, the proposal has one critical blocking issue: the proposed feature placement (moving wezterm-server entirely to `prebuildFeatures` and removing it from `features`) will break port auto-injection, because the `up.ts` pipeline only reads feature IDs from the `features` block for metadata fetch and auto-injection. Verdict: **Revise**.

## Section-by-Section Findings

### BLUF

Clear and comprehensive. Accurately summarizes the problem, approach, and scope boundaries. The mention of `open-lace-workspace` as out-of-scope is appropriate. No issues.

### Background

Well-structured with concrete line references to the current Dockerfile and devcontainer.json. The "How lace port provisioning works" section accurately describes the pipeline. The "Scripts that reference port 2222" section correctly identifies `open-lace-workspace` as the main casualty. No issues.

### Proposed Solution -- Section 1: devcontainer.json changes

**[blocking]** The proposal moves `git:1`, `sshd:1`, and `wezterm-server:1` entirely from `features` to `customizations.lace.prebuildFeatures`, leaving only `claude-code`, `neovim`, and `nushell` in `features`. This breaks port auto-injection.

Evidence from the code:

1. `packages/lace/src/lib/up.ts` lines 120-125 extract `featureIds` from `configMinimal.raw.features` (the standard `features` key only).
2. `autoInjectPortTemplates()` in `template-resolver.ts` lines 88-94 iterates over `config.features` only.
3. `validateNoOverlap()` in `validation.ts` explicitly prevents the same feature from appearing in both `prebuildFeatures` and `features`.

Result: with wezterm-server only in `prebuildFeatures`, no `${lace.port()}` template is auto-injected, no port is allocated, and no `appPort` is generated. The container would start with no SSH port exposed.

The dotfiles devcontainer currently demonstrates this exact gap -- its generated `.lace/devcontainer.json` contains no `appPort`, `forwardPorts`, or `portsAttributes` entries. The port assignment file exists (`.lace/port-assignments.json` with port 22426) but the generated config does not use it. This suggests the dotfiles container may also have a port provisioning issue, or the port is used by some other mechanism not visible in the generated config.

**Fix:** Keep `wezterm-server` (and `sshd`) in the standard `features` block so auto-injection works. Do NOT put them in `prebuildFeatures` unless the `up.ts` pipeline is also updated to read feature IDs from both blocks. `git:1` can move to `prebuildFeatures` (it has no port declarations). Alternatively, add a `customizations.lace` section alongside the features to signal lace awareness without moving features out of the standard block.

### Proposed Solution -- Section 2: Dockerfile changes

Reasonable. Removing the SSH dir setup and wezterm COPY is correct IF the sshd feature reliably creates `.ssh` directories for the container user. The proposal correctly notes this as an edge case to verify.

**[non-blocking]** The sshd feature behavior should be verified before implementation. If the sshd feature does NOT create `.ssh/` for the `node` user (it may only configure sshd itself, not per-user directories), the mount for `authorized_keys` will fail. A quick check of the sshd feature's install script would confirm.

### Proposed Solution -- Section 3: Container-side wezterm.lua

The `default_cwd` fix from `/workspace/lace` to `/workspace/main` is correct. Using a bind mount instead of COPY is a reasonable improvement.

**[non-blocking]** The mount path `source=${localWorkspaceFolder}/.devcontainer/wezterm.lua` assumes `localWorkspaceFolder` resolves to the repo root. Given the `workspaceMount` maps `${localWorkspaceFolder}/..` to `/workspace`, `localWorkspaceFolder` should be the `main/` worktree directory, which contains `.devcontainer/`. This should work but is worth noting: if the devcontainer is opened from a different worktree, the mount source would change.

### Design Decisions

The design decisions are well-reasoned except for the prebuildFeatures rationale (covered in the blocking finding above). The decision to fix `default_cwd` is a good catch. The decision to defer `open-lace-workspace` is appropriate.

### Edge Cases

Thorough. The SSH authorized_keys mount concern is the most important practical risk.

### Implementation Phases

Clear and sequential. Phase 4 (manual verification) is appropriate for devcontainer changes that cannot be unit tested.

## Verdict

**Revise.** The core feature placement strategy must be corrected before implementation. The proposal's claim that moving wezterm-server to `prebuildFeatures` enables auto-injection is incorrect -- it disables it. The fix is straightforward: keep port-declaring features in the `features` block. The rest of the proposal (removing `appPort`, Dockerfile cleanup, wezterm.lua mount, `default_cwd` fix) is sound.

## Action Items

1. [blocking] Keep `wezterm-server:1` and `sshd:1` in the standard `features` block (not `prebuildFeatures`). Only `git:1` can safely move to `prebuildFeatures` since it has no port declarations. Update the proposal solution, design decisions, and implementation phases accordingly.
2. [non-blocking] Add a note about the `customizations.lace` section: it can still exist (for future `repoMounts` or other lace config) without needing `prebuildFeatures` to hold the port-declaring features.
3. [non-blocking] Verify that the devcontainers/features sshd feature creates per-user `.ssh` directories for non-root users. If not, the Dockerfile SSH dir setup removal needs a guard.
4. [non-blocking] Clarify the `localWorkspaceFolder` mount path interaction with worktrees -- confirm the source path is correct when opening from the `main/` worktree.
