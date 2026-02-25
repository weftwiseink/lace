---
review_of: cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T16:00:00-06:00
task_list: lace/wezterm-server
type: review
state: live
status: done
tags: [fresh_agent, architecture, devcontainer, env_injection, entrypoint, separation_of_concerns, edge_cases]
---

# Review: Workspace-Aware wezterm-server: Eliminating the Per-Project wezterm.lua

## Summary Assessment

This proposal eliminates five coordinated pieces of per-project wezterm boilerplate by making the wezterm-server feature self-starting (via entrypoint) and workspace-aware (via env var read at runtime).
The architecture is clean and well-motivated: the feature owns its config and startup, lace provides runtime context through generic env vars, and non-lace users get a straightforward opt-in path.
The investigation work backing the devcontainer CLI timing claims is thorough, and the rejected alternatives are well-reasoned.
Verdict: **Accept** with two non-blocking improvements.

## Section-by-Section Findings

### BLUF and Objective

The BLUF accurately summarizes the three-part approach (feature config + entrypoint, lace env var injection, cleanup).
The objective's six-point checklist is concrete and verifiable.
No issues.

### Background: The Current Setup

Verified against the actual codebase:

- `.devcontainer/wezterm.lua` exists and contains exactly the described content (hardcoded `config.default_cwd = "/workspace/main"`).
- `.devcontainer/devcontainer.json` line 55 contains the bind mount string.
- `.devcontainer/Dockerfile` lines 100-104 contain the `mkdir -p` and `chown`.
- `.devcontainer/devcontainer.json` line 70 contains the `postStartCommand`.
- `up-mount.integration.test.ts` lines 1185-1189 contain the preservation assertion.

All five moving parts are accurately described. **No issues.**

### Background: What Lace Already Knows

Verified: `workspace-layout.ts` line 172-173 computes `config.workspaceFolder` from `mountTarget` and `worktreeName`.
The `generateExtendedConfig` function in `up.ts` receives the resolved config (which includes the computed `workspaceFolder`).
`projectName` is computed via `deriveProjectName()` and passed to `generateExtendedConfig`.
**No issues.**

### Background: Dev Container CLI Mechanics

The three findings (substitution timing, feature entrypoint mechanism, containerEnv availability) are sourced from the investigation report and consistent with observable behavior (the current setup requires per-project config precisely because the feature cannot get workspace path substituted).

**Non-blocking observation:** Finding #2 states entrypoint scripts have access to all `containerEnv` values "injected as `docker run -e` flags."
This is correct for `containerEnv`, but the proposal should be aware that `remoteEnv` values are NOT available to entrypoints (they are injected via shell profile, not `docker run -e`).
The proposal does not use `remoteEnv`, so this is not a problem, but it is worth noting for future readers who might consider moving the env var to `remoteEnv`.

### Why Not Other Approaches

All five rejected approaches (A through E) are well-reasoned:

- **Approach A** correctly notes that `install.sh` runs at build time before `workspaceFolder` is known.
- **Approach B** correctly identifies that `wezterm connect` has no `--cwd` flag and the fix must be server-side.
- **Approach C** is the original proposal draft. The rationale for preferring the env var approach (cleaner separation of concerns, no wezterm-specific logic in lace) is sound.
- **Approach D** correctly explains the substitution timing issue. This is the key technical insight of the proposal.
- **Approach E** correctly notes `--config` on `postStartCommand` does not address the entrypoint goal.

**No issues.**

### Proposed Solution: Feature-Installed Config File

The Lua config is minimal and correct. `os.getenv("CONTAINER_WORKSPACE_FOLDER")` is standard Lua, available in WezTerm's Lua environment.
The `if workspace then` guard provides clean degradation.
The `/usr/local/share/wezterm-server/` location is appropriate for a feature-owned config that should not conflict with user config.

**No issues.**

### Proposed Solution: Feature Entrypoint Script

The entrypoint script is minimal and follows the docker-in-docker pattern.
The `2>/dev/null || true` suppresses errors and ensures the entrypoint does not block container startup if the mux server fails.

**Non-blocking concern:** The entrypoint runs as whatever user the container's init process uses (typically root for the entrypoint wrapper).
The mux server probably should run as the remote user, not root.
However, `wezterm-mux-server --daemonize` forks and the entrypoint is just triggering the daemon start.
The docker-in-docker feature's entrypoint also runs as root initially, so this follows established patterns.
If the mux server does need to run as the non-root user, a `su -c` wrapper would be needed, but this is a detail for implementation rather than a proposal-level concern.

