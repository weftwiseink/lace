---
review_of: cdocs/proposals/2026-03-26-sprack-devcontainer-feature.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T16:00:00-07:00
task_list: sprack/devcontainer-feature
type: review
state: live
status: done
tags: [fresh_agent, architecture, devcontainer, mount_system, sprack]
---

# Review: Sprack Devcontainer Feature and Host-Side Integration

## Summary Assessment

This proposal designs a devcontainer feature that bind-mounts a per-project sprack data directory into containers, enabling the existing hook bridge to write events to host-visible storage.
The design is sound: it leverages `SPRACK_EVENT_DIR` (already implemented in the hook bridge), follows established lace feature patterns (`customizations.lace.mounts`), and isolates per-project data cleanly.
The most important finding is that the `recommendedSource` path resolution gap is well-identified but the proposed phasing (start with settings override, upgrade to project-name substitution later) creates a real ergonomic regression for early adopters that may not be worth the sequencing convenience.
Verdict: **Accept** with non-blocking suggestions.

## Section-by-Section Findings

### BLUF and Summary

The BLUF is comprehensive and accurately sets expectations.
It correctly identifies the three components (feature, layout, discovery) and explicitly scopes out the Rust code changes and podman-exec migration as companion work.
The prior document references are appropriate.

No issues.

### Objective and Background

The background accurately describes the hook bridge behavior.
I verified the `SPRACK_EVENT_DIR` fallback on line 14 of `sprack-hook-bridge.sh`: the proposal's quote is exact.
The claim about the `claude-code` feature mount pattern is verified against the actual `devcontainer-feature.json`.

No issues.

### Feature Structure (Section 1)

The `devcontainer-feature.json` structure follows established patterns.
The `containerEnv` approach for `SPRACK_EVENT_DIR` is correct: `containerEnv` applies to all processes, which is necessary because Claude Code hooks fire from the Claude process, not through VS Code.
The proposal correctly explains this in the `containerEnv` vs. `remoteEnv` edge case section.

**Finding 1 (non-blocking): `install.sh` missing `chown`.**
The `install.sh` creates directories as root but does not `chown` them to `$_REMOTE_USER`.
The proposal identifies this requirement in the Permissions edge case section ("install.sh should `chown` the mount point to `$_REMOTE_USER`") but the actual `install.sh` code listing does not include it.
This is an internal inconsistency: the body text says to do it, but the code sample omits it.

**Finding 2 (non-blocking): `install.sh` directory creation may be unnecessary.**
The `install.sh` creates `/mnt/sprack/claude-events` and `/mnt/sprack/metadata`, but when the bind mount is active, the host directory overlays `/mnt/sprack/`.
The `mkdir -p` in `install.sh` creates directories on the image layer that get hidden by the bind mount at runtime.
However, this serves as a safety net: if the mount is missing (feature installed but mount not configured), the directories still exist on the container filesystem.
The hook bridge also does `mkdir -p "$EVENT_DIR"` (line 83), so the `claude-events/` subdirectory will be created regardless.
The `install.sh` creation is harmless but the `metadata/` directory is only useful with the bind mount present.
This is fine as-is: just noting the layering.

**Finding 3 (non-blocking): The NOTE callout on `recommendedSource` is thorough but long.**
The NOTE spanning lines 91-97 covers five different approaches in a single callout.
This content is better placed in the "Source path resolution" design decision section (where it is also discussed).
The NOTE could be shortened to reference that section rather than restating the analysis.

### Event Directory Layout (Section 2)

The layout is clean and well-justified.
Per-session JSONL files under `claude-events/` preserve the existing convention.
The `metadata/` subdirectory for the metadata writer is a reasonable namespace.

No issues.

### Host-Side Discovery (Section 3)

The proposed `event_dirs()` function is correct.
I verified the existing code: `default_event_dir()` returns `Some(PathBuf)` at line 391 of `events.rs`, and the call site at line 238 of `main.rs` uses it as a single directory.
The proposal's claim that `find_event_file` and `find_event_file_by_session_id` accept `event_dir: &Path` is verified (lines 201 and 215 of `events.rs`).
The iteration approach (caller loops over `event_dirs()` and tries each) is sound.

**Finding 4 (non-blocking): Session ID collision across directories.**
`find_event_file_by_session_id` does a direct `event_dir.join(format!("{session_id}.jsonl"))` lookup.
If the caller iterates over `event_dirs()` and finds a match in the flat directory, it stops.
But a session that started on the host and then reconnected in a container (or vice versa) could have event files in both directories with the same session ID.
This is an unlikely but possible scenario.
The proposal should note the first-match semantics and whether flat-directory or per-project directories should take priority.

**Finding 5 (non-blocking): `find_event_file` (cwd-based) scanning all directories has performance implications.**
`find_event_file` reads every `.jsonl` file in the directory, parses the last line, and compares cwd.
Scanning N project directories multiplies this cost.
For a small number of projects this is fine, but the proposal should note this scales linearly with the number of active project directories.
In practice, most users will have fewer than 10 projects, so this is unlikely to matter.

### Container-Side Metadata Writer (Section 4)

