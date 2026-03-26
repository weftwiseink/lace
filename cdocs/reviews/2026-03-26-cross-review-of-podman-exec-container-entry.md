---
review_of: cdocs/proposals/2026-03-26-podman-exec-container-entry.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T17:30:00-07:00
task_list: lace/podman-migration
type: review
state: live
status: done
tags: [fresh_agent, cross_review, architecture, sprack, podman, contract_consistency, companion_proposals]
---

# Cross-Review: Podman Exec and Sprack Devcontainer Feature Companion Proposals

> BLUF: The two companion proposals are largely consistent but have three areas of misalignment: ownership of the sprack-poll `@lace_port` -> `@lace_container` rename falls through the cracks (identified in the R1 review but not yet resolved), the sprack feature proposal's host-side discovery design uses `lace_port`-era semantics that need updating for the `@lace_container` world, and the DB schema migration from `INTEGER` to `TEXT` is acknowledged in neither proposal's implementation phases.
> The mount contract itself is clean: the sprack feature's bind mount operates at the container level and is transport-agnostic, meaning it works identically under SSH or podman exec.
> The proposals can be implemented independently with one sequencing constraint: the sprack-poll metadata rename must land alongside or after the podman Phase 2.
> Verdict: **Revise** - two blocking cross-proposal consistency issues require resolution.

## Summary Assessment

This cross-review evaluates consistency between the podman exec migration proposal and the sprack devcontainer feature proposal.
These are companion proposals that explicitly reference each other, and both are scoped to land in the same timeframe.
The proposals are independently well-designed and their individual reviews already covered internal merits.
This review focuses exclusively on the contract boundary between them: whether they agree on what each provides, what each consumes, and what falls between.
The most critical finding is that the sprack-poll `@lace_port` -> `@lace_container` rename is claimed by neither proposal as in-scope work, yet both proposals depend on it being done.

## Cross-Proposal Findings

### 1. Sprack-Poll Metadata Rename Ownership (blocking)

The podman proposal's "Sprack Integration Boundary" section (lines 464-499) explicitly states "Sprack code changes are out of scope for this proposal" but then sketches the minimal sprack-poll and sprack-db changes as a "Phase 2 dependency."
The sprack feature proposal does not mention the `@lace_port` -> `@lace_container` rename at all: it covers the mount contract, event directories, and host-side discovery, but its scope is the event/metadata data path, not the tmux metadata path.

The R1 review of the podman proposal identified this as blocking (action item 2).
The sprack feature proposal was accepted without addressing it because the rename is outside its scope.

The result: neither proposal owns this work, yet the podman proposal cannot complete Phase 2 without it.
The coupling analysis report (`cdocs/reports/2026-03-26-sprack-lace-coupling-analysis.md`) confirms the coupling points: `tmux.rs` reads `@lace_port`, `schema.rs` defines `lace_port INTEGER`, `tree.rs` groups by `lace_port`.

**Resolution options:**

- A: The podman proposal expands its scope to include the sprack-poll/sprack-db rename as a formal Phase 2 deliverable (not just a sketch).
- B: A new micro-proposal or task explicitly owns the sprack-poll/sprack-db migration, with a blocking dependency arrow from podman Phase 2.
- C: The sprack feature proposal absorbs the rename, since it already covers sprack code changes (host-side discovery in `events.rs`).

Option A is the cleanest: the podman proposal already sketches the work, and the rename is a direct consequence of the `@lace_port` -> `@lace_container` shift that the podman proposal introduces.

### 2. DB Schema Type Change: INTEGER to TEXT (blocking)

The podman proposal (line 495) correctly identifies that the sprack-db column changes from `lace_port INTEGER` to `lace_container TEXT`, and notes this is "a type change, not just a rename, requiring a schema migration."
The sprack feature proposal does not mention the DB schema at all.
The coupling analysis report (line 60-65) confirms the current schema: `lace_port INTEGER`, `lace_user TEXT`, `lace_workspace TEXT` on the `sessions` table, with `Session.lace_port: Option<u16>` in `types.rs`.

