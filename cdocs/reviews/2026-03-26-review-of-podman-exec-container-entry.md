---
review_of: cdocs/proposals/2026-03-26-podman-exec-container-entry.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T16:30:00-07:00
task_list: lace/podman-migration
type: review
state: live
status: done
tags: [fresh_agent, architecture, migration, podman, ssh, test_plan, sprack]
---

# Review: Podman Exec Container Entry: SSH Replacement

## Summary Assessment

This proposal designs the migration of lace's container entry tooling from SSH to `podman exec`, replacing the port-based container identity model with a name-based one.
The proposal is thorough, well-structured, and grounded in a detailed viability report.
The container identification strategy via `@lace_container` is sound and addresses the root cause of the tmux metadata staleness problem.
The most significant finding is that the sprack integration boundary section contains a factual error about the database column type, and the proposal underspecifies a subtle but important edge case around container name stability during `devcontainer up --remove-existing-container` flows.
Verdict: **Revise** - a small number of blocking issues need resolution, but the core design is strong.

## Section-by-Section Findings

### BLUF and Summary

The BLUF is effective: it communicates the scope, the transport change, the metadata shift, and the explicit exclusions (WezTerm, sprack code, backwards compatibility).
The summary correctly references the viability report and stale metadata RFP as context documents.

**Non-blocking**: The BLUF states "six bin scripts" but the proposal body covers `lace-into`, `lace-split`, `lace-disconnect-pane`, `lace-paste-image`, `lace-inspect`, and `lace-discover`.
That is indeed six, but `lace-discover` is a discovery tool rather than an "entry" tool.
Consider clarifying as "six bin scripts (four entry scripts, discovery, and inspection)" for precision.

### Container Runtime Abstraction (Section 1)

The `resolve_runtime()` helper is sensible.
However, `lace-discover` currently hardcodes `docker` (line 44 and throughout), and `lace-inspect` also hardcodes `docker` (lines 26, 31, 103, etc.).
The proposal should note that these scripts also need the `$RUNTIME` variable, not just `lace-into` and `lace-split`.

**Non-blocking**: The `resolve_runtime()` function prefers `podman` over `docker`.
On systems with `podman-docker` (which provides a `docker` symlink), both will be found.
The preference order should be documented with a rationale.
A more robust approach: check for `podman` first only if `podman` is the actual runtime (not just present), or check which one actually has a running daemon via `$cmd info`.

### lace-discover: Label-Based Discovery (Section 2)

The removal of the SSH port range scan as a container filter is the key change.
The current `lace-discover` (verified in source) skips containers without a valid SSH port in the 22425-22499 range (line 87: `[[ -z "$ssh_port" ]] && continue`).
Removing this filter means containers without SSH ports become discoverable, which is the correct behavior for the podman exec model.

**Non-blocking**: The proposal says JSON mode drops `port` and adds `container_name`.
The current JSON output includes `container_id` (line 126-127 of `lace-discover`).
The new format should clarify whether `container_id` is retained alongside `container_name`.
The proposal's JSON example includes both, which is correct.

### lace-into: Core Transport Swap (Section 3)

The proposal accurately describes the current `do_connect()` and `do_connect_pane()` functions (verified against source lines 468-609 and 612-683).
The replacement of SSH arg arrays with exec args is straightforward.

**Blocking**: The proposal claims "container name does not change on container restart (only on full remove+recreate)."
This is correct for `docker stop`/`docker start`.
However, `lace up` calls `devcontainer up`, which by default uses `--remove-existing-container` behavior when certain config changes are detected.
The proposal acknowledges this in the Design Decisions section ("Container IDs change on every `devcontainer up --remove-existing-container`, but the name is re-derived from the same project name") but does not address the timing window: between `docker rm` and `docker run --name`, the container name does not exist.
If `lace-split` or `lace-paste-image` fires during this window, `podman exec` fails.
With SSH, the same failure occurred (port unreachable), but the proposal should explicitly acknowledge this transient failure window and confirm it is acceptable.
The dead pane recovery mechanism handles the post-rebuild reconnection, but the proposal should state this explicitly for the rebuild case, not just the stop/start case.

**Non-blocking**: The session collision disambiguation currently appends the port (`project-22425`).
The proposal mentions container ID fragment as a replacement, but the Open Questions section (item 3) also raises this.
The proposal should settle on a specific disambiguation suffix (e.g., first 8 chars of container ID) rather than leaving it open.

### lace-split: Podman Exec Splits (Section 4)

The WARN callout about losing `pane_current_command == "ssh"` fallback is appropriate.
The detection change is clean.

