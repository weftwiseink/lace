---
review_of: cdocs/proposals/2026-03-20-weftwise-devcontainer-migration.md
first_authored:
  by: "@claude-sonnet-4-6"
  at: 2026-03-20T16:00:00-07:00
task_list: devcontainer/weftwise-migration
type: review
state: archived
status: done
tags: [fresh_agent, architecture, dockerfile, devcontainer, migration]
---

# Review: Weftwise Devcontainer Migration

> BLUF: The proposal is well-structured and internally consistent.
> It correctly identifies all four issues and provides clear implementation phases.
> Two issues require attention before this goes to implementation: the Electron/Playwright pre-install behavior under the WORKDIR change needs explicit documentation, and `migrate_devcontainer_volumes.sh` is missing from the Phase 3 update list.

## Summary Assessment

The proposal targets four known issues in the weftwise devcontainer (workspace path, Dockerfile stale-file shadowing, missing clauthier repoMounts, and CLAUDE_CONFIG_DIR split-brain) and provides a clear four-phase implementation plan.
The analysis is grounded in the audit report and the completed lace migration.
The design decisions section is thorough and well-reasoned.
The main gaps are a missing file in the Phase 3 update list and an underspecified interaction in the Dockerfile phase regarding where the Electron/Playwright pre-installs land after the WORKDIR change.

## Section-by-Section Findings

### BLUF and Summary

No issues.
The BLUF accurately summarizes all four changes and references the audit report for supporting evidence.

### Proposed Solution: Dockerfile (Phase 1)

**Finding: Electron/Playwright pre-install WORKDIR interaction is not addressed.**

The current Dockerfile installs Electron and Playwright at lines 110-114, while `WORKDIR` is `/workspace`.
These installs place `node_modules/electron` and `node_modules/playwright` relative to the current working directory.
After the Phase 1 change (line 72 `WORKDIR /workspace` -> `WORKDIR /build`), these pre-installs will target `/build/node_modules/` instead of `/workspace/node_modules/`.

The subsequent `COPY package.json...` and `pnpm install --frozen-lockfile` (lines 117-118) will also target `/build/`, which is consistent.
However, `node node_modules/electron/install.js` (line 111) references `node_modules/electron` relatively - this should resolve correctly from `/build/node_modules/electron` after the WORKDIR change.

The proposal states "Keep the Electron/Playwright pre-install layers as-is (they install to global pnpm store/node_modules paths)" (Phase 1, step 4).
This is partially true: the binaries are cached in the pnpm content-addressable store, but the `node_modules/electron/` and `node_modules/playwright/` directories are relative to WORKDIR.
The statement as written could lead an implementer to treat these lines as trivially unaffected, when in fact their output location changes.
The behavior is still correct (everything lands at `/build/` consistently), but the explanation is imprecise enough to cause confusion.

**Categorization: non-blocking.**
The migration is functionally correct as written; the explanation just needs a clarifying NOTE.

**Finding: Error log fallback path in Phase 1 step 8.**

The proposal says to update the error log from `/workspace/electron_build_error.log` to `/tmp/electron_build_error.log`.
The actual Dockerfile (line 129) uses `/workspace/electron_build_error.log` as the `cp` target.
Phase 1 step 8 correctly identifies this.

However, the proposed Dockerfile snippet in the "Proposed Solution" section (lines 75-76) shows:
```
RUN pnpm build:electron 2>&1 | tee /tmp/electron_build.log || \
    (echo "WARNING: Electron build failed. See /tmp/electron_build.log" && true)
```
This drops the `cp` of the log to a fallback file entirely, replacing it with just a warning message.
That is a behavior change from the current Dockerfile (which copies the log to a fallback location).
The Phase 1 step 8 description says only "update the log path", but the snippet removes the `cp` step.
There is a minor inconsistency between the snippet and the step description.

**Categorization: non-blocking.**
Dropping the `cp` is fine given the log is already at `/tmp/electron_build.log`, but the step description should clarify this is a simplification, not just a path update.

### Proposed Solution: devcontainer.json (Phase 2)

**Finding: Frontmatter omits `containerEnv` from the snippet.**

The `devcontainer.json` currently has `containerEnv.CLAUDE_CONFIG_DIR` which resolves the mount target for the `claude-code/config` mount.
The proposal snippet for the new devcontainer.json does not show `containerEnv`.
This is acceptable since the snippet is illustrative (it shows only the changes), but a `NOTE` that `containerEnv` is unchanged would prevent ambiguity.

**Categorization: non-blocking.**

**Finding: The `repoMounts` org key uses `weftwiseink` (correct), consistent with the audit.**

Cross-checked against the audit: `github.com/weftwiseink/clauthier`.
The proposal and audit agree.
No issue.

