---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T22:30:00-06:00
task_list: worktrunk/project-naming
type: report
state: live
status: wip
tags: [status, worktrunk, naming, lace-discover, wez-into, docker, workspace-detector, container-naming]
---

# Worktree Naming Support: Status Report

> BLUF: The lace project completed a full implementation of worktrunk-aware project
> naming on 2026-02-16. The work fixes a fundamental breakage where every devcontainer
> launched from a git worktree was misidentified as "main" instead of the actual project
> name. The solution uses a three-component pipeline -- name derivation in TypeScript,
> Docker label injection at container creation, and label-based discovery in bash scripts
> -- covering 724 passing tests across 29 test files. The feature is code-complete and
> awaiting live end-to-end verification (container rebuild).

## Context / Background

The lace tool manages devcontainers: it launches them, assigns SSH ports, prebuild
images, and provides discovery for WezTerm terminal integration. Users connect to
containers by project name (e.g., `wez-into lace`).

The project naming pipeline worked as follows before this change:

1. `lace up` launches a container. The devcontainer CLI sets a
   `devcontainer.local_folder` Docker label with the host workspace path.
2. `lace-discover` queries Docker for containers with this label and derives the
   project name by calling `basename` on the path.
3. `wez-into` reads discovery output and connects by project name.

This pipeline broke when the lace repository itself migrated to the **worktrunk layout**
(bare-repo + git worktrees). In this layout, the workspace path is
`/code/weft/lace/main/`, so `basename` yields `"main"` -- the worktree name, not the
project name `"lace"`. Every worktree-based project would collide on the same generic
name.

### Motivating Artifacts

- Options Analysis: `cdocs/reports/2026-02-16-project-naming-options-analysis.md`
- Design Reference: `cdocs/reports/2026-02-16-project-naming-reference.md`
- Proposal (6 review rounds): `cdocs/proposals/2026-02-16-rfp-worktrunk-project-naming.md`
- Implementation Devlog: `cdocs/devlogs/2026-02-16-project-naming-implementation.md`

## Key Findings

- The existing `classifyWorkspace()` function in `workspace-detector.ts` already
  solved the detection problem. For a worktree at `/code/weft/lace/main/`, it returns
  `bareRepoRoot = "/code/weft/lace"` and `worktreeName = "main"`. The naming fix
  leverages this existing infrastructure rather than building new detection logic.

- Docker container labels are immutable after creation. The label-based naming approach
  requires container recreation for existing containers to gain the new
  `lace.project_name` label. A `basename` fallback handles pre-label containers.

- The worktree name is deliberately excluded from the project name. In the worktrunk
  model, the bare repo root is mounted into the container, and all worktrees are
  siblings inside it. There is one container per repo, not one per worktree. The
  project name identifies the repo.

- An earlier design iteration considered a `~` separator for branch worktrees
  (e.g., `lace~feature-x`), but this was dropped in favor of the simpler model:
  all worktrees share one container, one project name.

- Container naming via `--name` injection was initially deferred as too risky
  (collision failure mode), but was added after review determined the UX benefits
  outweighed the risks and user-override detection was straightforward (~3 lines).

## Architecture

### The Three-Component Pipeline

```
[1] deriveProjectName()          [2] lace up injects               [3] Discovery reads label
    classifyWorkspace() ->           --label lace.project_name=X       docker ps -> label value
    basename(bareRepoRoot) or        --name X (sanitized)               fallback: basename
    basename(workspacePath)          (skip --name if user override)
```

**Component 1: Name Derivation** (`packages/lace/src/lib/project-name.ts`)

A pure function `deriveProjectName(classification, workspacePath)` that uses
`basename(bareRepoRoot)` for worktree and bare-root classifications, and
`basename(workspacePath)` for all other types (normal-clone, standard-bare,
not-git, malformed). No filesystem access, no side effects.

Companion utilities:
- `sanitizeContainerName(name)`: Docker `--name` charset compliance
  (`[a-zA-Z0-9][a-zA-Z0-9_.-]`), with `"lace-project"` fallback for degenerate input.
- `hasRunArgsFlag(runArgs, flag)`: Detects `--flag` and `--flag=` forms in Docker
  runArgs arrays without false-positive prefix matching (e.g., `--namespace` does not
  match `--name`).

**Component 2: Label + Name Injection** (`packages/lace/src/lib/up.ts`)

