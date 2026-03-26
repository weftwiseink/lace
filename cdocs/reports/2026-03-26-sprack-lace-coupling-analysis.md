---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T10:00:00-07:00
task_list: sprack/lace-decoupling
type: report
state: archived
status: done
tags: [architecture, sprack, analysis]
---

# Sprack-Lace Coupling Analysis

> BLUF: Sprack has six distinct coupling points to lace, concentrated in three crates: sprack-poll (tmux metadata reads), sprack-claude (container session resolution), and sprack-db (schema columns).
> The coupling is cleanly layered: sprack-poll reads lace state, sprack-claude consumes it for session file discovery, and the TUI displays it for grouping.
> Decoupling is feasible incrementally by introducing a `ContainerProvider` trait in sprack-claude, generalizing the DB schema columns, and extracting tmux metadata reads behind an adapter in sprack-poll.
> The hook event bridge (partially implemented) already provides the foundation for eliminating the two most fragile coupling points: bind-mount path resolution and project directory encoding.

## Context / Background

This report inventories every point where sprack depends on lace-specific state and analyzes paths toward making sprack a standalone tmux-aware tool with optional container integration.
Two RFPs motivated this analysis:
- `cdocs/proposals/2026-03-25-rfp-sprack-lace-decoupling.md`: Explores pluggable container backends.
- `cdocs/proposals/2026-03-25-rfp-stale-tmux-lace-metadata.md`: Documents metadata staleness and incompleteness failures.

## Key Findings

- **Six coupling points** across three crates, not four as the RFP estimated. The JSONL/sessions-index coupling is shared between the bind-mount resolution and the session file reader, not a separate axis.
- **Two coupling points have existing TODO markers** for removal once the hook bridge is complete. The bind-mount resolution in `resolver.rs` is explicitly flagged as a fallback.
- **The DB schema bakes lace semantics into column names**: `lace_port`, `lace_user`, `lace_workspace` on the `sessions` table. This is the deepest coupling because it affects all three crates.
- **The TUI's host grouping logic (`tree.rs`)** uses `lace_port` as the grouping key, but the logic itself is generic: it groups by `Option<u16>`. Renaming the field would make it container-agnostic.
- **sprack-poll queries tmux user options per-session** via `tmux show-options -qvt`. This is a 3-call-per-session overhead (~5ms per session). The option names `@lace_port`, `@lace_user`, `@lace_workspace` are hardcoded strings.
- **The hook bridge already decouples session file discovery** from bind-mount paths. When `hook_transcript_path` is set, sprack-claude bypasses the prefix-matching resolution entirely.
- **lace-into is the sole writer** of tmux metadata. No other lace component writes `@lace_*` options.

## Coupling Inventory

### 1. Tmux User Options (sprack-poll -> tmux)

**Location:** `packages/sprack/crates/sprack-poll/src/tmux.rs`

sprack-poll calls `tmux show-options -qvt $session @lace_port` (plus `@lace_user`, `@lace_workspace`) for every session on every poll cycle.
The function `query_lace_options()` iterates over session names and reads three hardcoded option names.
The results are stored in a `LaceMeta` struct with fields `port: Option<u16>`, `user: Option<String>`, `workspace: Option<String>`.

**What sets this state:** `bin/lace-into` sets session-level and pane-level `@lace_port`, `@lace_user`, `@lace_workspace` via `tmux set-option`.
`bin/lace-split` propagates pane-level options to new splits.
`bin/lace-disconnect-pane` clears pane-level options.

**Coupling strength:** High. The option names are string literals in both the reader (sprack-poll) and the writer (lace-into). A rename on either side silently breaks the other.

**Alternative providers:** Any script or orchestrator that sets tmux user options with a known naming convention.
A `podman-into` or `docker-exec-into` wrapper could set `@container_port`, `@container_user`, `@container_workspace` on tmux sessions.
The key insight: the *mechanism* (tmux user options) is generic; only the *naming convention* is lace-specific.

### 2. LaceMeta in DB Schema (sprack-db)