The metadata writer is clearly scoped as secondary and optional.
The prompt-hook approach is pragmatic.
The NOTE correctly identifies performance concerns and suggests gating behind a feature option.

**Finding 6 (non-blocking): `git diff --quiet` reports dirty status incorrectly for untracked files.**
The `__sprack_metadata` script uses `git diff --quiet` which only checks tracked files.
A repo with only untracked changes would report `"git_dirty": false`.
Using `git status --porcelain` (already mentioned as a performance alternative) would also catch untracked files.
Since this is optional/follow-up work, this is a minor note for the implementation phase.

**Finding 7 (non-blocking): `state.json` is a single file, not per-session.**
If multiple Claude sessions run in the same container (covered in edge cases for events), they share one `state.json`.
The metadata reflects whichever shell prompt ran last, not any specific session.
This is acceptable for the stated use case (current workdir/git state for the container), but the proposal should be explicit that metadata is container-scoped, not session-scoped.

### Important Design Decisions

All four design decisions are well-reasoned and I agree with each:

- `/mnt/sprack/` as mount point: consistent with `lace-fundamentals` pattern (`/mnt/lace/`).
- Per-project host directories: correct for multi-container isolation and project-aware cleanup.
- `SPRACK_EVENT_DIR` pointing to `claude-events/` subdirectory: avoids polluting mount root.
- Source path resolution: the three approaches are correctly ordered by preference.

**Finding 8 (non-blocking): The TODO on line 292 recommends starting with approach 3 (settings override).**
This is pragmatic for unblocking the feature, but it means the first users must manually configure `settings.mounts["sprack/data"].source` for every project.
The proposal should estimate the scope of approach 1 (extending `resolveValidatedSource()` to support `${lace.projectName}`).
Looking at the code, `resolveValidatedSource` at line 310 of `mount-resolver.ts` calls `expandPath(decl.recommendedSource)` which only does tilde expansion.
Adding project-name substitution would require: (a) making `MountPathResolver` aware of a `projectName` string (it already has `projectId`), and (b) adding a `replace()` call in `resolveValidatedSource` before the `expandPath` call.
This is a small change: perhaps 10-15 lines of code plus tests.
If the scope is this small, it may be worth doing in Phase 1 alongside the feature scaffold rather than deferring to Phase 4.

### Edge Cases / Challenging Scenarios

The edge cases are well-covered.
The proposal addresses: multi-session writes, container rebuild persistence, graceful degradation when feature is missing, permissions, metadata performance, and `containerEnv` vs. `remoteEnv`.

**Finding 9 (non-blocking): No cleanup/garbage collection strategy specified.**
The proposal notes "Stale event files should be cleaned up periodically" and that "mtime and `SessionEnd` provide signals for garbage collection," but defers the design.
This is fine for now, but worth noting that per-project directories actually make cleanup easier: `rm -rf ~/.local/share/sprack/lace/<project>/` when a project is decommissioned.
A sentence acknowledging this advantage would strengthen the per-project isolation argument.

### Test Plan

The test plan is thorough, covering four layers: feature build, mount resolution, hook bridge integration, and host-side discovery.
Tests 7-9 (end-to-end) are the highest-value tests and correctly verify the full chain from container write to host read.

No issues.

### Implementation Phases

The five phases are correctly ordered: scaffold, mount resolution, host-side Rust changes, zero-config upgrade, optional metadata writer.
Phases 4 and 5 are correctly marked as optional.

**Finding 10 (non-blocking): Phase 3 depends on sprack-claude, which lives in a different crate.**
The proposal correctly notes that Rust changes are "follow-up work" and "a separate, dependent implementation session."
Phase 3 acceptance criteria should clarify whether existing flat-directory tests should also be run against the new multi-directory path or whether the legacy path is tested separately.
The proposal says "all existing tests pass" which is sufficient, but explicit mention of backward-compatibility testing would be clearer.

## Verdict

**Accept.**

The proposal is well-structured, technically accurate, and makes sound design decisions.
All claims about existing code are verified against the actual implementation.
The per-project isolation approach is correct.
The phasing strategy is pragmatic, with clear optional phases for zero-config and metadata writing.
The identified findings are all non-blocking improvements that can be addressed during implementation.

## Action Items

1. [non-blocking] Add `chown -R "$_REMOTE_USER:$_REMOTE_USER" /mnt/sprack` to the `install.sh` code listing to match the Permissions section's recommendation.
2. [non-blocking] Shorten the NOTE callout at lines 91-97 to reference the "Source path resolution" design decision section rather than restating the full analysis.
3. [non-blocking] Note first-match semantics in the `event_dirs()` discovery change: specify priority order (per-project before flat, or flat before per-project) when the same session ID exists in multiple directories.
4. [non-blocking] Consider collapsing Phase 4 into Phase 1 given the small scope of adding `${lace.projectName}` support to `resolveValidatedSource()`. This would avoid the ergonomic regression of requiring manual settings overrides.
5. [non-blocking] Make `state.json` container-scoped semantics explicit: note that the metadata file reflects the last shell prompt, not any specific Claude session.
6. [non-blocking] Add a sentence to the per-project isolation rationale noting that per-project directories also simplify cleanup (whole-directory deletion when a project is decommissioned).