During `lace up`, after workspace layout detection (Phase 0a):
1. The `WorkspaceLayoutResult` now exposes its internal `WorkspaceClassification`
   via a new `classification` field (added to `workspace-layout.ts`).
2. `runUp()` extracts the classification and computes the project name via
   `deriveProjectName()`.
3. `generateExtendedConfig()` injects two runArgs entries into the generated
   `.lace/devcontainer.json`:
   - `--label lace.project_name=<rawName>` (always injected, additive)
   - `--name <sanitizedName>` (injected only if user has not already specified `--name`)

The label stores the unsanitized project name (labels have no charset restrictions).
The `--name` stores the sanitized form (Docker charset compliance). User-provided
`--name` flags are detected and respected in both space (`--name foo`) and equals
(`--name=foo`) forms.

**Component 3: Discovery Update** (`bin/lace-discover`, `bin/wez-into`)

Both scripts now read the `lace.project_name` label via the `docker ps --format`
template, avoiding N+1 `docker inspect` calls:

```bash
docker ps --filter "label=devcontainer.local_folder" \
  --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Ports}}\t{{.Label "lace.project_name"}}'
```

The project name is derived as `${project_name:-$(basename "$local_folder")}`,
providing transparent fallback for containers created before the label existed.

### Classification Flow

```
workspacePath (/code/weft/lace/main/)
  |
  v
classifyWorkspace()  [workspace-detector.ts]
  |
  v
WorkspaceClassification { type: "worktree", bareRepoRoot: "/code/weft/lace", worktreeName: "main" }
  |
  v
applyWorkspaceLayout()  [workspace-layout.ts]  -- returns classification in result
  |
  v
deriveProjectName(classification, workspacePath)  [project-name.ts]
  |
  v
"lace"  (basename of bareRepoRoot)
```

### Naming Examples

| Layout | Workspace Path | Classification | Project Name |
|--------|---------------|----------------|--------------|
| Normal clone | `/code/weft/lace/` | `normal-clone` | `lace` |
| Worktrunk primary | `/code/weft/lace/main/` | `worktree` | `lace` |
| Worktrunk branch | `/code/weft/lace/feature-x/` | `worktree` | `lace` |
| Bare-root | `/code/weft/lace/` | `bare-root` | `lace` |
| Standard bare | `/code/bare-repo` | `standard-bare` | `bare-repo` |
| Non-git folder | `/tmp/scratch/` | `not-git` | `scratch` |

## Implementation Details

### Commits (chronological)

| Commit | Description |
|--------|-------------|
| `6bd7f1b` | Phase 1: `deriveProjectName`, `sanitizeContainerName`, `hasRunArgsFlag` + 25 unit tests |
| `54deae6` | Phase 2: Pipeline integration -- extend `WorkspaceLayoutResult`, thread project name through `runUp()` -> `generateExtendedConfig()`, inject runArgs. 5 integration + 3 classification tests |
| `9dfd1ee` | Phase 2 followup: Integration test for sanitized name vs. label divergence |
| `07087c2` | Phase 3: Update `lace-discover` and `wez-into` to read `lace.project_name` label |
| `b80411d` | Documentation: Devlog, reviews, proposal finalization |
| `e1e1b10` | Related fix: Promote absolute gitdir path warning to hard error (prevents non-functional containers) |

### Files Changed

| File | Role |
|------|------|
| `packages/lace/src/lib/project-name.ts` | New: pure name derivation and sanitization functions |
| `packages/lace/src/lib/__tests__/project-name.test.ts` | New: 25 unit tests covering all classification variants |
| `packages/lace/src/lib/workspace-layout.ts` | Modified: added `classification` field to `WorkspaceLayoutResult` |
| `packages/lace/src/lib/__tests__/workspace-layout.test.ts` | Modified: 3 classification threading tests |
| `packages/lace/src/lib/up.ts` | Modified: project name derivation, label + name injection in `generateExtendedConfig()` |
| `packages/lace/src/lib/__tests__/up-project-name.integration.test.ts` | New: 6 integration tests for runArgs injection |
| `bin/lace-discover` | Modified: label-based project name with basename fallback |
| `bin/wez-into` | Modified: label-based project name in `discover_stopped()` |

### Test Coverage

- **25 unit tests** in `project-name.test.ts`: All `WorkspaceClassification` variants
  for `deriveProjectName`, 9 sanitization edge cases, 6 `hasRunArgsFlag` cases
  (space/equals/absent/empty/prefix-collision).
