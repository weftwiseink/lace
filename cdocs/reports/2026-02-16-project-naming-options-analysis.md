---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T14:30:00-06:00
task_list: worktrunk/project-naming
type: report
state: live
status: wip
tags: [analysis, worktrunk, naming, lace-discover, wez-into, docker, container-naming, image-naming]
---

# Worktrunk Project Naming Options Analysis

> BLUF: The `basename`-based project naming in `lace-discover` and `wez-into` breaks under
> the worktrunk layout because every primary worktree resolves to "main". The recommended
> approach is a hybrid strategy: `lace up` writes a `lace.project_name` Docker label at
> container creation time (derived from `classifyWorkspace()` output), and `lace-discover`
> reads the label with a `basename` fallback for pre-label containers. The `~` separator
> (e.g., `lace~feature-x`) is the best option for branch worktree disambiguation. Container
> naming via `runArgs` injection should be opt-in initially, and prebuild image naming
> does not need changes.

## Context / Background

The lace tool manages devcontainers. It discovers running containers via Docker labels
and presents them as named projects to users. The naming pipeline currently works as:

1. **`lace up`** launches a container. The devcontainer CLI automatically sets
   `devcontainer.local_folder` as a Docker label on the container.
2. **`lace-discover`** queries Docker for containers with this label, derives the project
   name via `basename` of the label's path value, and outputs `name:port:user:path` lines.
3. **`wez-into`** parses discovery output and connects to containers by project name.

This pipeline breaks under the worktrunk (bare-repo + worktree) layout:

| Layout | `local_folder` | `basename` | Expected |
|--------|----------------|------------|----------|
| Normal clone | `/code/weft/lace/` | `lace` | `lace` |
| Worktrunk primary | `/code/weft/lace/main/` | `main` | `lace` |
| Worktrunk branch | `/code/weft/lace/feature-x/` | `feature-x` | `lace~feature-x` |

The existing `classifyWorkspace()` in `workspace-detector.ts` already solves the detection
problem: for `/code/weft/lace/main/`, it returns `bareRepoRoot = "/code/weft/lace"` and
`worktreeName = "main"`. The open question is where, when, and how to apply this detection
in the naming pipeline.

## Key Findings

- Docker container labels are **immutable after creation**. Any label-based naming must
  be set at `lace up` time and cannot be retroactively corrected on existing containers.
- The `lace-discover` output format uses `:` as a delimiter (`name:port:user:path`).
  The `:` character is therefore reserved and cannot appear in project names.
- Docker container names must match `[a-zA-Z0-9][a-zA-Z0-9_.-]` (alphanumeric start,
  then alphanumeric plus `_`, `.`, `-`). The `/` character is not valid.
- The `lace up` pipeline already generates an extended `.lace/devcontainer.json`. It
  currently does not inject `runArgs`.
- `classifyWorkspace()` is a pure filesystem operation (no git binary required for core
  detection). It is fast and deterministic.
- The prebuild image tag format `lace.local/<base-image>:<tag>` is keyed on the base
  image, not the project. Multiple projects sharing the same base image share the same
  prebuild image, which is the intended behavior (it avoids redundant rebuilds).