**Non-blocking**: The code example (line 188) uses `--user "${user:-node}"` as a default.
The current `lace-discover` also defaults to `node` (line 113).
The proposal should note whether this default should be consistent with the user resolution in `lace-discover` (which uses `remoteUser` -> `Config.User` -> `node`).
If `@lace_user` is empty, falling back to `node` may be incorrect for containers with a `vscode` user.
The current `lace-split` (line 67) also does `${user:-node}`, so this is not a regression, but the migration is a good opportunity to improve this.

### lace-disconnect-pane (Section 5)

Correctly describes clearing `@lace_container` instead of `@lace_port`.
No issues.

### lace-paste-image: podman cp (Section 6)

The replacement of SCP with `podman cp` is clean.
The current `lace-paste-image` (verified in source) uses `pane_current_command == "ssh"` for detection (line 21) and `@lace_port` for metadata (line 27).

**Non-blocking**: The nushell code example uses `lace-option` for `@lace_container` but the current implementation's `lace-option` function (lines 78-85) does pane-level then session-level fallback.
The proposal should confirm this fallback behavior is preserved for `@lace_container` in the new implementation.
Session-level fallback could return the wrong container if `lace-into --pane` connected to a different container.

### lace-fundamentals Feature Cleanup (Section 7)

The feature JSON (verified in source) does include `sshd:1` in `dependsOn`, the `sshPort` option, and the `authorized-keys` mount.
The proposal correctly identifies all items to remove.

**Non-blocking**: The proposal lists retained steps but omits `steps/shell.sh` and `steps/chezmoi.sh` from the explicit retained list.
Wait, re-reading: the proposal does list `steps/staples.sh`, `steps/chezmoi.sh`, `steps/git-identity.sh`, and `steps/shell.sh`.
This matches the current `install.sh` minus the two SSH steps. Correct.

**Non-blocking**: The proposal says to bump to version `2.0.0`.
The description field in `devcontainer-feature.json` references "hardened SSH" as a capability.
This description needs updating too, which is not mentioned.

### lace-inspect (Section 8)

The sshd check removal is correct (verified at lines 218-224 of `lace-inspect`).
The replacement with `$RUNTIME exec $name echo ok` is a reasonable connectivity check.

### tmux Metadata Analysis

The analysis is thorough and accurate.
The table of current readers for `@lace_port` matches the source code.

**Blocking**: The "Container name derivability from tmux session name" subsection correctly identifies that `@lace_container` is redundant with the session name in the common case, and correctly explains why pane-level metadata is still needed.
However, the proposal does not address what happens to `@lace_container` during `lace-into --pane` when the session was created by `lace-into <project>` for a different container.
The pane-level `@lace_container` would be set to the new container, but the session-level `@lace_container` would still reference the original session's container.
This is the same semantic as the current `@lace_port` behavior, but should be explicitly confirmed as intentional.

### Edge Cases

**Container not running**: adequately covered.

**Container name collision**: The proposal states "Docker/podman rejects the second `docker run --name X` if a container with that name exists."
This is correct for a running container with that name, but if the old container is stopped (not removed), the name collision also occurs.
`devcontainer up` handles this via `--remove-existing-container`, but ad-hoc container creation could leave name conflicts.

**Multiple containers with the same project name**: The proposal says "the existing `resolveContainerName()` already handles `--name` conflicts via the `runArgs` check."
This was verified: `project-name.ts` has `hasRunArgsFlag` for checking existing `--name` in `runArgs`.
The claim about `lace-into` disambiguating via container ID suffix needs specification: the current code uses port (`project-22425`), and the new code should specify the exact format.

**Non-blocking**: The "Container shell not being bash" edge case defaults to `/bin/bash` but notes `lace-fundamentals` installs bash.
However, if `lace-fundamentals` is removed from the feature set (it is being made optional for SSH), a container might lack bash.
The TODO about `@lace_shell` metadata is appropriate but should be higher priority than "future enhancement."

### Sprack Integration Boundary

**Blocking**: The proposal states the sprack-db schema column is `lace_port TEXT`.
The actual schema (verified in `packages/sprack/crates/sprack-db/src/schema.rs`) is `lace_port INTEGER`.
The type (`types.rs`) has `lace_port: Option<u16>`.
The replacement `lace_container TEXT` is correct (container names are strings), but the characterization of the current column type is wrong.
This matters because the migration is not just a rename: it is a type change from `INTEGER` to `TEXT`, which requires a schema migration in sprack-db.

**Non-blocking**: The proposal correctly identifies two coupling points in sprack (sprack-poll and sprack-claude resolver).
It also correctly notes that `@lace_workspace` is unchanged.
However, `tree.rs` in sprack also uses `lace_port` for host grouping (line 5: "Sessions are grouped by `@lace_port`").
The companion sprack feature proposal does not explicitly address this host grouping logic.
The migration changes the grouping key from a port number to a container name, which semantically works but the rendering may need adjustment.

