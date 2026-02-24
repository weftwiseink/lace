---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T23:15:00-06:00
task_list: worktrunk/project-identification
type: proposal
state: live
status: implementation_wip
tags: [worktree, project-id, mounts, naming, deriveProjectId, mount-resolver, UX, bind-mounts]
last_reviewed:
  status: accepted
  by: "@claude-haiku-4-5-20251001"
  at: 2026-02-16T20:50:00-06:00
  round: 2
---

# Unify Worktree-Aware Project Identification Across Lace

> BLUF: `deriveProjectId()` in `repo-clones.ts` uses raw
> `basename(workspacePath)`, causing worktree workspaces to get correct Docker
> container names ("lace") but wrong filesystem paths (`~/.config/lace/main/`
> instead of `~/.config/lace/lace/`). The fix makes `deriveProjectId()`
> self-classifying — it calls `classifyWorkspace()` internally to determine the
> correct project name, with a module-level cache so repeated classifications
> of the same path are free. The existing sanitization logic is extracted into
> a pure `sanitizeProjectId()` helper for direct unit testing. No downstream
> signature changes are needed: `MountPathResolver`, `runResolveMounts`, and
> the standalone CLI command all get correct behavior automatically. A separate
> phase improves mount guidance UX. See the gap analysis report for the full
> inventory of affected call sites.

## Objective

Ensure that all lace subsystems that derive filesystem paths from a project
identity — mount default paths, repo clone paths, and any future per-project
storage — use the same worktree-aware logic that `deriveProjectName()` uses for
Docker labels and container naming. Additionally, improve the mount guidance UX
to eliminate confusing output when mount overrides are already configured or
when bind mount sources don't exist.

## Background

### The Dual-Identity Problem

Lace currently has two independent functions that derive a "project identifier":

1. **`deriveProjectName(classification, workspacePath)`** in `project-name.ts`:
   Worktree-aware. For a worktree at `/code/weft/lace/main/`, uses
   `basename(classification.bareRepoRoot)` → `"lace"`. Used for Docker
   `--label` and `--name`.

2. **`deriveProjectId(workspaceFolder)`** in `repo-clones.ts`:
   Not worktree-aware. Uses `basename(workspaceFolder)` → `"main"`. Used for
   `~/.config/lace/<projectId>/mounts/` and `~/.config/lace/<projectId>/repos/`.

For normal clones, both produce the same result. For worktree workspaces, they
diverge: the container is correctly named `"lace"` but mount data lands in
`~/.config/lace/main/` instead of `~/.config/lace/lace/`.

### Downstream Effects

- **Mount path fragmentation:** Switching between worktrees `main` and
  `feature-x` in the same repo creates separate mount directories
  (`main/mounts/` vs `feature-x/mounts/`) even though they share one container.
- **Repo clone duplication:** Feature repo clones land in per-worktree
  directories instead of per-project directories.
- **Confusing output:** The `lace up` mount guidance shows
  `using default path /home/mjr/.config/lace/main/mounts/project/claude-config`
  where `main` is the worktree name, not the project name.

### Mount Guidance UX Issues

The current `emitMountGuidance()` output has three separate UX problems:

1. **Recommendation shown when recommended source exists on host:** The
   `→ Recommended:` line appears for all non-override mounts that have a
   `recommendedSource` declaration, regardless of whether the recommended path
   actually exists on the host. The `isOverride` check in `emitMountGuidance`
   is correct (if `isOverride` is false, the settings override was not found).
   The user confusion arises when a directory like `~/.claude` already exists on
   the host — the guidance says "configure source to `~/.claude`" which feels
   redundant because the user may expect lace to auto-detect it. The fix is to
   check whether the recommended path exists and adjust the message tone
   accordingly.

2. **Missing bind mount source warnings lack context:** The warning
   `Bind mount source does not exist: /path (target: /target)` doesn't explain
   what happens — Docker auto-creates the directory as root-owned, which is
   usually not what the user wants for bind mounts. It also doesn't distinguish
   between auto-created default paths (expected on first run) and user-configured
   override paths (likely a configuration error).