- The devcontainer CLI provides no built-in mechanism for naming containers; this is
  a long-standing upstream gap (vscode-remote-release#2485, 116+ upvotes, still open).

---

## Question 1: Where Should the Canonical Project Name Live?

### Options

#### A. Derived at discovery time (filesystem heuristics)

`lace-discover` would run `classifyWorkspace()` (or a bash equivalent) on the
`devcontainer.local_folder` path at discovery time, every invocation.

**Pros:**
- Zero migration burden. Works immediately on existing containers.
- No new Docker labels or config fields. No schema changes.
- Single source of truth: the filesystem layout.

**Cons:**
- `lace-discover` is a bash script. It would need to either shell out to git or replicate
  the `.git` file parsing logic in bash (check if `.git` is a file, parse `gitdir:` pointer,
  walk up to find worktrees directory). This is doable but adds ~20 lines of bash.
- Couples discovery to the host filesystem. If the workspace folder is moved or deleted
  while the container is running, discovery produces incorrect names.
- Re-runs the detection on every discovery call. Not expensive (3-4 `stat` calls + 1 file
  read) but redundant since the answer never changes for a given container.
- Cannot support user-override names without an additional mechanism.

#### B. Declared in devcontainer.json

A new field like `customizations.lace.project` would let users set the name explicitly.

**Pros:**
- Full user control. Handles edge cases (unusual directory structures, desired aliases).
- The name is versioned with the project and visible in the config.

**Cons:**
- Every project needs an additional config field. Boilerplate.
- Most projects can derive the name automatically; explicit config is overhead for the
  common case.
- Does not solve the discovery problem alone. The declared name must still be conveyed
  to the running container (via label or some other channel) for `lace-discover` to read.

#### C. Stored as a Docker label

`lace up` computes the project name (via `classifyWorkspace()` or a declared field) and
writes it as a `lace.project_name` Docker label on the container at creation time.

**Pros:**
- Discovery becomes a simple label read (`docker inspect` / `docker ps --format`).
  No filesystem heuristics needed at discovery time.
- The name is baked into the container and survives filesystem moves.
- Fast: label reads are as cheap as the existing `devcontainer.local_folder` read.

**Cons:**
- Requires a migration path. Existing containers (created before the label existed)
  won't have it. Discovery must fall back to something.
- Docker labels are immutable. If the user wants to rename a project, they must
  recreate the container.
- Requires `lace up` to inject a `--label` flag into the devcontainer invocation
  (or into the extended config's `runArgs`).

#### D. Combination: Docker label (authoritative) + filesystem fallback

`lace up` writes the `lace.project_name` label. `lace-discover` reads the label if
present, and falls back to filesystem-based derivation (or `basename`) if absent.

**Pros:**
- Best of both worlds: reliable label-based lookup for new containers, graceful
  degradation for old containers.
- The fallback path can be simple (`basename`) since it only applies to pre-migration
  containers that are all normal clones (not worktrunk).
- Clear migration: over time, all containers gain labels as they are recreated.

**Cons:**
- Two code paths in discovery. Slightly more complex.
- The fallback `basename` is still wrong for worktrunk containers, but this is
  acceptable because worktrunk containers created before the label feature existed
  are already broken and need recreation anyway (the `devcontainer.local_folder`
  label itself has the wrong path).

### Recommendation: Option D (Combination)

The combination approach is the most robust. `lace up` already generates an extended
devcontainer config; adding a label is a one-line change. The `basename` fallback
handles the entire existing fleet. The fallback's limitation (wrong for worktrunk)
is moot because worktrunk containers must be recreated regardless (their
`devcontainer.local_folder` label points to the old pre-migration path).

Implementation sketch for `lace up`:
```typescript
// In generateExtendedConfig(), add to runArgs:
const runArgs = (extended.runArgs ?? []) as string[];
runArgs.push("--label", `lace.project_name=${projectName}`);
extended.runArgs = runArgs;
```

Implementation sketch for `lace-discover`:
```bash
# Try lace label first, fall back to basename of local_folder
lace_name=$(docker inspect "$container_id" \
  --format '{{index .Config.Labels "lace.project_name"}}' 2>/dev/null || echo "")
name="${lace_name:-$(basename "$local_folder")}"
```

A `customizations.lace.project` override field could be added later as an
optional complement (Option B) for edge cases. It is not needed for the initial
implementation.

---

## Question 2: How Should Branch Worktrees Be Represented?

### The Primary Worktree Question

For the worktrunk convention, the primary worktree (typically `main` or `master`)
should map to the bare repo name alone:

- `/code/weft/lace/main/` should produce project name `"lace"`, not `"lace~main"`

This matches user intent: the primary worktree IS the project. Nobody wants to type
`wez-into lace~main`.

**Detection:** `classifyWorkspace()` returns `worktreeName`. Compare it against a
short list of primary branch names (`main`, `master`, `trunk`). If it matches,
strip it. Otherwise, include it with a separator.

This heuristic is not perfect (a repo could have a non-standard primary branch name),
but it covers 99% of cases. For the remaining 1%, the explicit
`customizations.lace.project` field (future) provides an escape hatch.

An alternative: instead of pattern-matching branch names, use `git symbolic-ref HEAD`
on the bare repo to determine the default branch. This is more correct but requires
shelling out to git and adds a dependency on the git binary being available. Given that
`main`/`master` covers virtually all cases, the simple heuristic is preferable.

### Separator Analysis

For non-primary worktrees, the project name needs a composite format: `{repo}{sep}{worktree}`.

| Separator | Example | Docker name valid? | lace-discover safe? | Ambiguity risk | Readability |
|-----------|---------|-------------------|---------------------|----------------|-------------|
| `~` | `lace~feature-x` | Yes | Yes (not used as delimiter) | Low (rare in repo names) | Good |
| `--` | `lace--feature-x` | Yes | Yes | Medium (repos can contain `--`) | Fair |
| `.` | `lace.feature-x` | Yes | Yes | Medium (common in repo names) | Fair |
| `/` | `lace/feature-x` | **No** (invalid in Docker names) | No (path separator) | N/A | N/A |
| `:` | `lace:feature-x` | No | **No** (delimiter in output format) | N/A | N/A |
| `@` | `lace@feature-x` | No (invalid in Docker names) | Yes | N/A | N/A |
| `_` | `lace_feature-x` | Yes | Yes | High (very common in names) | Fair |

### Recommendation: `~` (tilde)

The tilde is the clear winner:

- Valid in Docker container names.
- Not used as a delimiter in `lace-discover` output.
- Extremely rare in repository names and branch names (git permits it but nobody uses it).
- Visually distinct: `lace~feature-x` reads naturally as "lace, branch feature-x."
- Precedent: git itself uses `~` as a revision suffix operator (`HEAD~3`), creating a
  natural association with "branch/revision context."
- Single character: minimal visual noise compared to `--`.

The naming function becomes:
```typescript
function deriveProjectName(classification: WorkspaceClassification): string {
  if (classification.type === "worktree") {
    const repoName = basename(classification.bareRepoRoot);
    const isPrimary = ["main", "master", "trunk"].includes(classification.worktreeName);
    return isPrimary ? repoName : `${repoName}~${classification.worktreeName}`;
  }
  if (classification.type === "bare-root") {
    return basename(classification.bareRepoRoot);
  }
  // normal-clone, not-git, etc: use basename of workspace
  return basename(workspacePath);
}
```

---

## Question 3: Should Lace Inject `runArgs: ["--name", ...]`?

### Current State

Containers get random Docker names (e.g., `confident_noether`). This is cosmetic
annoyance, not a functional problem. Discovery uses labels, not container names.

### Benefits of Named Containers

- `docker exec -it lace_lace sh` is more ergonomic than `docker exec -it confident_noether sh`.
- `docker ps` output becomes self-documenting.
- Enables `docker stop lace_lace` by name instead of by ID lookup.
- Container name uniqueness enforcement prevents accidental duplicate containers for
  the same project.

### Risks

- **User conflict:** If a user already has `"runArgs": ["--name", "my-container"]` in
  their devcontainer.json, lace's injection would create duplicate `--name` flags.
  Docker takes the last `--name` flag, so lace's value would silently override the user's.
- **Name collisions:** If the generated name collides with an existing container (from a
  previous run that wasn't cleaned up), `docker run` fails with `Conflict. The container
  name "/lace_lace" is already in use`. This is a hard failure, not a graceful fallback.
- **Extended config complexity:** `runArgs` is an array of raw Docker flags, not a
  structured API. Merging lace-generated flags with user-provided flags requires parsing
  the array to detect conflicts.

### Format Options

| Format | Example | Uniqueness | Readability |
|--------|---------|------------|-------------|
| `lace_{project}` | `lace_lace` | Low (same project, different paths) | Good |
| `lace_{user}_{project}` | `lace_mjr_lace` | Medium (shared machines) | Good |
| `lace_{project}_{hash4}` | `lace_lace_a7f2` | High (hash of workspace path) | Fair |
| `lace_{user}_{project}_{hash4}` | `lace_mjr_lace_a7f2` | Very high | Verbose |

### Recommendation: Do Not Inject `--name` Initially

The risks outweigh the benefits for the initial implementation:

1. Container naming is cosmetic. Discovery works via labels, not names.
2. The collision failure mode (hard error if name exists) is worse than the current
   state (random name works every time).
3. Detecting and merging user-provided `--name` in `runArgs` is fiddly.

Instead, add container naming as a future opt-in feature via
`customizations.lace.containerName` or a `--name` flag on `lace up`. This lets users
who want predictable names opt in, while avoiding breakage for everyone else.

If implemented later, the recommended format is `lace_{project}` (e.g., `lace_lace`).
This is simple and readable. The collision risk is acceptable because `lace up` can
detect an existing container with the same name and either reuse it or prompt the user.

---

## Question 4: Should Discovery Run Git Worktree Detection, or Rely on Labels?

### Option A: Detection in `lace-discover` (bash)

`lace-discover` would parse `.git` files and walk up directories to detect worktree
layouts, replicating some of `classifyWorkspace()` logic in bash.

```bash
derive_project_name() {
  local folder="$1"
  local dotgit="$folder/.git"

  if [[ -f "$dotgit" ]]; then
    local gitdir
    gitdir=$(sed -n 's/^gitdir: //p' "$dotgit")
    # Resolve relative paths
    [[ "$gitdir" != /* ]] && gitdir="$(cd "$folder" && cd "$(dirname "$gitdir")" && pwd)/$(basename "$gitdir")"

    if [[ "$gitdir" == */worktrees/* ]]; then
      # Walk up to find bare repo root
      local bare_internals="${gitdir%/worktrees/*}"
      local bare_root="$(dirname "$bare_internals")"
      local worktree_name="$(basename "$folder")"
      local repo_name="$(basename "$bare_root")"

      case "$worktree_name" in
        main|master|trunk) echo "$repo_name" ;;
        *) echo "${repo_name}~${worktree_name}" ;;
      esac
      return
    fi
  fi

  # Fallback: basename
  basename "$folder"
}
```

**Pros:** No label dependency. Works on all containers immediately.
**Cons:** ~25 lines of bash path-walking logic. Depends on host filesystem being
accessible and unchanged. Duplicates logic that already exists in TypeScript.

### Option B: Label-based (label set by `lace up`, fallback to `basename`)

As described in Question 1, Option D.

**Pros:** Discovery stays simple (one label read). Detection logic lives in one place
(TypeScript, inside `lace up`).
**Cons:** Requires container recreation for existing containers to gain the label.

### Option C: Hybrid (label first, detection fallback)

Read label. If absent, run the bash detection. If detection fails, fall back to `basename`.

**Pros:** Works on all containers (new and old), and handles worktrunk correctly even
for pre-label containers.
**Cons:** Most complex. Three code paths.

### Recommendation: Option B (Labels with `basename` Fallback)

The full bash detection (Option A/C) adds complexity that is only needed during a
transitional period. Since worktrunk containers must be recreated anyway (their
`devcontainer.local_folder` label has the pre-migration path), the label approach
covers the real use case. Old normal-clone containers work fine with `basename`.

The detection logic stays in TypeScript (`workspace-detector.ts`), maintaining a single
implementation. `lace-discover` stays simple.

---

## Question 5: Image Naming

### Current Scheme

Prebuild images use `lace.local/<base-image>:<tag>`. For example:
- `FROM node:24-bookworm` becomes `lace.local/node:24-bookworm`
- `FROM mcr.microsoft.com/devcontainers/javascript-node:24` becomes
  `lace.local/mcr.microsoft.com/devcontainers/javascript-node:24`

### Should the Project Name Be Included?

The prebuild image captures a base image plus stable features (git, sshd). It is
parameterized by the base image and the feature set, not by the project. Two projects
that use the same `FROM node:24-bookworm` and the same `prebuildFeatures` produce
bit-identical images. Sharing the image avoids redundant builds and disk usage.

Including the project name would break this sharing:
- `lace.local/lace/node:24-bookworm` (project: lace)
- `lace.local/dotfiles/node:24-bookworm` (project: dotfiles)
These would be two separate images with identical content.

### When Would Project-Scoped Images Matter?

Only if different projects use the same base image but different prebuild features. In
that case, the current scheme would produce a collision: the last `lace prebuild` to run
overwrites the shared tag.

However, this scenario is already handled by the existing collision detection logic: the
`contextsChanged()` check in `prebuild.ts` (line 196-198) compares the Dockerfile and
feature set against cached metadata. If they differ, it rebuilds. The tag is based on
the base image, so two projects with different feature sets but the same base image
would indeed overwrite each other -- but this is a pre-existing issue unrelated to
the worktrunk naming change.

### Recommendation: No Change

The current `lace.local/<base-image>` scheme is correct for the common case and does
not need project-scoping. The theoretical collision (same base image, different features,
different projects) is rare and would need a content-addressed tagging scheme (hash of
features) rather than project-name scoping. That is a separate concern from worktrunk
naming and should be addressed independently if it ever becomes a real problem.

---

## Summary of Recommendations

| Question | Recommendation | Rationale |
|----------|---------------|-----------|
| 1. Where does the name live? | Docker label + `basename` fallback | Reliable, simple discovery, clean migration |
| 2. Worktree separator | `~` (tilde), strip primary branch names | Docker-valid, unambiguous, readable |
| 3. Container naming via `runArgs` | Skip initially; add as opt-in later | Collision risk, cosmetic benefit only |
| 4. Detection in discovery vs. labels | Labels (detection stays in `lace up`) | Single implementation, simple discovery |
| 5. Image naming | No change | Current scheme is correct; project-scoping breaks sharing |

### Implementation Priority

1. **Add `deriveProjectName()` to the TypeScript codebase** -- a function that takes
   a `WorkspaceClassification` and a workspace path and returns the project name.
   This is the naming core.

2. **Modify `lace up` to write `lace.project_name` label** -- inject
   `--label lace.project_name=<name>` into the devcontainer invocation's `runArgs`.

3. **Modify `lace-discover` to read the label** -- one-line change to prefer the label
   over `basename`, with `basename` as fallback.

4. **Coordinate `wez-into`** -- no changes needed; it already reads names from
   `lace-discover` output.

5. **Coordinate `lace.wezterm` plugin** -- no changes needed; it already reads from
   `lace-discover --json` output. The `name` field semantics are preserved.

Total estimated changes: ~40 lines of TypeScript (name derivation + label injection),
~5 lines of bash (label read in discovery). No breaking changes to any consumer.