Neither proposal's implementation phases include the schema migration as a deliverable.
The podman proposal mentions it in the integration boundary sketch but not in Phases 1-5.
The sprack feature proposal's phases cover feature scaffold, mount resolution, host-side event discovery, and metadata writer: no DB changes.

The coupling analysis notes (line 223) that "the DB is ephemeral (regenerated on every poll cycle), so data loss is a non-issue."
This simplifies the migration: a schema version bump with `DROP TABLE IF EXISTS sessions; CREATE TABLE sessions (...)` using the new column names is sufficient.
The implementation is small, but it must be explicitly assigned to a phase in whichever proposal owns the rename.

### 3. Host-Side Discovery Semantics vs Container Identity Model (non-blocking)

The sprack feature proposal designs `event_dirs()` (lines 162-192) to return per-project event directories based on `~/.local/share/sprack/lace/*/claude-events/`.
The podman proposal shifts container identity from port to name, introducing `@lace_container` as the primary identifier.

These two data paths are orthogonal: the event dirs are filesystem-based (project name in path), while the metadata is tmux-based (`@lace_container` option).
They agree on using the project name as the organizing key: the sprack feature uses it in the host path (`~/.local/share/sprack/lace/<project_name>/`), and the podman proposal uses it as the tmux session name and `@lace_container` value (both derived from `sanitizeContainerName(projectName)`).

However, the sprack feature proposal's `event_dirs()` example (line 196) says "the caller iterates over `event_dirs()` and tries each" with priority for per-project directories.
The podman proposal introduces `@lace_container` which could be used to narrow the search: if sprack knows the container name for a session, it can look directly in `~/.local/share/sprack/lace/<container_name>/claude-events/` instead of scanning all directories.
The sprack feature proposal does not mention this optimization because it was written without awareness of the `@lace_container` field.

This is not a conflict, but a missed optimization opportunity that should be noted for the implementation phase.

### 4. Mount Independence from Transport (non-blocking, confirmed consistent)

The sprack feature proposal explicitly states (lines 350-352): "That migration changes how panes connect to containers but does not affect the mount: bind mounts are container-level configuration, not connection-level.
The sprack mount works identically whether the pane connects via SSH or podman exec."

The podman proposal does not reference the sprack mount at all, which is correct: the mount is invisible to the entry transport.
The `SPRACK_EVENT_DIR` environment variable is set by `containerEnv` in the feature JSON, which applies regardless of how the user enters the container.

This is a clean contract boundary.
The two proposals are independent on the data plane (mount) and only share the control plane (tmux metadata naming convention).

### 5. Phase Ordering and Sequencing Dependencies (non-blocking)

The sprack feature proposal's phases are:
1. Feature scaffold + mount resolution
2. Mount source resolution (settings override or `${lace.projectName}`)
3. Host-side discovery in sprack-claude
4. Container metadata writer (optional)

The podman proposal's phases are:
1. Foundation (resolve_runtime, container_name in discover)
2. Core transport swap (lace-into, lace-split, lace-disconnect-pane)
3. Ancillary scripts (lace-paste-image, lace-inspect)
4. Feature cleanup (lace-fundamentals SSH removal)
5. Host-side cleanup

The only cross-proposal dependency: the sprack-poll `@lace_port` -> `@lace_container` rename (wherever it lands) must happen at the same time as or after podman Phase 2.
Before podman Phase 2, `lace-into` still sets `@lace_port`, so sprack-poll must read `@lace_port`.
After podman Phase 2, `lace-into` sets `@lace_container`, so sprack-poll must read `@lace_container`.
These cannot both be true simultaneously unless sprack-poll reads both (a temporary shim) or the changes land atomically.

The podman proposal states "breakage is acceptable: no backwards-compatible shims."
Therefore, the sprack-poll rename and podman Phase 2 must land together.
Neither proposal documents this atomicity requirement.

The sprack feature phases 1-4 are fully independent of the podman phases: the mount works regardless of entry transport.
Sprack feature Phase 3 (host-side discovery) is independent of the podman migration but could benefit from `@lace_container` for targeted directory lookup (see finding 3).