**Location:** `packages/sprack/crates/sprack-db/src/schema.rs`, `types.rs`, `read.rs`, `write.rs`

The `sessions` table has three nullable columns: `lace_port INTEGER`, `lace_user TEXT`, `lace_workspace TEXT`.
The `Session` struct in `types.rs` has corresponding `lace_port: Option<u16>`, `lace_user: Option<String>`, `lace_workspace: Option<String>` fields.
All read and write operations reference these column names.

**Coupling strength:** Medium-high. The column names encode the lace brand. The schema is versioned (`PRAGMA user_version = 1`), so a rename requires a migration.
However, the columns are semantically generic: port, user, workspace path. Only the `lace_` prefix is lace-specific.

### 3. Container Pane Detection (sprack-claude/resolver.rs)

**Location:** `packages/sprack/crates/sprack-claude/src/resolver.rs`

`find_candidate_panes()` identifies container panes by checking `session.lace_port.is_some() && session.lace_workspace.is_some()`.
This is the gate that determines whether a pane gets container resolution or local `/proc` resolution.
`build_lace_session_map()` filters sessions by `lace_port.is_some()`.

**Coupling strength:** Medium. The logic is correct for any container backend that provides port + workspace metadata. The coupling is to the field names, not the semantics.

### 4. Bind-Mount Session File Discovery (sprack-claude/resolver.rs)

**Location:** `packages/sprack/crates/sprack-claude/src/resolver.rs`, `find_container_project_dir()`

`LaceContainerResolver` and `resolve_container_pane()` use `session.lace_workspace` to derive a prefix, then enumerate `~/.claude/projects/` directories matching that prefix.
This assumes:
- The container's `~/.claude` is bind-mounted to the host at `$HOME/.claude` (lace's mount configuration).
- Claude Code's project directory encoding uses `/` -> `-` substitution (duplicated in `proc_walk::encode_project_path()`).
- The workspace path from tmux metadata matches the container-internal workspace path.

**Coupling strength:** High. This is the most fragile coupling point. It depends on lace's specific bind-mount configuration, Claude Code's internal directory naming scheme, and the workspace path being set correctly by lace-into.

**Mitigation in progress:** Two TODO comments explicitly mark this as a fallback to be removed once the hook event bridge provides `transcript_path` directly. The hook bridge code in `main.rs` already overrides `session_file` when `hook_transcript_path` is set.

### 5. Host Group Grouping (sprack TUI/tree.rs)

**Location:** `packages/sprack/crates/sprack/src/tree.rs`

`group_sessions_by_host()` groups sessions by `session.lace_port`.
Sessions with `lace_port = None` go under a "local" group.
Sessions with the same `lace_port` value are grouped together.
`derive_group_name()` uses the session name or shared prefix for non-local groups.

**Coupling strength:** Low. The logic is already generic (groups by `Option<u16>`). Only the field name `lace_port` is lace-specific. Renaming to `container_port` would make this fully agnostic.

### 6. Claude Code Internal File Formats (sprack-claude/session.rs, jsonl.rs)

**Location:** `packages/sprack/crates/sprack-claude/src/session.rs`, `jsonl.rs`

sprack-claude reads `sessions-index.json` and `.jsonl` files from Claude Code's project directories.
These are Claude Code internal formats, not lace-specific.
However, the *path* to these files is derived via the lace bind-mount (coupling point 4).

**Coupling strength to lace:** Indirect. The file format coupling is to Claude Code, not lace. But the *discovery mechanism* for container files goes through lace's bind-mount path.

## lace-into Dependency Analysis

`bin/lace-into` is the sole producer of all tmux metadata that sprack consumes.
It sets state at two levels:

**Session-level** (lines 589-593, 548-552):
```
tmux set-option -t "$project" @lace_port "$port"
tmux set-option -t "$project" @lace_user "$user"
tmux set-option -t "$project" @lace_workspace "$workspace"
```