- **6 integration tests** in `up-project-name.integration.test.ts`: Label and name
  injection for normal workspace, user `--name` preservation (space and equals forms),
  existing runArgs preservation, sanitized-vs-label divergence for special characters,
  worktree workspace using repo name instead of worktree name.
- **3 classification threading tests** in `workspace-layout.test.ts`: Verifying
  `WorkspaceLayoutResult.classification` is populated for worktree workspaces,
  populated for error cases, and undefined when workspace config is absent.
- **724 total tests passing** across 29 test files (full regression suite).

### Design Decisions

1. **Docker label as source of truth, not filesystem detection at discovery time.**
   Centralizes naming logic in TypeScript, keeps bash discovery scripts simple. The
   `basename` fallback handles the migration path for pre-label containers.

2. **Worktree name excluded from project name.** The worktrunk model has one container
   per repo with all worktrees as siblings. Including the worktree name would imply
   per-worktree containers, contradicting the architecture.

3. **`--name` injection with user-override detection.** Despite initial concerns about
   collision failure modes, the UX benefit of `docker exec -it lace bash` over
   `docker exec -it confident_noether bash` was deemed significant. The
   `hasRunArgsFlag()` helper makes override detection explicit and safe.

4. **No change to prebuild image naming.** The `lace.local/<base-image>` scheme is
   keyed on base image content, not project identity. Adding project names would break
   sharing of identical prebuild images across projects.

5. **Absolute gitdir paths promoted to hard error.** A related change (`e1e1b10`)
   promotes the absolute-gitdir-path warning to a hard error, since such paths will
   not resolve inside the container and produce a non-functional devcontainer.

## Current State

### What Works

- Project name derivation correctly resolves `"lace"` from workspace path
  `/code/weft/lace/main/` (worktree layout).
- The generated `.lace/devcontainer.json` contains
  `runArgs: ["--label", "lace.project_name=lace", "--name", "lace"]`.
- `lace-discover` reads the label and outputs the correct project name.
- `wez-into` discover_stopped reads the label with basename fallback.
- User-provided `--name` flags are detected and preserved.
- All 724 tests pass. Build, typecheck, and bash syntax checks are clean.

### What Remains

- **Live end-to-end verification.** The container must be rebuilt with the new code
  for the labels and `--name` to take effect. This requires removing the existing
  container and running `lace up` from the worktree. Deferred to the user.

- **Old container cleanup.** Existing containers lack the `lace.project_name` label.
  They continue to work via the `basename` fallback but will not have the new
  container naming. They must be manually removed and recreated.

- **Same-name collision edge case.** Two repos with the same basename (e.g.,
  `/code/org-a/api/` and `/code/org-b/api/`) will produce Docker `--name` conflicts
  on the second `lace up`. The resolution is for the user to add
  `"runArgs": ["--name", "api-orgb"]` to their devcontainer.json. A future
  `customizations.lace.project` override field could provide a cleaner escape hatch.

## Review History

The proposal went through 6 rounds of review with findings addressed iteratively:

- **R1:** Two blocking findings -- classification threading gap (how does
  `generateExtendedConfig` get the `WorkspaceClassification`?) and missing
  `standard-bare` test case. Both resolved by extending `WorkspaceLayoutResult` and
  adding the test.

- **R2:** One blocking finding -- inaccurate failure mode description for `--name`
  collision (Docker does not "fall back" to auto-generated names; it fails with exit
  125). Corrected. Also prompted adding sanitization fallback for degenerate input and
  the equals-form prefix test for `hasRunArgsFlag`.

- **Phase reviews (1-3):** Each implementation phase was reviewed independently after
  commit. All accepted without blocking findings.

- **Final changeset review:** Full cross-cutting review of all phases together.
  Accepted.

## Recommendations

1. **Rebuild the devcontainer** to activate the labels and container naming. Remove the
   existing container first (`docker rm <name>`) and run `lace up` from the worktree.

2. **Verify `wez-into lace` end-to-end** after rebuild to confirm the full discovery
   pipeline works with the label-based naming.

3. **Consider adding `customizations.lace.project`** as a future opt-in override for
   edge cases (same-named repos in different orgs, desired aliases).

4. **Monitor the `--name` collision scenario** in practice. If it becomes a recurring
   friction point, consider auto-appending a short hash disambiguator to the container
   name when collision is detected.