### Proposed Solution: Lace Environment Variable Injection

The injection point in `generateExtendedConfig()` is correct in concept.
`extended.workspaceFolder` will contain the resolved path (e.g., `/workspace/lace/main`) since the workspace layout phase has already run and mutated the config.

**Non-blocking accuracy note:** The Phase 2 code snippet shows `projectName` as a bare variable, but in the actual `generateExtendedConfig` function, it is accessed as `options.projectName` (it is not destructured in the current code).
An implementer would need to either add `projectName` to the destructuring or use `options.projectName`.
This is minor since the code is illustrative, not copy-paste-ready.

The "no silent overwrite" behavior (`!containerEnv.CONTAINER_WORKSPACE_FOLDER`) is important and correctly specified.

### Non-Lace Users

The non-lace path is clear: add one `containerEnv` entry to the base `devcontainer.json`.
The `${containerWorkspaceFolder}` substitution works in the base config (per finding #1).
Without the entry, the feature degrades to home directory.
This is a good balance of opt-in simplicity and zero-config degradation.

**No issues.**

### Design Decisions

All five design decisions (D1-D5) are well-reasoned and internally consistent.
D4's "unconditional injection" rationale is strong: the env vars are universally useful and the no-overwrite guard prevents user surprise.
D5's graceful degradation ensures the feature never breaks a container just because an env var is missing.

**No issues.**

### Edge Cases

E1 through E6 cover the important scenarios.

**Potential gap (non-blocking):** E1 describes what happens when a user has `~/.config/wezterm/wezterm.lua`, but does not address the case where a user has a `WEZTERM_CONFIG_FILE` env var already set (pointing to their own config).
In that case, the mux server started by the entrypoint uses `--config-file` explicitly, so `WEZTERM_CONFIG_FILE` would NOT take precedence for the mux server.
However, the mitigation in E1 suggests "Set `WEZTERM_CONFIG_FILE` to point to their own config" as an override path, which would only work if the entrypoint is also modified to respect that variable.
This is a minor inconsistency in the mitigation options: option 2 (set `WEZTERM_CONFIG_FILE`) does not actually work given the `--config-file` flag in the entrypoint takes priority.
The user would need to use option 1 (override the entrypoint) or option 3 (add the env var read to their own config).

### Implementation Phases

The three phases are correctly ordered and independently testable:

- **Phase 1** (feature changes) is self-contained and can be tested with any devcontainer that sets the env var manually.
- **Phase 2** (lace changes) requires Phase 1 to be deployed but can be tested with `--skip-devcontainer-up` against the generated `.lace/devcontainer.json`.
- **Phase 3** (cleanup) requires both previous phases.

The test plans for each phase are concrete and cover the important scenarios.

**No issues.**

### Summary of File Changes

The table is accurate and complete.
All files mentioned are real and exist at the paths shown.

### Writing Quality

The document follows cdocs conventions well:
- BLUF is present and accurate.
- Sentence-per-line formatting is used throughout.
- Colons preferred over em-dashes (one `--` usage in the "What This Eliminates" section is acceptable in a diff context).
- No emojis.
- History-aware framing is mostly correct: the NOTE callout about superseding the earlier draft is appropriately placed.
- Code samples are concrete and verifiable.
- The document is well-factored with minimal repetition.

## Verdict

**Accept.** The proposal is technically sound, well-researched, and clearly structured for implementation.
The env var + entrypoint architecture is a clean improvement over the current five-part boilerplate, and the devcontainer CLI investigation provides solid evidence for the design choices.

## Action Items

1. [non-blocking] Correct the E1 mitigation: option 2 ("Set `WEZTERM_CONFIG_FILE`") does not override `--config-file` passed on the command line. Either remove this option or note that the entrypoint would also need modification.
2. [non-blocking] Consider adding a NOTE to the entrypoint section about which user the mux server process runs as. If the entrypoint runs as root (typical for the container init wrapper), the mux server daemon may inherit root, which could affect file permissions in the workspace. The docker-in-docker feature handles this by using `sudo -u` in some cases. At minimum, document the expected behavior during Phase 1 implementation.