3. **Wrong project identifier in default paths:** As described above, the
   default path uses the worktree basename instead of the canonical project name.

### Prior Art

- **Worktree naming proposal:** `cdocs/proposals/2026-02-16-rfp-worktrunk-project-naming.md`
- **Naming status report:** `cdocs/reports/2026-02-16-worktree-naming-support-status.md`
- **Workspace detector:** `packages/lace/src/lib/workspace-detector.ts`
- **Project name derivation:** `packages/lace/src/lib/project-name.ts`

## Proposed Solution

### Core Change: Self-Classifying `deriveProjectId`

Make `deriveProjectId()` classify the workspace internally, so every caller
gets the correct project identifier without any signature changes elsewhere.
Extract the pure string sanitization into a separate helper so the munging
logic remains directly unit-testable.

```typescript
// repo-clones.ts

import { classifyWorkspace } from "./workspace-detector";
import { deriveProjectName } from "./project-name";

/**
 * Pure sanitization: lowercase, replace non-alphanumeric with hyphens,
 * collapse consecutive hyphens, strip trailing hyphens.
 */
export function sanitizeProjectId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "");
}

/**
 * Derive a filesystem-safe project identifier from a workspace path.
 * Classifies the workspace to handle worktree layouts — for a worktree at
 * /code/weft/lace/main/, returns "lace" (the bare-repo root name), not "main".
 * Classification results are cached per-process (see workspace-detector.ts).
 */
export function deriveProjectId(workspaceFolder: string): string {
  const cleanPath = workspaceFolder.replace(/\/+$/, "");
  const { classification } = classifyWorkspace(cleanPath);
  return sanitizeProjectId(deriveProjectName(classification, cleanPath));
}
```

The signature is unchanged — callers still pass a workspace path string and
get back a sanitized identifier. The internal `classifyWorkspace()` call is
transparent to them. `sanitizeProjectId` is exported separately for unit tests
that want to verify the string munging in isolation.

### Classification Cache

Since lace is a short-lived CLI process, a simple module-level cache in
`workspace-detector.ts` eliminates redundant filesystem probes. The same
workspace path always produces the same classification within a single process.

```typescript
// workspace-detector.ts

const classificationCache = new Map<string, ClassificationResult>();

export function classifyWorkspace(workspacePath: string): ClassificationResult {
  const absPath = resolve(workspacePath);
  const cached = classificationCache.get(absPath);
  if (cached) return cached;

  // ... existing classification logic (unchanged) ...

  const result = { classification, warnings };
  classificationCache.set(absPath, result);
  return result;
}
```

With the cache, the call pattern in `up.ts` — where `applyWorkspaceLayout`
classifies once in Phase 0a, then `MountPathResolver` and `runResolveMounts`
each call `deriveProjectId` which classifies again — costs one real probe and
two cache hits.

### No Downstream Signature Changes

Because `deriveProjectId` self-classifies, no other production function
signatures need to change:

- **`MountPathResolver`** constructor: unchanged. It calls
  `deriveProjectId(workspaceFolder)` which now returns the correct ID.
- **`runResolveMounts()`**: unchanged. Same mechanism.
- **`commands/resolve-mounts.ts`** (standalone CLI): unchanged. It calls
  `runResolveMounts({ workspaceFolder })` which internally calls
  `deriveProjectId` which self-classifies.
- **`up.ts`**: the only change is fixing the `projectName` fallback (see
  Phase 2) — no changes to the `MountPathResolver` or `runResolveMounts`
  call sites.

### Fix `projectName` Fallback in `up.ts`

The `projectName` variable in `up.ts` (used for Docker `--label` and `--name`)
currently falls back to `basename(workspaceFolder)` when no
`customizations.lace.workspace` config is present. With the classification
cache, fixing this is trivial:

```typescript
let projectName: string;
{
  const layoutResult = applyWorkspaceLayout(configMinimal.raw, workspaceFolder);
  // ... existing layout handling ...

  if (layoutResult.classification) {
    projectName = deriveProjectName(layoutResult.classification, workspaceFolder);
  } else {
    // Fallback: classify even without layout config. The cache ensures
    // this is free if classifyWorkspace was already called.
    const { classification } = classifyWorkspace(workspaceFolder);
    projectName = deriveProjectName(classification, workspaceFolder);
  }
}
```

### Improved Mount Guidance Output

#### Suppress Recommendation When Source Matches

When a mount's default path has been auto-created and the `recommendedSource`
field suggests a well-known host path (e.g., `~/.claude`), check whether the
recommended source actually exists on the host. If it does, upgrade the
recommendation to a more actionable message:

```
  project/claude-config: using default path ~/.config/lace/lace/mounts/project/claude-config
    → ~/.claude exists on host. Add to settings.json to use it instead of the default path.
```

If the recommended source does not exist:

```
  project/claude-config: using default path ~/.config/lace/lace/mounts/project/claude-config
    → Optional: configure source to ~/.claude in settings.json
```

This distinguishes "you should probably configure this" from "this is available
if you want it."

#### Improve Bind Mount Source Warnings

Replace the bare warning:

```
Warning: Bind mount source does not exist: /path (target: /target)
```

With context-aware messaging:

For auto-created default mount paths (source is under `~/.config/lace/`):

```
  project/bash-history: created default directory ~/.config/lace/lace/mounts/project/bash-history
```

For declaration-based mounts, this is informational, not a warning —
`MountPathResolver.resolveSource()` already calls `mkdirSync` synchronously to
auto-create default directories, so by the time the bind mount scan runs (after
template resolution), the directory exists and the warning does not fire for
these mounts.

The bind mount source warning in `up.ts` fires for a different set of mounts:
user-written entries in the `mounts` array (not processed by
`MountPathResolver`) and `workspaceMount` pointing to non-existent directories.
For these, the warning is legitimate but should be more informative:

```
Warning: Bind mount source does not exist: /path (target: /target)
  → Docker will auto-create this as a root-owned directory, which may cause permission issues.
```

