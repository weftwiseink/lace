---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T18:00:00-06:00
task_list: worktrunk/project-naming
type: report
state: live
status: done
tags: [worktrunk, naming, reference, design-decisions, edge-cases, stories]
---

# Project Naming: Design Reference

> BLUF: Reference material extracted from the project naming proposal to keep the
> implementation document focused. Contains design decision rationale, user stories,
> edge case analysis, naming examples, and prior art. Implementors should consult
> this document when they need to understand _why_ a design choice was made.
>
> - Proposal: `cdocs/proposals/2026-02-16-rfp-worktrunk-project-naming.md`
> - Options Analysis: `cdocs/reports/2026-02-16-project-naming-options-analysis.md`
> - Motivating Devlog: `cdocs/devlogs/2026-02-16-worktrunk-migration-fix.md`

## Current Naming Pipeline (Before)

```
lace up --workspace-folder /code/weft/lace/main
  ↓
devcontainer CLI sets label: devcontainer.local_folder=/code/weft/lace/main
  ↓
lace-discover queries Docker, extracts label, runs basename → "main"
  ↓
wez-into receives "main:22425:node:/code/weft/lace/main" from discovery
  ↓
wezterm connect lace:22425 --workspace main
```

## Existing Infrastructure

- **`classifyWorkspace()`** (`workspace-detector.ts:57-169`): Pure filesystem detection
  that returns `bareRepoRoot` and `worktreeName` for worktree layouts. For
  `/code/weft/lace/main/`, returns `bareRepoRoot = "/code/weft/lace"` and
  `worktreeName = "main"`. No git binary required.

- **Extended devcontainer.json generation** (`up.ts:579-673`): `lace up` already
  generates `.lace/devcontainer.json` with injected ports, mounts, and lifecycle
  commands. It does not currently inject `runArgs`.

- **`applyWorkspaceLayout()`** (`workspace-layout.ts:79-178`): Already calls
  `classifyWorkspace()` during the `lace up` pipeline (Phase 0a) to configure
  `workspaceMount`/`workspaceFolder` for bare-worktree layouts. The current
  `WorkspaceLayoutResult` return type does not expose the `WorkspaceClassification`
  — it only returns `{ status, message, warnings }`. The classification is consumed
  and discarded internally.

- **Discovery output format**: `lace-discover` outputs `name:port:user:path` (text)
  or `{"name","port","user","path","container_id"}` (JSON). Consumers: `wez-into`,
  `lace.wezterm` plugin.

- **`discover_raw()`** (`bin/lace-discover:61-64`): Docker format template is
  `'{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Ports}}'`.

- **`discover_stopped()`** (`bin/wez-into:117-128`): Docker format template is
  `'{{.Label "devcontainer.local_folder"}}'`. Outputs `name\tlocal_folder` per line.

- **`WorkspaceClassification`** union type (`workspace-detector.ts:8-36`):
  `worktree | bare-root | normal-clone | standard-bare | not-git | malformed`.
  The `worktree` variant includes `bareRepoRoot` and `worktreeName`. The `bare-root`
  variant includes `bareRepoRoot`. Other variants have no additional fields.

### Prior Art

- **vscode-remote-release#2485**: Upstream issue requesting `containerName` in
  devcontainer.json. Still open. The community workaround is
  `"runArgs": ["--name", "${localEnv:USER}_devcontainer"]`.
  Lace can implement this without waiting for upstream.
- **devcontainer labels**: The devcontainer CLI sets `devcontainer.local_folder` and
  `devcontainer.config_file` labels on containers. Lace can add custom labels via
  `runArgs: ["--label", "key=value"]`.
- **Docker label immutability**: Labels are set at container creation time and cannot
  be changed afterward. Any label-based naming must be set during `lace up`.

## Naming Examples