### 6. Terminology Consistency (non-blocking)

Both proposals use consistent terminology for shared concepts:

| Concept | Podman proposal | Sprack feature proposal |
|---------|----------------|------------------------|
| Container identifier | `@lace_container` (container name) | N/A (not in scope) |
| Project name | `sanitizeContainerName(projectName)` | `<project_name>` in paths |
| Mount path | N/A (not in scope) | `/mnt/sprack/` container-side, `~/.local/share/sprack/lace/<project>/` host-side |
| Event directory | N/A | `SPRACK_EVENT_DIR=/mnt/sprack/claude-events` |
| tmux metadata | `@lace_container`, `@lace_user`, `@lace_workspace` | Does not reference tmux metadata |

One terminology gap: the podman proposal uses "container name" to mean the Docker/podman container name (from `sanitizeContainerName()`), while the sprack feature proposal uses "project name" in host paths.
These are derived from the same source but are not always identical: `sanitizeContainerName()` applies sanitization rules that could diverge from the raw project name.
The sprack feature's `recommendedSource` uses `${lace.projectName}` which resolves via `MountPathResolver`, while the podman proposal's container name resolves via `sanitizeContainerName()`.

If these functions produce different strings for the same project, the host path (`~/.local/share/sprack/lace/<projectName>/`) and the container name (`@lace_container`) would not match, breaking the optimization in finding 3.

This is worth verifying during implementation: confirm that `lace.projectName` and `sanitizeContainerName(projectName)` produce the same string for all valid project names, or document any divergence.

### 7. Coupling Analysis Report Alignment (non-blocking)

The coupling analysis report identifies six coupling points.
The podman proposal addresses coupling points 1 (tmux user options rename), 2 (DB schema), and 5 (host group grouping key).
The sprack feature proposal addresses coupling point 4 (bind-mount session file discovery) by providing a simpler alternative: direct event file reads from the mount instead of prefix-matching against `~/.claude/projects/`.
Coupling point 3 (container pane detection in `resolver.rs`) shifts from `lace_port.is_some()` to `lace_container.is_some()` as a consequence of the rename.
Coupling point 6 (Claude Code file formats) is unchanged by either proposal.

The report's recommendation to "start with Phase 1 (rename)" aligns with the podman proposal's phasing if the rename is brought into scope.
The report's recommendation to "prioritize completing the hook bridge" aligns with the sprack feature proposal's primary objective.

## Verdict

**Revise**: Two blocking cross-proposal issues require resolution before the proposals can be considered a consistent pair.
The core designs are sound and the mount/transport boundary is clean.
The issues are about ownership assignment and atomicity requirements, not design flaws.

## Action Items

1. [blocking] Assign explicit ownership of the sprack-poll `@lace_port` -> `@lace_container` rename (tmux.rs, schema.rs, types.rs, read.rs, write.rs, tree.rs). Recommend: the podman proposal absorbs this as a formal Phase 2 deliverable, not just a boundary sketch. Update the podman proposal's Phase 2 to include these tasks with specific acceptance criteria.
2. [blocking] Document the atomicity requirement: the sprack-poll rename and podman Phase 2 must land together (or the sprack-poll change must land first). Neither proposal currently states this dependency.
3. [non-blocking] Verify that `lace.projectName` (used by the sprack feature's `recommendedSource`) and `sanitizeContainerName(projectName)` (used by the podman proposal for container naming) produce the same string for all valid inputs. If they diverge, document the mapping or use a shared derivation function.
4. [non-blocking] Note in the sprack feature proposal that `@lace_container` (introduced by the podman proposal) can be used to narrow event directory lookup from scanning all `~/.local/share/sprack/lace/*/` to a single `~/.local/share/sprack/lace/<container_name>/`, improving the `event_dirs()` design.
5. [non-blocking] Add the DB schema migration (sprack-db `lace_port INTEGER` -> `lace_container TEXT`, including `types.rs` type change from `Option<u16>` to `Option<String>`) to whichever proposal's implementation phases absorb the rename.