> NOTE: `MountPathResolver.resolveSource()` throws a hard error for missing
> override paths (settings-configured sources that don't exist). The bind mount
> scan is a separate pass that catches user-written mounts with non-existent
> sources — a scenario the resolver never sees.

## Important Design Decisions

### Decision: Self-Classifying `deriveProjectId` with Extracted Pure Helper

**Decision:** Make `deriveProjectId()` call `classifyWorkspace()` internally
rather than accepting classification as a parameter. Extract the string
sanitization into a pure `sanitizeProjectId()` helper.

**Why:** The self-classifying approach requires 0 downstream signature changes
— `MountPathResolver`, `runResolveMounts`, and the standalone CLI command all
get correct behavior automatically. The alternative (passing classification as
an optional parameter) requires 4 signature changes and adds a parameter that
intermediate layers accept but don't use, purely to forward it.

The purity concern — `deriveProjectId` gains filesystem I/O — is addressed by
the extracted `sanitizeProjectId()` helper, which keeps the string munging
logic purely unit-testable. The filesystem behavior is confined to
`classifyWorkspace()`, which is cached per-process and adds negligible cost.

`deriveProjectId` and `sanitizeContainerName` remain separate functions with
different sanitization rules: `deriveProjectId` produces lowercase alphanumeric
with hyphens (filesystem-safe); `sanitizeContainerName` allows uppercase, dots,
and underscores (Docker `--name` compliance).

### Decision: Module-Level Classification Cache

**Decision:** Add a `Map<string, ClassificationResult>` cache to
`classifyWorkspace()` keyed by resolved absolute path.

**Why:** The lace CLI is short-lived (single `lace up` invocation), so a
process-lifetime cache needs no invalidation strategy. Classification involves
3–5 synchronous `stat`/`readFile` calls that are cheap individually but
redundant when the same workspace is classified multiple times per pipeline
run (`applyWorkspaceLayout` in Phase 0a, then `deriveProjectId` inside
`MountPathResolver`, then again inside `runResolveMounts`). The cache turns
these into one real probe and N-1 map lookups.

### Decision: Graduated Mount Guidance Instead of Silence

**Decision:** Keep showing mount guidance but make it context-aware, rather than
suppressing it entirely for configured mounts.

**Why:** Users need visibility into what lace is doing with their mount paths.
Silent auto-creation of directories in `~/.config/lace/` can be surprising.
The current output is useful — it just needs refinement to distinguish first-run
expected behavior from misconfiguration and to avoid showing redundant
recommendations.

### Decision: No Data Migration for Existing Mount Paths

**Decision:** Do not automatically move data from old worktree-named paths
(e.g., `~/.config/lace/main/mounts/`) to the corrected paths
(`~/.config/lace/lace/mounts/`).

**Why:** The auto-created default mount directories contain transient data
(bash command history, auto-created config stubs) that is not worth migrating.
The mount-assignments persistence file (`.lace/mount-assignments.json`) caches
resolved paths and will show stale entries after this change; staleness
detection (see E1) discards them and re-derives with the correct project ID.
Old directories can be cleaned up manually or left in place.

## Stories

### S1: Worktree User First Run

A user with a bare-repo worktree layout at `/code/weft/lace/main/` runs
`lace up` for the first time. Expected: mount default paths use
`~/.config/lace/lace/mounts/` (not `main`). The guidance output shows the
canonical project name `lace` in all paths. If `~/.claude` exists on the host,
the guidance suggests configuring it as a mount source.

### S2: Worktree User With Settings Override

Same user has `settings.json` with
`{ "mounts": { "project/claude-config": { "source": "~/.claude" } } }`.
Expected: the mount resolves to `~/.claude`, the guidance shows
`project/claude-config: ~/.claude (override)`, and no recommendation is shown.

### S3: Switching Between Worktrees

User runs `lace up` from `/code/weft/lace/main/`, then later from
`/code/weft/lace/feature-x/`. Expected: both use the same
`~/.config/lace/lace/mounts/` directory, sharing persistent mount state.

### S4: Normal Clone User (No Change)

A user with a standard git clone at `/code/my-project/` runs `lace up`.
Expected: behavior is identical to current behavior since
`basename(workspacePath)` equals the project name in both the old and new logic.

### S5: Standalone resolve-mounts Command

User runs `lace resolve-mounts --workspace-folder /code/weft/lace/main/`.
Expected: repo clones land in `~/.config/lace/lace/repos/` (not `main`).

## Edge Cases / Challenging Scenarios

### E1: Mount Persistence File Points to Old Paths

If `.lace/mount-assignments.json` was created with the old `main`-based paths,
the `MountPathResolver` will load and return those cached paths on subsequent
runs. The `resolveSource()` method returns cached `existing.resolvedSource`
immediately (without re-deriving), so stale paths persist indefinitely.

**Mitigation:** Add staleness detection to `MountPathResolver.load()`. After
loading persisted assignments, compare each non-override assignment's
`resolvedSource` path prefix against the currently derived `projectId`. If they
diverge, discard the stale assignment and log a warning:

```
Warning: Mount "project/bash-history" has stale path from old project ID "main".
  Re-deriving as "lace". Delete .lace/mount-assignments.json to suppress.
```

This is a trivial string comparison at load time (check whether
`resolvedSource` contains `/<oldProjectId>/mounts/` vs `/<currentProjectId>/mounts/`)
and prevents silent use of wrong paths. The discarded assignment will be
re-resolved with the correct project ID on the next `resolveSource()` call.

This detection is implemented in Phase 3, not deferred.

### E2: Same-Named Repos in Different Orgs

Two repos with the same basename (e.g., `/code/org-a/api/` and
`/code/org-b/api/`) will share the same mount directories under
`~/.config/lace/api/`. This is the same collision behavior as before, now also
affecting worktree repos. The existing escape hatch (user-configured override
paths in settings.json) applies. A future `customizations.lace.project` field
could provide a cleaner per-project override.

### E3: Classification Unavailable

When workspace classification fails (malformed `.git` file, missing `.bare/`
directory), `classifyWorkspace()` returns a `"malformed"` classification.
`deriveProjectName()` falls back to `basename(workspacePath)` for malformed
classifications, so `deriveProjectId()` will also fall back correctly. No
special handling needed.

### E4: Bind Mount Source Warning Scope

The bind mount source scan in `up.ts` (the "inferred mount validation" block
after template resolution) checks `existsSync()` on resolved mount sources.
Declaration-based mounts processed by `MountPathResolver` have their default
directories auto-created synchronously via `mkdirSync()` during template
resolution, so the scan will not fire warnings for those paths.

The scan fires for user-written mount entries in the `mounts` array (not
processed by `MountPathResolver`) and `workspaceMount`. These are legitimate
warnings. The unresolved-variable check (`source.includes('${')`) already skips
devcontainer template variables. No false positives are expected for the common
case. The UX improvement in Phase 5 adds context to these legitimate warnings.

## Implementation Phases

Phases are listed in execution order.

### Phase 1: Self-Classifying `deriveProjectId` + Classification Cache

**Files:** `packages/lace/src/lib/repo-clones.ts`,
`packages/lace/src/lib/workspace-detector.ts`,
`packages/lace/src/lib/__tests__/repo-clones.test.ts`

**Changes to `repo-clones.ts`:**
- Extract existing sanitization into `sanitizeProjectId(name)` — pure function,
  exported for direct unit testing.
- Rewrite `deriveProjectId(workspaceFolder)` to call `classifyWorkspace()`
  internally, then `deriveProjectName()`, then `sanitizeProjectId()`.
- Fix trailing-dash edge case: add `.replace(/-$/, "")` to sanitization.
- Signature is unchanged — still `(workspaceFolder: string) => string`.

**Changes to `workspace-detector.ts`:**
- Add module-level `Map<string, ClassificationResult>` cache.
- On entry to `classifyWorkspace()`, check cache by resolved absolute path.
  Return cached result on hit; populate cache on miss.
- Export a `clearClassificationCache()` for tests that need a clean slate.

**Tests:**
- Unit tests for `sanitizeProjectId`: existing sanitization cases
  (lowercase, non-alphanumeric replacement, hyphen collapsing) plus new
  trailing-dash strip. Idempotency guard.
- `deriveProjectId` with worktree workspace filesystem fixture → returns
  bare-repo basename not worktree basename.
- `deriveProjectId` with normal clone → returns same as before.
- Cache test: call `classifyWorkspace()` twice for the same path → second
  call returns the identical object reference.

**Verification:** Existing `deriveProjectId` tests pass (behavior unchanged for
normal clones). New tests verify worktree behavior and cache.

### Phase 2: Fix `projectName` Fallback in `up.ts`

**Files:** `packages/lace/src/lib/up.ts`

**Changes:**

The current `projectName` fallback at the top of `runUp()` uses
`basename(workspaceFolder)` when no `customizations.lace.workspace` config is
present. Replace with a `classifyWorkspace()` fallback — the cache ensures
this is free since Phase 0a already classified (when workspace config is
present) or the first downstream `deriveProjectId` call will classify anyway.

```typescript
let projectName: string;
{
  const layoutResult = applyWorkspaceLayout(configMinimal.raw, workspaceFolder);
  // ... existing layout handling ...

  if (layoutResult.classification) {
    projectName = deriveProjectName(layoutResult.classification, workspaceFolder);
  } else {
    const { classification } = classifyWorkspace(workspaceFolder);
    projectName = deriveProjectName(classification, workspaceFolder);
  }
}
```

**Verification:**
- Integration test: worktree workspace *without* `customizations.lace.workspace`
  config → `projectName` is derived from bare-repo root, not worktree basename.

### Phase 3: Mount Persistence Staleness Detection

**Files:** `packages/lace/src/lib/mount-resolver.ts`,
`packages/lace/src/lib/__tests__/mount-resolver.test.ts`

**Changes:**

`MountPathResolver.load()` gains staleness detection. After loading persisted
assignments, compare each non-override assignment's `resolvedSource` against
the current `projectId` (which is now correct thanks to Phase 1). If the path
contains a different project ID segment, discard the stale entry and log a
warning.

No signature changes — `MountPathResolver` constructor still calls
`deriveProjectId(workspaceFolder)` which now self-classifies.

**Side effect:** Mount guidance output paths change for worktree users (from
`~/.config/lace/main/mounts/...` to `~/.config/lace/lace/mounts/...`). This is
the desired outcome.

**Verification:**
- Unit test: `MountPathResolver` with stale persistence file (paths containing
  old project ID) → stale entries discarded with warning, fresh resolution
  produces correct paths.
- Integration test: worktree workspace with `MountPathResolver` → default
  path uses bare-repo basename.
- Integration test: two worktree workspaces from the same bare repo produce the
  same `projectId` (Story S3).
- Integration test: `runResolveMounts` with worktree workspace folder produces
  repo clone paths under the bare-repo basename (Story S5).

### Phase 4: Update Test Assertions

**Files:**
- `packages/lace/src/lib/__tests__/mount-resolver.test.ts`
- `packages/lace/src/lib/__tests__/repo-clones.test.ts`
- `packages/lace/src/lib/__tests__/up-mount.integration.test.ts`
- `packages/lace/src/lib/__tests__/up-project-name.integration.test.ts`
- `packages/lace/src/lib/__tests__/template-resolver.test.ts`

**Changes:**

Since `deriveProjectId` now self-classifies, tests that call it with a temp
directory path will get a `not-git` classification (no `.git` present), which
falls back to `basename()` — same as the old behavior. These tests pass without
changes.

Tests that set up worktree filesystem fixtures will now get the correct
worktree-aware project ID. Update assertions in these tests to expect the
bare-repo basename. Add new worktree-specific test cases where missing.

Existing "uses workspace folder basename" tests are unaffected since
non-git directories still use basename through the `not-git` classification
path.

**Verification:** Full test suite passes. No reduction in coverage.

### Phase 5: Improve Mount Guidance UX

**Files:** `packages/lace/src/lib/template-resolver.ts` (`emitMountGuidance`),
`packages/lace/src/lib/up.ts` (bind mount source warning scan)

**Changes to `emitMountGuidance`:**
- When a default-path mount has a `recommendedSource`, check
  `existsSync(expandPath(recommendedSource))`.
  - If it exists: `→ <recommendedSource> exists on host. Configure in settings.json to use it.`
  - If it doesn't exist: `→ Optional: configure source to <recommendedSource> in settings.json`
- Reword the settings.json example block to be less imperative when all
  recommendations are optional.

**Changes to bind mount source warning scan (up.ts):**

The bind mount scan fires for user-written mounts in the `mounts` array and
`workspaceMount` — not for declaration-based mounts (which are auto-created by
`MountPathResolver` before the scan runs). The improvement targets these
user-written mounts:

- For missing sources, add context: `Docker will auto-create this as a
  root-owned directory, which may cause permission issues.`
- Consider distinguishing `workspaceMount` warnings (critical — the container
  won't function properly) from optional mount warnings (less critical).

**Verification:**
- Unit test `emitMountGuidance` with `recommendedSource` where host path exists
  → verify upgraded message.
- Unit test `emitMountGuidance` with `recommendedSource` where host path doesn't
  exist → verify softened message.
- Integration test: user-written mount with non-existent source → verify
  warning includes Docker auto-create context.