| Layout | Workspace Path | Classification | Project Name |
|--------|---------------|----------------|--------------|
| Normal clone | `/code/weft/lace/` | `normal-clone` | `lace` |
| Worktrunk primary | `/code/weft/lace/main/` | `worktree`, name=`main` | `lace` |
| Worktrunk branch | `/code/weft/lace/feature-x/` | `worktree`, name=`feature-x` | `lace` |
| Worktrunk (master) | `/code/project/master/` | `worktree`, name=`master` | `project` |
| Bare-root | `/code/weft/lace/` | `bare-root` | `lace` |
| Standard bare | `/code/bare-repo` | `standard-bare` | `bare-repo` |
| Non-git folder | `/tmp/scratch/` | `not-git` | `scratch` |
| Multiple repos, same name | `/code/org-a/api/main/` | `worktree` | `api` |
| Multiple repos, same name | `/code/org-b/api/main/` | `worktree` | `api` |

> NOTE: Same-named repos in different orgs produce the same project name. This is
> acceptable for the current single-user use case. A `customizations.lace.project`
> override field can be added as a future escape hatch.

## Design Decisions

### Worktree name excluded from project name

In the worktrunk layout, the bare repo root is mounted into the container as a single
bind mount. All worktrees are sibling directories inside the container. There is one
container per repo, not one per worktree. The project name identifies the repo, and
`wez-into lace` connects you to the one container where all of `lace`'s worktrees live.

Including worktree names would imply separate containers per worktree, which contradicts
the worktrunk design. It would also require a separator character (introducing its own
design surface) and a heuristic for stripping primary branch names. Excluding the worktree
name eliminates all of this complexity.

### Inject `--name` with the project name

Opaque auto-generated names like `confident_noether` are genuinely bad UX. `docker ps`,
`docker logs lace`, `docker exec -it lace bash` are all more ergonomic with meaningful
names. This is not cosmetic — it improves the entire Docker CLI experience.

User-override detection is straightforward: scan `runArgs` for `--name` or `--name=...`.
If the user has already specified a name, lace respects it and skips injection. This is
~3 lines of code.

The collision concern (Docker errors if a container with the same name exists) is real but
manageable. The devcontainer CLI already detects and reuses existing containers by label.
The `--name` collision only happens when:

1. A non-lace container coincidentally has the same name → clear error, easy to diagnose
2. Same-named repos in different orgs → acknowledged edge case, same as label collision

For case 2, if this proves problematic, a future option is to append a short disambiguator
(e.g., nanoid suffix) to the name when collision is detected.

> NOTE: Docker container names must match `[a-zA-Z0-9][a-zA-Z0-9_.-]`. Project names
> derived from `basename` may theoretically contain characters outside this set.
> The implementation includes a sanitization step. In practice, git repo directory names
> almost always conform already.

### Store name as a Docker label, not derive at discovery time

Centralizes the naming logic in TypeScript (`lace up`), keeping `lace-discover` (bash)
simple. The label is baked into the container and survives filesystem moves. The `basename`
fallback handles all pre-label containers gracefully. This is preferable to replicating
the `.git` file parsing and worktree detection logic in bash.

### No change to prebuild image naming (deferred)

The `lace.local/<base-image>` scheme is keyed on the base image, not the project. This
correctly enables sharing of identical prebuild images across projects. Adding project
names would break sharing for no functional benefit.

## Stories

### Story 1: Primary worktree after worktrunk migration

User migrates the lace repo to worktrunk layout. They run `lace up` from the worktree at
`/code/weft/lace/main/`. The container gets label `lace.project_name=lace` and is named
`lace`. Running `wez-into lace` discovers the container by its label and connects.
`docker ps` shows a container named `lace` instead of `confident_noether`.

### Story 2: Concurrent worktrees, shared container

User has two worktrees: `main` and `feature-x`. They are sibling directories inside the
same container (the bare repo root is the bind mount). `lace-discover` outputs one entry:
`lace:22425:node:...`. `wez-into lace` connects. The user switches between worktrees
inside the container using `cd /workspace/feature-x`.

### Story 3: Pre-label container (migration path)

User has an existing container created before the label feature. `lace-discover` finds no
`lace.project_name` label, falls back to `basename` of `devcontainer.local_folder`. For a
normal-clone container, `basename` produces the correct name. The container continues to
work without recreation.