**Pane-level** (lines 598-602, 561-565, 662-666):
```
tmux set-option -p -t "$pane_id" @lace_port "$port"
tmux set-option -p -t "$pane_id" @lace_user "$user"
tmux set-option -p -t "$pane_id" @lace_workspace "$workspace"
```

The values come from `lace-discover`, which queries Docker labels and container environment variables.
Specifically: `port` from the Docker port mapping in the 22425-22499 range, `user` from `devcontainer.metadata` or `Config.User`, `workspace` from `CONTAINER_WORKSPACE_FOLDER` env var.

**Could this state be set by other means?**

Yes. Any script that:
1. Knows the SSH port to reach a container
2. Knows the remote user
3. Knows the workspace path inside the container
4. Sets tmux user options with an agreed naming convention

For example, a `podman-into` script could set `@container_port`, `@container_user`, `@container_workspace` after establishing a podman exec session.
A VS Code Remote tunnel connector could set the same options.
The mechanism is entirely generic; only the naming convention and value sources are lace-specific.

## Plugin Architecture Design

### Proposed Trait: `ContainerProvider`

```rust
/// Metadata for a container-connected tmux session.
pub struct ContainerMeta {
    pub port: Option<u16>,
    pub user: Option<String>,
    pub workspace: Option<String>,
}

/// Discovers container metadata for tmux sessions.
pub trait ContainerProvider {
    /// Read container metadata for the given sessions.
    fn query_metadata(&self, session_names: &[String]) -> HashMap<String, ContainerMeta>;
}
```

**Lace implementation:** Reads `@lace_port`, `@lace_user`, `@lace_workspace` from tmux options (current behavior).

**Generic tmux implementation:** Reads `@container_port`, `@container_user`, `@container_workspace` (or configurable option names).

**Discovery file implementation:** Reads JSON files from `~/.local/share/sprack/containers/<session>.json` (as proposed in the RFP direction 4).

### Proposed Trait: `SessionFileResolver`

```rust
/// Resolves a container session to its Claude Code session file.
pub trait SessionFileResolver {
    fn resolve(
        &self,
        session: &Session,
        claude_home: &Path,
    ) -> Option<SessionFileState>;
}
```

**Lace bind-mount resolver:** Current `LaceContainerResolver` logic (enumerate `~/.claude/projects/` with prefix matching).

**Hook bridge resolver:** Uses `hook_transcript_path` from hook events (already partially implemented).

**No-op resolver:** Returns `None` (for non-Claude container monitoring).

### Core vs. Plugin Boundary

**Sprack core (works anywhere with tmux):**
- tmux state polling (`list-panes`, `show-options` for standard tmux state)
- DB schema and read/write operations
- TUI tree rendering, input handling, navigation
- Local Claude Code session resolution via `/proc`
- Hook event bridge reading
- Heartbeat and daemon management

**Container plugin (adds container awareness):**
- `ContainerProvider` implementation (reads container metadata from tmux options, files, or APIs)
- `SessionFileResolver` for container panes (bind-mount resolution, SSH-based resolution, etc.)
- Container-specific host grouping logic
- Metadata validation and staleness detection

### Boundary Placement

The cleanest boundary is at the sprack-poll and sprack-claude entry points:

1. **sprack-poll main loop:** After `query_tmux_state()`, call `container_provider.query_metadata()` instead of hardcoded `query_lace_options()`.
2. **sprack-claude poll cycle:** After `find_candidate_panes()`, dispatch to the appropriate `SessionFileResolver` based on whether the session has container metadata.
3. **sprack-db:** Rename `lace_port`/`lace_user`/`lace_workspace` to `container_port`/`container_user`/`container_workspace` in the schema, types, and all read/write operations.

## Migration Feasibility

### Incremental Steps

**Phase 1: Rename DB columns (low risk, medium effort)**

Rename `lace_*` columns and struct fields to `container_*` across all crates.
This is a mechanical find-and-replace affecting `schema.rs`, `types.rs`, `read.rs`, `write.rs`, `tmux.rs` (sprack-poll), `resolver.rs` (sprack-claude), `tree.rs` (sprack TUI), and `test_render.rs`.
Requires a schema migration (version 0 -> 1 already drops and recreates; add version 2 with renamed columns).
The DB is ephemeral (regenerated on every poll cycle), so data loss is a non-issue.