### Companion Proposal Consistency

The companion proposal (`2026-03-26-sprack-devcontainer-feature.md`) focuses on the event mount and is correctly scoped as independent from the podman exec migration.
The companion does not cover the sprack-poll `@lace_port` -> `@lace_container` change; it explicitly defers sprack-claude code changes to follow-up work.
This is consistent with the boundary sketch in this proposal.

However, neither proposal explicitly owns the sprack-poll metadata field rename.
This proposal says "out of scope" for sprack code changes, and the companion says it covers only the mount and event discovery.
The `@lace_port` -> `@lace_container` change in sprack-poll falls through the cracks between the two proposals.

**Blocking**: One of the two proposals (or a third) must explicitly own the sprack-poll `@lace_port` -> `@lace_container` migration, including the schema type change from `INTEGER` to `TEXT`.
The current proposal sketches it as a "minimal sprack change" but then says sprack code is out of scope.
This is contradictory: either the minimal change is in scope (preferred, since it is a direct dependency of Phase 2), or it must be explicitly assigned to a companion deliverable with a clear dependency.

### Implementation Phases

The phase ordering is logical: foundation (no behavior change) -> core swap -> ancillary scripts -> feature cleanup -> host-side cleanup.

**Non-blocking**: Phase 2 step 1 ("Rewrite `lace-discover`") and step 2 ("Rewrite `do_connect()`") have an implicit dependency: `lace-into` parses `lace-discover` output, so the output format change and the parser change must land together.
This is obvious but worth noting in the phase description as "steps 1-2 are atomic."

**Non-blocking**: Phase 4 step 5 claims "No code change in `up.ts` itself" because the metadata-driven approach auto-handles the removal.
This is plausible, but the proposal should verify that removing `sshPort` from `customizations.lace.ports` in the feature JSON is sufficient for the port injector in `up.ts` to stop allocating a port for it.
If `up.ts` has any hardcoded references to `sshPort`, this claim is wrong.

### Test Plan

The test plan is adequate for the scope.
The unit-level changes to `test-lace-into.sh` mock expectations are correctly identified.

**Non-blocking**: The test plan does not mention testing the `--start` flow with `lace up` + re-discovery.
This is one of the more complex paths (verified in source lines 136-359 of `lace-into`), and the re-discovery loop parsing changes from port to container name.
An explicit test case for `start_and_connect()` should be added.

### Open Questions

All three open questions are legitimate and well-framed.
Question 1 (shell resolution) is already addressed by the TODO in the design decisions.
Question 2 (text format break) is the right question to surface.
Question 3 (container name vs tmux session alignment) is the right design tension to acknowledge.

### Writing Conventions

The document follows sentence-per-line formatting, uses BLUF, uses NOTE/WARN/TODO callouts with proper attribution, and avoids emojis.
The Mermaid diagrams are used appropriately.
No em-dashes detected.

## Verdict

**Revise**: Three blocking issues require resolution before acceptance.
The core design is well-reasoned and the migration path is sound.
The blocking issues are addressable without major rework.

## Action Items

1. [blocking] Fix the sprack-db column type: the proposal says `lace_port TEXT` but the actual schema is `lace_port INTEGER`. The migration to `lace_container TEXT` is a type change, not just a rename. Correct the characterization and note the schema migration requirement.
2. [blocking] Assign ownership of the sprack-poll `@lace_port` -> `@lace_container` migration. Either bring the minimal sprack change into scope as a dependency of Phase 2, or create an explicit companion task with a blocking dependency arrow. The current framing ("out of scope" but "minimal change sketched") is contradictory.
3. [blocking] Address the transient failure window during `devcontainer up --remove-existing-container`: between container removal and recreation, `@lace_container` references a non-existent container. Confirm this is acceptable and document how dead pane recovery handles the rebuild case (not just stop/start).
4. [non-blocking] Specify the disambiguation suffix for session name collisions post-migration (e.g., first 8 chars of container ID) rather than leaving it as an open question.
5. [non-blocking] Note that `lace-discover` and `lace-inspect` also need the `$RUNTIME` abstraction, not just `lace-into` and `lace-split`.
6. [non-blocking] Update the `lace-fundamentals` feature description string ("Baseline developer environment for lace containers: hardened SSH, ...") as part of Phase 4 cleanup.
7. [non-blocking] Add an explicit test case for the `start_and_connect()` flow with the new container-name-based re-discovery loop.
8. [non-blocking] Note that Phase 2 steps 1-2 (lace-discover rewrite + lace-into parser change) must land atomically.
9. [non-blocking] Consider elevating the `@lace_shell` metadata TODO from "future enhancement" to Phase 2 or 3, since the migration is a natural moment to improve shell resolution.