### Story 4: Stopped container restart

User runs `wez-into --start lace`. `discover_stopped` queries Docker for stopped containers,
reads the `lace.project_name` label (or falls back to `basename`), finds a match, and
passes the `devcontainer.local_folder` path to `lace up --workspace-folder`.

### Story 5: User-provided container name

User has `"runArgs": ["--name", "my-lace"]` in their devcontainer.json. `lace up` detects
the existing `--name` flag and skips its own `--name` injection. The label
`lace.project_name=lace` is still injected (labels are always additive). Discovery works
via the label regardless of the container's actual name.

## Edge Cases

### Same repo name in different orgs

Two repos named `api` in different orgs (`/code/org-a/api/main/` and `/code/org-b/api/main/`)
both produce project name `"api"`. If both run concurrently:
- The first `lace up` succeeds: container named `api`, label `lace.project_name=api`.
- The second `lace up` fails with Docker exit code 125: `"Conflict. The container name
  'api' is already in use."` The devcontainer CLI surfaces this as a hard error.
- Resolution: the user adds `"runArgs": ["--name", "api-orgb"]` to the second project's
  devcontainer.json (lace detects the existing `--name` and skips injection), or overrides
  via `customizations.lace.project` (future).

### `--name` collision with non-lace container

If a non-lace container already uses the name `lace`, the `--name lace` injection causes
`docker create` to fail. The devcontainer CLI surfaces this error. The user resolves by
either removing the conflicting container or adding a manual `--name` override in their
devcontainer.json (which lace will detect and skip).

### Container name character sanitization

Docker container names must match `[a-zA-Z0-9][a-zA-Z0-9_.-]`. Repo directory names with
characters outside this set (rare but possible) need sanitization. The sanitization
replaces invalid characters with `-`, strips leading and trailing non-alphanumeric
characters, and falls back to `"lace-project"` if the result is empty. Label values have
no character restrictions, so the label stores the unsanitized name while `--name` gets
the sanitized form.

### User-provided `--label lace.project_name` in runArgs

If a user manually sets `"runArgs": ["--label", "lace.project_name=custom"]`, Docker
applies both labels but the last one wins. Since lace appends its label after the existing
`runArgs`, lace's value overrides the user's. This is the desired precedence: lace-derived
name is authoritative. If explicit user override is needed, `customizations.lace.project`
(future) is the proper mechanism.

### Container with stale `devcontainer.local_folder`

After worktrunk migration, old containers have `devcontainer.local_folder=/code/weft/lace`
(pre-migration path). They also lack the `lace.project_name` label. Discovery falls back
to `basename("/code/weft/lace")` = `"lace"`, which is correct by coincidence. However,
`wez-into --start` would pass the stale path to `lace up`, which would fail because the
path no longer contains a `.devcontainer/` directory. The user must manually remove the
old container (`docker rm <name>`) and run `lace up` from the new worktree path.

### `runArgs` merging with existing entries

`lace up` currently does not inject any `runArgs`. This proposal adds `--label` and
`--name` entries. The merge strategy: append `--label` (always safe, additive), append
`--name` only if not already present. The `hasRunArgsFlag()` helper makes the detection
explicit and handles both `--name value` and `--name=value` forms.

## Open Questions (All Resolved)

1. **Project name: derived or user-configurable?** Derived for now. A
   `customizations.lace.project` override field can be added later.

2. **How should branch worktrees be represented?** They aren't. All worktrees share
   one container and one project name (the repo name).

3. **Should `lace-discover` use the Docker label or re-derive the name?** Docker label
   with `basename` fallback. Detection logic stays in TypeScript.

4. **Should lace inject `--name`?** Yes. Inject with the derived (sanitized) project
   name. Skip if the user has already provided `--name`.

5. **What happens to `discover_stopped` for worktrunk repos?** Reads the
   `lace.project_name` label from stopped containers, falls back to `basename`.
   The `devcontainer.local_folder` label is still used for the workspace path.