Estimated scope: ~30 identifier renames across ~10 files.

**Phase 2: Extract `ContainerProvider` trait (low risk, low effort)**

Move `query_lace_options()` behind a trait in sprack-poll.
Create `TmuxOptionProvider` as the default implementation (reads `@lace_*` or `@container_*` tmux options).
The poll loop calls `provider.query_metadata()` instead of the hardcoded function.

Estimated scope: New trait definition, one implementation, one call site change.

**Phase 3: Extract `SessionFileResolver` trait (medium risk, medium effort)**

Factor `LaceContainerResolver` behind a trait in sprack-claude.
The hook bridge already provides an alternative resolution path.
Once hooks are the primary resolver, the bind-mount fallback can be removed entirely (honoring the existing TODOs).

Estimated scope: New trait definition, two implementations (bind-mount, hook-bridge), dispatch logic in `process_claude_pane()`.

**Phase 4: Configurable option names (low risk, low effort)**

Allow the tmux option names (`@lace_port` vs. `@container_port`) to be configured.
Default to `@lace_*` for backward compatibility, with `@container_*` as the recommended generic names.

Estimated scope: Configuration struct, propagated to `ContainerProvider`.

### Risk Assessment

- **Phase 1** is pure rename refactoring. Tests are comprehensive and will catch regressions. Risk: low.
- **Phase 2** is a straightforward trait extraction with a single implementation. Risk: low.
- **Phase 3** touches the resolution dispatch logic in `process_claude_pane()`, which has multiple code paths (local, container, fallback). Requires careful test coverage of all paths. Risk: medium.
- **Phase 4** is additive configuration. Risk: low.

Total effort estimate: 2-3 focused implementation sessions.

## Stale Metadata Problem

Decoupling helps with the stale metadata problem in two ways:

**1. Validation at the provider boundary.**
A `ContainerProvider` trait can include a `validate_metadata()` method that checks whether the stored port/user/workspace still matches reality (e.g., by calling `lace-discover` or `docker inspect`).
The current architecture has no natural place for this validation: sprack-poll blindly copies tmux options into the DB.
With a trait boundary, the provider can validate before returning metadata, or return a `Stale` status that sprack-poll can surface.

**2. Hook bridge eliminates workspace dependency.**
The `@lace_workspace` flakiness documented in the RFP (port set but workspace empty) becomes irrelevant once the hook bridge provides `transcript_path` directly.
The hook bridge data comes from Claude Code itself, so it is inherently correct: no race condition between setting tmux options.

**What decoupling does NOT solve:**
- The root cause of staleness (container rebuild changes the port, tmux session retains the old port) is a lace-into problem, not a sprack problem.
- sprack can detect and surface staleness, but it cannot fix it. The correction must come from the container orchestrator (lace-into, a refresh daemon, or a tmux hook).
- The `@lace_port` without `@lace_workspace` failure mode is a lace-into atomicity bug. Decoupling gives sprack better diagnostics (the warning in `find_candidate_panes()` already exists) but does not prevent the inconsistency.

## Recommendations

1. **Start with Phase 1 (rename)** as a standalone PR. It is low-risk, improves naming clarity, and establishes the `container_*` vocabulary for all future work.
2. **Prioritize completing the hook bridge** over the trait extractions. The hook bridge eliminates the two most fragile coupling points (bind-mount resolution and project encoding) without requiring any architectural refactoring.
3. **Defer the `ContainerProvider` trait** until there is a concrete second backend. The trait interface should be designed with a real alternative in mind, not speculatively.
4. **Add `lace-discover` validation to sprack-poll** as a near-term improvement for staleness detection. This does not require decoupling: sprack-poll can call `lace-discover --json` periodically and compare against stored metadata.
5. **Fix the `@lace_workspace` atomicity bug in lace-into** by setting all three options in a single tmux command group, or by validating completeness before returning success.
