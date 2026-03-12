---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T23:00:00-06:00
task_list: lace/up-pipeline
type: devlog
state: live
status: wip
tags: [lace-up, validation-architecture, container-verification, git-extensions, docker-no-cache]
related_to:
  - cdocs/proposals/2026-03-11-post-container-git-verification.md
---

# Post-Container Git Extension Verification: Devlog

## Objective

Implement the accepted proposal
`cdocs/proposals/2026-03-11-post-container-git-verification.md`
-- fix broken git extension validation in the `lace up` pipeline by:

1. Removing the extension error from `applyWorkspaceLayout()` (make informational-only)
2. Adding post-`devcontainer up` verification via `docker exec <container> git --version`
3. Passing `--no-cache` to `devcontainer build` when `force` is true

**Key references:**
- Proposal (implementation_wip): `cdocs/proposals/2026-03-11-post-container-git-verification.md`

## Task List

### Phase 1: Core functions + remove error + --no-cache
- [ ] Add `compareVersions()` to workspace-detector.ts
- [ ] Add `ContainerGitVerificationResult` interface to workspace-detector.ts
- [ ] Add `verifyContainerGitVersion()` to workspace-detector.ts
- [ ] Add `getDetectedExtensions()` helper to workspace-detector.ts
- [ ] Export `findBareGitDir` (currently private)
- [ ] Remove extension error block from workspace-layout.ts (lines 201-218)
- [ ] Add `--no-cache` to prebuild.ts when `options.force` is true
- [ ] Type check passes
- [ ] Commit Phase 1

### Phase 2: Pipeline integration
- [ ] Add `containerVerification` to `UpResult.phases` in up.ts
- [ ] Add `resolveContainerName()` to project-name.ts
- [ ] Add verification block in up.ts after devcontainer up
- [ ] Type check passes
- [ ] Commit Phase 2

### Phase 3: Tests (T1-T15)
- [ ] T1: compareVersions basic cases
- [ ] T1b: verifyContainerGitVersion parses version with suffixes
- [ ] T2: verifyContainerGitVersion with adequate git
- [ ] T3: verifyContainerGitVersion with inadequate git
- [ ] T4: verifyContainerGitVersion with git not installed
- [ ] T5: verifyContainerGitVersion with unknown extension
- [ ] T6: verifyContainerGitVersion with multiple extensions, mixed
- [ ] T7: getDetectedExtensions returns extensions for bare-worktree
- [ ] T7b: getDetectedExtensions returns null for normal clone
- [ ] T8: applyWorkspaceLayout no longer errors on extensions
- [ ] T9-T13b: Integration tests in up.integration.test.ts
- [ ] T13c: resolveContainerName tests in project-name.test.ts
- [ ] T14-T15: prebuild --no-cache tests
- [ ] All tests pass
- [ ] Commit Phase 3

## Session Log

### Phase 1 Start

Reading all source files to understand current state...
