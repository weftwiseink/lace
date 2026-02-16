---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T13:00:00-06:00
task_list: worktrunk/project-naming
type: proposal
state: live
status: request_for_proposal
tags: [worktrunk, lace-discover, wez-into, naming, container-naming, docker]
---

# Worktrunk-Aware Project Naming and Container Identity

> BLUF: `lace-discover` and `wez-into` derive project names via `basename` of the
> workspace folder, which breaks under the worktrunk (bare-repo + worktree) layout —
> every project becomes "main". We need a naming scheme that is stable, predictable,
> human-friendly, and collision-resistant across both single-checkout and worktrunk repos.
>
> - Motivated By: `cdocs/devlogs/2026-02-16-worktrunk-migration-fix.md`

## Objective

The worktrunk convention places worktrees inside a bare repo:

```
/code/weft/lace/        # bare repo root
/code/weft/lace/main/   # worktree → devcontainer workspace folder
```

Three naming surfaces break under this layout:

1. **Project name in `lace-discover`** — uses `basename "$local_folder"` (line 73 of
   `lace-discover`), yielding `"main"` instead of `"lace"`. Every worktrunk repo's
   primary worktree would collide on the name `"main"`.

2. **Project name in `discover_stopped`** — same `basename` logic in `wez-into` (line 125),
   same problem.

3. **Docker container name** — the devcontainer CLI auto-generates opaque names like
   `confident_noether`. These are not human-meaningful, not predictable, and not queryable
   by project. This is a long-standing upstream gap (see
   [vscode-remote-release#2485](https://github.com/microsoft/vscode-remote-release/issues/2485),
   116+ upvotes, still open). The workaround is `runArgs: ["--name", "<name>"]`.

## Scope

The full proposal should explore:

- **A naming scheme for project identity** that derives a human-friendly, collision-resistant
  name from the workspace folder path. The scheme must handle:
  - Single-checkout repos: `/code/weft/lace/` → `"lace"`
  - Worktrunk primary: `/code/weft/lace/main/` → `"lace"` (not `"main"`)
  - Worktrunk branch: `/code/weft/lace/feature-x/` → `"lace~feature-x"` or similar
  - Multiple users on shared machines (if relevant)

- **Container naming via `runArgs`** — lace already generates an extended
  `devcontainer.json` (`.lace/devcontainer.json`). It could inject
  `"runArgs": ["--name", "<computed-name>"]` during the `lace up` pipeline, giving
  containers predictable names. Candidate format:
  `lace_{user}_{repo}_{nanoid(4)}` (e.g., `lace_mjr_lace_a7f2`).
  The nanoid hash (of the workspace folder path) prevents collisions when the same
  repo name appears in different orgs or paths.

- **Image naming** — prebuild images currently use `lace.local/<base-image>`. Consider
  whether the repo name should be included for multi-project disambiguation.

- **Discovery contract changes** — `lace-discover` output format is consumed by both
  `wez-into` and the `lace.wezterm` plugin. Any naming change must be backwards-compatible
  or coordinated across consumers.

- **Where the name lives** — options include:
  - Derived at discovery time from filesystem heuristics (git worktree detection)
  - Declared in `customizations.lace` (e.g., `"project": "lace"`)
  - Stored as a Docker label by `lace up` for later retrieval
  - Some combination (declared + label + fallback heuristic)

- **Interaction with workspace-detector** — the existing `classifyWorkspace()` in
  `workspace-detector.ts` already resolves `bareRepoRoot` and `worktreeName` from
  the filesystem. This logic could be extracted or shared with the naming layer.

## Known Requirements

- `wez-into lace` must continue to work after worktrunk migration (the primary use case).
- `wez-into lace --start` must resolve the correct workspace folder for the worktree,
  not the bare repo root.
- The `lace.wezterm` plugin's project picker reads `lace-discover --json` output.
  The `name` field must remain the primary lookup key.
- Container names must be valid Docker names (`[a-zA-Z0-9][a-zA-Z0-9_.-]`).
- Multiple worktrees of the same repo may run concurrently (e.g., `main` and `feature-x`
  in separate containers). The naming scheme must distinguish them.

## Prior Art

- **vscode-remote-release#2485**: Upstream issue requesting `containerName` in
  devcontainer.json. Still open. The community workaround is
  `"runArgs": ["--name", "${localEnv:USER}_devcontainer"]`.
  Lace can implement this without waiting for upstream.
- **devcontainer labels**: The devcontainer CLI sets `devcontainer.local_folder` and
  `devcontainer.config_file` labels on containers. Lace could add a custom
  `lace.project_name` label during `lace up` for reliable retrieval.
- **Workspace detector**: `classifyWorkspace()` already knows `bareRepoRoot` and
  `worktreeName`. For a worktree at `/code/weft/lace/main/`,
  `bareRepoRoot = "/code/weft/lace"` and `worktreeName = "main"`.
  `basename(bareRepoRoot)` gives the repo name `"lace"`.

## Open Questions

1. **Should the project name be purely derived or user-configurable?**
   A `customizations.lace.project` field would give explicit control, but adds config
   surface. A derived name (basename of bare repo root for worktrees, basename of
   workspace for normal clones) covers 90% of cases with zero config.

2. **How should branch worktrees be represented?**
   Options: `lace~feature-x`, `lace/feature-x`, `lace:feature-x`, `lace--feature-x`.
   The separator must be valid in Docker container names and not conflict with existing
   `lace-discover` output format (colon-delimited).

3. **Should `lace-discover` use the Docker label or re-derive the name?**
   A `lace.project_name` label is most reliable (survives filesystem moves). But
   existing containers (pre-label) need a fallback. The proposal should define the
   migration path.

4. **Should lace inject `runArgs: ["--name", ...]` unconditionally?**
   If the user already has `--name` in their runArgs, lace must not conflict. The
   proposal should define precedence: user-explicit > lace-generated > devcontainer-default.

5. **What happens to `discover_stopped` for worktrunk repos?**
   Stopped containers have the `devcontainer.local_folder` label baked in. If that
   label points to a bare repo root (stale after migration), `--start` passes the
   wrong workspace folder to `lace up`. Should discovery validate the path? Should
   lace store the correct worktree path in a custom label?
