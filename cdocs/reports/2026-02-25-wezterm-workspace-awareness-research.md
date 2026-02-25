---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T18:00:00-06:00
task_list: lace/wezterm-server
type: report
state: live
status: review_ready
tags: [wezterm-server, devcontainer-cli, entrypoint, containerEnv, research]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-25T20:00:00-06:00
  round: 1
related_to:
  - cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md
  - cdocs/reports/2026-02-25-devcontainer-wezterm-lua-investigation.md
---

# Research: Dev Container CLI Mechanics for Workspace-Aware wezterm-server

> **BLUF:** Investigation of the devcontainer CLI source code established
> three facts that determined the architecture for workspace-aware
> wezterm-server: (1) feature `containerEnv` values are NOT substituted
> with `${containerWorkspaceFolder}` because substitution occurs before
> feature merging; (2) feature `entrypoint` fields work for daemon
> startup (docker-in-docker pattern); (3) `containerWorkspaceFolder` is
> immutable once set in devcontainer.json. This rules out feature-side
> env var declaration and confirms the env var + entrypoint approach.

## Context

The wezterm-server feature needs to know the container's workspace folder
at runtime to set `default_cwd` for the mux server. Several approaches
were considered. This report documents the CLI source code investigation
that informed the final design choice.

See the companion proposal
(`cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md`) for
the design itself.

## Key Findings

### 1. Variable Substitution Timing

**Source:** `src/spec-node/configContainer.ts`, `src/spec-common/variableSubstitution.ts`

The devcontainer CLI creates a `substitute0` context in `configContainer.ts`
that includes `containerWorkspaceFolder`. This context is applied to the
base `devcontainer.json` config via `containerSubstitute()` BEFORE feature
configs are merged in `mergeConfiguration()`.

**Implication:** A feature's `containerEnv` entry of
`"${containerWorkspaceFolder}"` passes through as the literal string
`${containerWorkspaceFolder}`, never resolved. Only values in the base
`devcontainer.json` get substituted.

This was confirmed by tracing the call chain:
1. `configContainer.ts` calls `beforeContainerSubstitute()` to create
   `substitute0` with `containerWorkspaceFolder` in scope.
2. `substitute0` is applied to `config` (the base devcontainer.json).
3. `mergeConfiguration()` merges feature metadata into the substituted
   config AFTER step 2.
4. There is no second substitution pass after merging.

### 2. Feature Entrypoint Mechanism

**Source:** `src/spec-node/singleContainer.ts`

The `entrypoint` field in `devcontainer-feature.json` works as follows:

1. Feature entrypoints are collected from all installed features into
   `mergedConfig.entrypoints[]`.
2. In `spawnDevContainer()`, these are concatenated into a container
   startup wrapper: `/bin/sh -c "... ${customEntrypoints.join('\n')} exec
   "$@" ..."`.
3. Entrypoints run BEFORE `exec "$@"` (before the container's main process)
   and BEFORE lifecycle hooks (`postStartCommand`, etc.).
4. `containerEnv` values are injected as `docker run -e` flags, making them
   available to all entrypoint scripts.

**Precedent:** The docker-in-docker feature
(`ghcr.io/devcontainers/features/docker-in-docker`) uses this pattern to
start `dockerd` as a daemon via its entrypoint script
(`/usr/local/share/docker-init.sh`).

### 3. containerWorkspaceFolder Immutability

**Source:** `src/spec-node/utils.ts` (`getWorkspaceConfiguration`)

Once `devcontainer.json` contains a `workspaceFolder` property, the CLI
uses it verbatim. The auto-computed fallback (`/workspaces/<basename>`)
only applies when the property is entirely absent.

For lace: `applyWorkspaceLayout()` computes and writes `workspaceFolder`
into the intermediate config at `lace up` time. The value is deterministic
and never changes at runtime.

### 4. containerEnv Availability

**Source:** `src/spec-node/singleContainer.ts`

Values in `containerEnv` are baked into the container at creation time via
`docker run -e` flags. They are available to ALL processes: entrypoint
scripts, lifecycle commands, interactive shells, and daemons started by
any of these. This differs from `remoteEnv`, which is only applied to
lifecycle commands and remote sessions.

## Approaches Considered

### Approach A: Feature-level `defaultCwd` option in install.sh

Rejected. `install.sh` runs at image build time, before `workspaceFolder`
is known. The devcontainer spec passes only `_REMOTE_USER`,
`_REMOTE_USER_HOME`, and `_CONTAINER_USER_HOME` to feature install scripts.

### Approach B: Pass `--cwd` flag on `wez-into` / `wezterm connect`

Rejected. `wezterm connect` does not accept a `--cwd` flag (confirmed in
`cdocs/proposals/2026-02-01-deeper-wezterm-devcontainer-integration.md`
open question 2). Even if it did, subsequent panes spawned via the mux
server would still use the server's `default_cwd`. The fix must be
server-side.

### Approach C: Lace generates a config file at `lace up` time

Viable but unnecessarily complex. Lace would write a
`.lace/wezterm-mux-server.lua` file per run, inject a bind mount, and
rewrite `postStartCommand` to pass `--config-file`. This requires lace to
understand wezterm's config format and perform string manipulation on
lifecycle commands. The env var + entrypoint approach achieves the same
result with cleaner separation of concerns.

### Approach D: Feature declares `containerEnv` with `${containerWorkspaceFolder}`

Does not work. Per finding #1 above, variable substitution happens before
feature merging. The feature's `containerEnv` entry passes through as a
literal string.

### Approach E: `wezterm-mux-server --config "default_cwd=..."`

WezTerm's `--config` flag accepts `name=value` pairs. Could work in
`postStartCommand`, but doesn't address the `postStartCommand` elimination
goal and requires the user to template or hardcode the path.

### Approach F (selected): Static config reading env var + feature entrypoint

Feature installs a static wezterm.lua reading `os.getenv("CONTAINER_WORKSPACE_FOLDER")`
and declares an entrypoint to auto-start the mux server. Lace (or the
user) provides the env var via `containerEnv`. Clean separation: feature
owns config format and startup, lace provides runtime context.

## Source Files Examined

| File | Purpose |
|---|---|
| `devcontainers/cli/src/spec-node/configContainer.ts` | substitute0 creation, config substitution before feature merge |
| `devcontainers/cli/src/spec-node/singleContainer.ts` | spawnDevContainer, entrypoint wrapper, containerEnv injection |
| `devcontainers/cli/src/spec-common/variableSubstitution.ts` | substitute(), containerSubstitute(), beforeContainerSubstitute() |
| `devcontainers/cli/src/spec-node/utils.ts` | getWorkspaceConfiguration, workspaceFolder resolution |
| `devcontainers/cli/src/spec-common/injectHeadless.ts` | Lifecycle command execution with remoteEnv |
| `devcontainers/features/src/docker-in-docker/devcontainer-feature.json` | Entrypoint pattern precedent |