### Proposed Solution: CLAUDE.md and commands (Phase 3)

**Finding: `migrate_devcontainer_volumes.sh` missing from Phase 3 update list.**

The audit report explicitly lists `scripts/migrate_devcontainer_volumes.sh` as containing a `/workspace` reference (Table row: "Scripts").
A search of that file confirms: line 70 references `/workspace` in a comment (`# Container uses /workspace, host uses full path`).

The Phase 3 update list includes `worktree.sh` and `validate_wezterm_ssh.sh` but omits `migrate_devcontainer_volumes.sh`.

**Categorization: blocking.**
The Phase 3 constraint says "Do not modify historical devlogs, proposals, or archived docs" but makes no exception for active scripts.
`migrate_devcontainer_volumes.sh` is an active script and must be addressed.

### Design Decisions

All four decisions are well-reasoned.
The rationale for `/workspaces/weftwise` over multi-stage build is clear.
The `claude-config-json` project-level placement rationale is correct.

### Edge Cases

**Finding: The `scripts/worktree.sh` edge case note is correct but understates the scope.**

The proposal notes `scripts/worktree.sh` "likely uses `/workspace` as a base".
A read of the actual file confirms it does: lines 11, 29, 31, 33, 60, 64 all reference `/workspace` hardcoded.
The edge case note is accurate, but the Phase 3 step 3 says only "hardcoded `/workspace` paths" without enumerating them.
This is acceptable for a proposal; an implementer will find them.

### Test Plan

**Finding: No verification for `migrate_devcontainer_volumes.sh` update.**

The test plan does not include a step to verify the script comment update.
This is minor but should be consistent with the Phase 3 scope.

**Finding: Verification step for clauthier mount uses a host path.**

Verification step 3 says:
```bash
ls /var/home/mjr/code/weft/clauthier/main/
```
This is a host path.
The verification section says "verify inside it" (the container), so this command should be run on the host before entering the container, or it should be the container-internal mirrored path.
The audit says the global `settings.json` uses host-path mirroring with `target: "/var/home/mjr/code/weft/clauthier/main"`.
If that target path is what appears inside the container, then the command is correct as a container-internal check.
The proposal should clarify this is the container-internal path (due to host-path mirroring), not a command to run on the host.

**Categorization: non-blocking.**
Functionally correct given host-path mirroring; just needs a clarifying comment.

### Implementation Phases

**Finding: Phase ordering is correct and dependencies are respected.**
Phase 1 (Dockerfile) and Phase 2 (devcontainer.json) are independent and could be done in either order, but Phase 2 step 4 says to run `lace up` and verify the generated config, which is good practice.
Phase 3 depends on neither Phase 1 nor Phase 2 (it is purely documentation/script updates).
Phase 4 depends on all prior phases.
The sequencing is sound.

**Finding: Phase 2 step 4 says "Run `lace up` (from lace project)".**
This is correct for the weftwise project (since lace manages the weftwise devcontainer), but could confuse an implementer who might run `lace up` from inside the weftwise directory.
A parenthetical clarifying the working directory would help.

**Categorization: non-blocking.**

## Verdict

**Revise.**
The proposal is nearly ready for implementation.
One blocking issue (missing `migrate_devcontainer_volumes.sh` from Phase 3) must be addressed.
The non-blocking issues are clarifications that reduce implementer confusion but do not affect correctness.

## Action Items

1. [blocking] Add `scripts/migrate_devcontainer_volumes.sh` to the Phase 3 update list (step 4 or a new step 4 with renumbering). The file has a hardcoded `/workspace` comment at line 70 that should be updated to `/workspaces/weftwise`.
2. [non-blocking] Clarify Phase 1 step 4 regarding Electron/Playwright pre-installs: note that while the pnpm store is global, the `node_modules/electron` and `node_modules/playwright` directories will land at `/build/node_modules/` after the WORKDIR change, and that this is consistent with the subsequent COPY and pnpm install steps (all targeting `/build/`).
3. [non-blocking] Reconcile the Phase 1 step 8 description ("update the log path") with the proposed Dockerfile snippet (which drops the `cp` fallback entirely). Clarify that the `cp` step is being removed since the log is already captured at `/tmp/electron_build.log`.
4. [non-blocking] Add a NOTE to the devcontainer.json snippet clarifying that `containerEnv` is unchanged.
5. [non-blocking] Add a sentence to the Verification Methodology clarifying that the clauthier mount check (`ls /var/home/mjr/code/weft/clauthier/main/`) is run inside the container and is the container-internal path via host-path mirroring.
6. [non-blocking] Clarify Phase 2 step 4 working directory: e.g., "Run `lace up` from the lace project directory (`/var/home/mjr/code/weft/lace/main/`)".
