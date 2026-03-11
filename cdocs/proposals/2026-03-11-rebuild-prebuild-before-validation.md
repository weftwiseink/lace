---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T12:00:00-06:00
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-03-11T13:00:00-06:00
  round: 1
task_list: lace/up-pipeline
type: proposal
state: live
status: review_ready
tags: [lace-up, pipeline-ordering, rebuild, prebuild, workspace-validation, git-extensions, docker-no-cache]
related_to:
  - cdocs/proposals/2026-03-10-git-relativeworktrees-version-mismatch.md
  - cdocs/proposals/2026-02-15-workspace-validation-and-layout.md
---

# Reorder `lace up` Pipeline: Run Prebuild Before Validation When `--rebuild` Is Set

> BLUF: When `--rebuild` is set, `lace up` should run the prebuild phase
> *before* workspace layout validation (Phase 0a). Currently, the pipeline
> always runs workspace layout validation first, which checks for git
> extensions like `relativeWorktrees`. When the user has configured
> `"version": "latest"` on the git prebuild feature to fix the container's
> git version, the prebuild must execute first so the rebuilt image has the
> upgraded git. But validation blocks the pipeline before prebuild can run
> -- a chicken-and-egg deadlock. The fix is a conditional reorder: when
> `rebuild` is true, run config reading, prebuild, then validation. Normal
> `lace up` (no `--rebuild`) retains the current ordering. Validation
> remains a hard error -- it is not downgraded to a warning.
> Additionally, when `force` is true in `runPrebuild()`, the
> `devcontainer build` subprocess must receive `--no-cache` to bypass
> Docker's build cache. Without this, Docker can reuse stale cached
> layers (e.g., an old git version) even when the user has changed
> feature configuration, defeating the purpose of `--rebuild`.

## Objective

Unblock `lace up --rebuild` when the repository uses git extensions that
require a newer git version than the container's current image provides.
The user has already configured the fix (git feature with `"version":
"latest"` in `prebuildFeatures`), but the pipeline cannot reach the
prebuild phase because validation rejects the workspace first.

## Background

### The Chicken-and-Egg Problem

The `lace up` pipeline in `runUp()` (`packages/lace/src/lib/up.ts`) runs
phases in this order:

1. **Read config** (minimal parse of devcontainer.json)
2. **Phase 0a: Workspace layout** (`applyWorkspaceLayout`) -- classifies
   the workspace, checks for absolute gitdir paths, checks for
   unsupported git extensions, and mutates the config with
   workspaceMount/workspaceFolder
3. **Phase 0b: Host validation** (`runHostValidation`) -- file-existence
   checks from `customizations.lace.validate`
4. **Metadata fetch + validation** -- fetch OCI metadata for features,
   validate options and port declarations
5. **Template resolution** -- auto-inject and resolve `${lace.port()}`
   and `${lace.mount()}` templates
6. **Prebuild** -- build the prebuild image with `devcontainer build`
7. **Resolve mounts** -- clone/check repo mounts
8. **Generate extended config** -- write `.lace/devcontainer.json`
9. **Devcontainer up** -- invoke `devcontainer up`

The git extension validation (added in the `2026-03-10-git-relativeworktrees-version-mismatch`
proposal) runs in Phase 0a. It detects that the repository uses
`extensions.relativeWorktrees` (requiring git 2.48+) and emits a fatal
error because the container's current prebuild image has git 2.39.x.

The fix for the container's git version is to set `"version": "latest"`
on the `ghcr.io/devcontainers/features/git:1` prebuild feature. But this
fix lives inside the prebuild image, which is rebuilt in Phase 6.
Validation in Phase 0a blocks the pipeline before Phase 6 executes.

The user cannot reach the prebuild to apply the fix because validation
rejects the workspace based on the *current* (stale) image state.

### What `--rebuild` Means

The `--rebuild` flag (`UpOptions.rebuild`) passes `force: true` to
`runPrebuild()`, which bypasses the prebuild cache and forces a full
`devcontainer build`. This is the mechanism the user invokes after
changing prebuild feature configuration (e.g., adding `"version":
"latest"` to the git feature).

### Docker Build Cache Problem

Even when `force: true` bypasses the lace-level prebuild cache (the
`contextsChanged` check), Docker's own build cache can cause the
`devcontainer build` subprocess to reuse stale layers. This is because
the `devcontainer build` command is currently invoked without
`--no-cache`. When a feature like `ghcr.io/devcontainers/features/git:1`
is configured with `"version": "latest"`, Docker sees the same
Dockerfile instructions and feature install layer, considers them
unchanged, and reuses the cached layer -- which still contains the old
git version. The user hit this exact scenario: `--rebuild` was set,
lace's prebuild cache was bypassed, but Docker served the cached layer
with git 2.39.x instead of building a fresh layer with the latest git.

The workaround was `docker builder prune -f`, which nukes the entire
build cache. The proper fix is to pass `--no-cache` to
`devcontainer build` when `force: true`, ensuring Docker rebuilds all
layers from scratch. This makes `--rebuild` truly mean "rebuild
everything."

### Why Not Downgrade to Warnings?

The user explicitly rejected downgrading validation errors to warnings.
The git extension check catches a real problem: if the container's git
cannot handle `extensions.relativeWorktrees`, all git operations inside
the container will fail with a fatal error. The validation is valuable
and should remain a hard blocker under normal operation.

The issue is specifically the ordering: when `--rebuild` is set, the
user is actively fixing the problem. The pipeline should let them.

### What Phases Depend on What

Analysis of `runUp()` phase dependencies:

| Phase | Depends On | Produces |
|-------|-----------|----------|
| Read config (minimal) | Nothing | `configMinimal.raw` |
| Workspace layout (0a) | `configMinimal.raw`, filesystem | Config mutations (workspaceMount, workspaceFolder, postCreateCommand), `projectName` |
| Host validation (0b) | `configMinimal.raw` | Pass/fail |
| Metadata fetch | `configMinimal.raw` (feature IDs) | `metadataMap` |
| Template resolution | `configMinimal.raw`, `metadataMap` | `templateResult`, `configForResolution` |
| Read config (full) | `configMinimal.raw` (needs Dockerfile) | `config` (for prebuild) |
| **Prebuild** | `configMinimal.raw` (prebuild features), filesystem | Rebuilt Docker image, rewritten Dockerfile/image |
| Resolve mounts | `configMinimal.raw`, filesystem | `mountSpecs`, `symlinkCommand` |
| Generate config | All above | `.lace/devcontainer.json` |
| Devcontainer up | Generated config | Running container |

Key insight: **Prebuild does not depend on workspace layout validation.**
Prebuild reads the devcontainer.json, extracts prebuild features, and
runs `devcontainer build`. It does not use `workspaceMount`,
`workspaceFolder`, `projectName`, or any output from Phase 0a/0b.

Conversely, **workspace layout validation does not depend on prebuild.**
It reads git config files on the host filesystem. The prebuild image's
git version is irrelevant to the host-side check.

However, the *purpose* of the validation is to prevent launching a
container with an inadequate git version. When `--rebuild` is forcing a
rebuild with an upgraded git feature, the validation should run *after*
the rebuild to check whether the problem is now resolved -- but since
the validation checks the *host* repo config (not the container), it
will still detect the extensions. The difference is that after a
successful rebuild, the user's prebuild image now contains a git version
that supports the extensions, so the validation concern is addressed.

> NOTE: The validation currently has no way to know whether the rebuilt
> image's git supports the detected extensions. It checks the host repo
> config and assumes the container's git cannot handle unrecognized
> extensions. The `--rebuild` reorder is a pragmatic fix: if the user is
> actively rebuilding, trust that they are addressing the issue. A future
> enhancement could inspect the rebuilt image's git version, but that is
> out of scope.

## Proposed Solution

### Approach: Conditional Phase Reorder with Deferred Validation

When `rebuild` is true AND `hasPrebuildFeatures` is true, reorder the
early pipeline phases so that prebuild runs before workspace layout
validation. The rest of the pipeline remains unchanged.

#### Normal Pipeline (no `--rebuild`)

```
Read config -> Phase 0a (workspace layout) -> Phase 0b (host validation)
-> Metadata -> Templates -> Prebuild -> Mounts -> Generate -> Up
```

#### Rebuild Pipeline (`--rebuild`)

```
Read config -> Prebuild -> Phase 0a (workspace layout) -> Phase 0b (host validation)
-> Metadata -> Templates -> Mounts -> Generate -> Up
```

The only change is that prebuild moves from after templates to before
Phase 0a.

#### Why Prebuild Can Move Earlier

Prebuild needs:
1. `configMinimal.raw` (to extract prebuild features) -- available after
   config read
2. The workspace filesystem (Dockerfile path) -- always available
3. `rebuild` flag -- passed through from options

Prebuild does NOT need:
- Workspace layout mutations (workspaceMount, workspaceFolder)
- Host validation results
- Feature metadata
- Template resolution results
- Resolved mounts

This means prebuild can safely run immediately after config reading.

#### Why Validation Still Runs After Prebuild

Even though the prebuild has updated the container image, the workspace
layout validation still runs. This serves two purposes:

1. It validates other workspace layout concerns (absolute gitdir paths,
   layout type mismatches) that prebuild does not fix.
2. For the git extension check specifically: when `--rebuild` is set, the
   validation still detects the extensions but the user has already taken
   action (rebuilding with upgraded git). The proposal includes skipping
   the `unsupported-extension` error specifically when `--rebuild` was
   used and prebuild succeeded, since the user is actively addressing it.

### Implementation Detail

#### Pipeline Reorder in `runUp()`

In `runUp()`, add a conditional block between config reading (line ~138)
and Phase 0a (line ~140). The `hasPrebuildFeatures` check must be
extracted early (before its current position at line ~207):

```typescript
// Extract early to gate the conditional reorder
const hasPrebuildFeatures =
  extractPrebuildFeatures(configMinimal.raw).kind === "features";
let prebuildCompleted = false;

// When --rebuild is set and prebuild features exist, run prebuild FIRST
// to break the chicken-and-egg with git extension validation.
if (rebuild && hasPrebuildFeatures) {
  // Run prebuild early (before validation)
  const earlyPrebuildResult = runPrebuild({
    workspaceRoot: workspaceFolder,
    subprocess,
    force: true,
  });
  if (earlyPrebuildResult.exitCode !== 0) {
    result.phases.prebuild = {
      exitCode: earlyPrebuildResult.exitCode,
      message: earlyPrebuildResult.message,
    };
    result.exitCode = earlyPrebuildResult.exitCode;
    result.message = `Prebuild failed: ${earlyPrebuildResult.message}`;
    return result;
  }
  result.phases.prebuild = {
    exitCode: 0,
    message: earlyPrebuildResult.message,
  };
  prebuildCompleted = true;
}

// Phase 0a: Workspace layout (runs after prebuild when --rebuild)
// Phase 0b: Host validation
// ... rest of pipeline, with prebuild phase skipped if already done
```

The prebuild code itself is already factored as a call to
`runPrebuild()`. The early invocation uses the same function with the
same parameters. A boolean flag tracks whether prebuild already ran so
the later prebuild phase is skipped.

#### Pass `--no-cache` to `devcontainer build` When `force` Is True

In `runPrebuild()` (`packages/lace/src/lib/prebuild.ts`, around line
287), the `devcontainer build` subprocess is invoked without
`--no-cache`. When `options.force` is true, `--no-cache` must be added
to the build args to bypass Docker's build cache. Without this, Docker
can reuse stale cached layers even though lace's prebuild cache was
bypassed, defeating the purpose of `--rebuild`.

```typescript
const buildArgs = [
  "build",
  "--workspace-folder",
  prebuildDir,
  "--config",
  join(prebuildDir, "devcontainer.json"),
  "--image-name",
  prebuildTag,
];

// When force-rebuilding, bypass Docker's build cache so that features
// with floating tags (e.g., "version": "latest") are re-fetched and
// reinstalled from scratch.
if (options.force) {
  buildArgs.push("--no-cache");
}

const buildResult = run("devcontainer", buildArgs, { cwd: workspaceRoot });
```

This ensures that `--rebuild` produces a truly clean image. Without
`--no-cache`, a user who changes `"version": "latest"` on the git
feature and runs `lace up --rebuild` may still get the old git version
because Docker cached the feature install layer.

### Handling the Validation After Early Prebuild

When prebuild runs early due to `--rebuild`, the workspace layout
validation (Phase 0a) still executes. For the `unsupported-extension`
error specifically, the validation should be relaxed when prebuild has
already succeeded with `--rebuild`:

- The `applyWorkspaceLayout` function does not change. It still returns
  `status: "error"` for unsupported extensions.
- In `runUp()`, when `rebuild` is true and prebuild succeeded, the
  `unsupported-extension` error from workspace layout is downgraded to a
  warning. Other workspace layout errors (absolute gitdir, layout
  mismatch) remain fatal.

This is NOT a general downgrade of validation. It is a targeted
relaxation: "you said `--rebuild`, prebuild succeeded, so we trust you
fixed the git version issue."

To avoid fragile string-matching on error messages, add a structured
`errorCode` field to `WorkspaceLayoutResult`. This is a minimal,
backwards-compatible change to `workspace-layout.ts`:

```typescript
export interface WorkspaceLayoutResult {
  status: "skipped" | "applied" | "error";
  message: string;
  warnings: string[];
  classification?: WorkspaceClassification;
  /** Structured error code when status === "error". */
  errorCode?: "absolute-gitdir" | "unsupported-extension" | "layout-mismatch" | "detection-failed";
}
```

Each existing error return in `applyWorkspaceLayout` sets the
appropriate `errorCode`. Then `runUp()` discriminates on the code
rather than the message string:

```typescript
if (layoutResult.status === "error" && rebuild && prebuildCompleted) {
  if (layoutResult.errorCode === "unsupported-extension") {
    console.warn(`Warning: ${layoutResult.message} (continuing due to --rebuild)`);
    result.phases.workspaceLayout = { exitCode: 0, message: `${layoutResult.message} (rebuild override)` };
  } else {
    // Non-extension errors remain fatal even with --rebuild
    result.phases.workspaceLayout = { exitCode: 1, message: layoutResult.message };
    result.exitCode = 1;
    result.message = `Workspace layout failed: ${layoutResult.message}`;
    return result;
  }
}
```

> NOTE: This relaxes the constraint "Do NOT modify workspace-layout.ts"
> minimally -- only adding an optional field to the return type and
> setting it in each error branch. The function's behavior and existing
> return values do not change. This is much safer than string-matching
> on error messages, which would silently break if the wording changes.

## Important Design Decisions

### Decision: Conditional Reorder, Not Two Separate Pipeline Functions

**Decision:** Add a conditional early-prebuild block within the existing
`runUp()` function rather than creating two separate pipeline paths
(e.g., `runUpNormal()` and `runUpRebuild()`).

**Why:** The two pipelines differ in exactly one phase's position.
Creating two separate functions would duplicate the entire pipeline logic
and create a maintenance burden where changes to one path must be
mirrored in the other. A conditional block with a `prebuildCompleted`
flag is minimal, clear, and keeps all pipeline logic in one place.

### Decision: Prebuild Moves Before ALL Validation, Not Just Extension Check

**Decision:** When `--rebuild` triggers early prebuild, it runs before
both Phase 0a (workspace layout) and Phase 0b (host validation), not
just before the git extension check.

**Why:** The prebuild does not depend on any validation output. Moving it
before all validation is simpler and more robust than trying to run
partial validation, then prebuild, then remaining validation. The
validation phases are fast (filesystem reads) so running them after
prebuild adds negligible latency. This also future-proofs against new
validation checks that might have similar chicken-and-egg issues.

### Decision: Only Skip Extension Errors, Not All Layout Errors

**Decision:** After early prebuild with `--rebuild`, only the
`unsupported-extension` workspace layout error is downgraded. Other
layout errors (absolute gitdir paths, layout type mismatch) remain
fatal.

**Why:** The `--rebuild` flag specifically addresses the "container git
version is too old" problem. It does not fix absolute gitdir paths
(which are a host filesystem issue) or layout mismatches (which are
configuration errors). Downgrading those errors would mask real problems
that `--rebuild` cannot fix.

### Decision: Do Not Parse the Rebuilt Image's Git Version

**Decision:** After early prebuild, do not inspect the rebuilt Docker
image to verify that its git version now supports the detected
extensions. Instead, trust that the user's configuration change
(e.g., `"version": "latest"`) addresses the issue.

**Why:** Inspecting the image's git version would require running
`docker run <image> git --version`, which adds latency and complexity.
The prebuild succeeded, meaning the `devcontainer build` with the
updated git feature completed without error. If the user configured
`"version": "latest"`, the image has git 2.48+. If the user configured
an insufficient version, the problem will surface at container startup
-- the same failure mode as any other misconfiguration. The validation
warning still appears to alert the user.

### Decision: Reorder Applies Only When Both `--rebuild` AND `hasPrebuildFeatures`

**Decision:** The early prebuild only triggers when `rebuild` is true AND
the config has prebuild features. If `--rebuild` is set but there are no
prebuild features, the normal pipeline runs.

**Why:** Without prebuild features, there is nothing to rebuild. The
`--rebuild` flag is meaningless in that case. Running the normal pipeline
avoids confusing behavior where `--rebuild` changes phase ordering for
no reason.

## Stories

### S1: User Adds Git Feature to Fix Extension Mismatch

The user's bare-repo has `extensions.relativeWorktrees = true`. Their
existing prebuild image has git 2.39.x. They add `"version": "latest"`
to the git prebuild feature and run `lace up --rebuild`.

**Current behavior:** Pipeline fails at Phase 0a with "Repository uses
git extensions that the container's git may not support."

**Expected behavior:** Prebuild runs first (building an image with git
2.48+), then validation runs with the extension warning downgraded to a
message. Container starts successfully.

### S2: User Runs Normal `lace up` After Fixing

After S1 succeeds and the prebuild image is cached, the user runs
`lace up` (no `--rebuild`). The prebuild phase sees the cache is fresh
and skips. Validation still detects the extensions but the prebuild
image now has the right git.

**Problem:** The validation will still fail because it cannot know the
image's git version.

**Handling:** This is an existing limitation. The user can use
`--skip-validation` for subsequent runs. A future enhancement could
check the prebuild image's git version. See Edge Cases E3.

### S3: Normal `lace up` Without Extensions

A user without git extensions runs `lace up`. No workspace layout
errors. Pipeline runs in the normal order.

**Expected behavior:** Identical to current behavior. No changes.

## Edge Cases / Challenging Scenarios

### E1: Early Prebuild Fails

The user runs `lace up --rebuild` but the prebuild fails (e.g., network
error downloading git source, Docker build error).

**Handling:** The pipeline returns the prebuild error immediately, same
as it would if prebuild failed in its normal position. Validation never
runs. The `prebuildCompleted` flag remains false.

### E2: Workspace Has Non-Extension Errors

The user runs `lace up --rebuild` on a workspace with both unsupported
extensions AND absolute gitdir paths.

**Handling:** Prebuild runs first and succeeds. Validation then runs.
`applyWorkspaceLayout` checks absolute gitdir paths BEFORE extensions
(lines 108-121 vs 124-140 in `workspace-layout.ts`). When both are
present, only the absolute-gitdir error is returned -- the extension
check never executes. The `errorCode` is `"absolute-gitdir"`, not
`"unsupported-extension"`, so `runUp()` treats it as fatal even with
`--rebuild`. The user must fix the absolute paths first. Once fixed,
a subsequent `lace up --rebuild` would then hit the extension check,
which would be downgraded.

### E3: Subsequent `lace up` Without `--rebuild` Still Fails Validation

After a successful `lace up --rebuild`, the user runs `lace up` for
routine use. The prebuild cache is fresh so prebuild is a no-op. But
validation still detects the git extensions and fails because the
pipeline runs in normal order (validation before prebuild) and the
extension check has no way to know the image's git is adequate.

**Handling:** This is a known limitation. The user must use
`--skip-validation` for subsequent runs until a future enhancement adds
image-aware validation. Document this in the CLI output when the
`--rebuild` override triggers:

```
Warning: Repository uses git extensions... (continuing due to --rebuild)
  Note: Subsequent runs without --rebuild will need --skip-validation
  until the container's git version can be verified automatically.
```

> NOTE: A future enhancement could persist a marker (e.g., in
> `.lace/prebuild/metadata.json`) recording that the last successful
> rebuild used a git feature with `"version": "latest"`. The validation
> phase could read this marker and suppress the extension warning
> automatically. This is out of scope for this proposal but would
> eliminate the need for `--skip-validation` on subsequent runs.

### E4: `--rebuild` Without Prebuild Features

The user runs `lace up --rebuild` on a config that has no
`prebuildFeatures`. The `hasPrebuildFeatures` check is false, so the
early prebuild block is skipped. The pipeline runs in normal order.
Validation runs normally and may fail.

**Handling:** This is correct behavior. `--rebuild` without prebuild
features is effectively a no-op for the prebuild phase. The pipeline
should not change ordering for no reason.

### E5: Config Has Prebuild Features But No Git Feature

The user runs `lace up --rebuild` on a config that has prebuild features
(e.g., claude-code) but not the git feature. Prebuild runs early and
succeeds, but the rebuilt image still has old git.

**Handling:** The extension warning is still downgraded because
`--rebuild` was set and prebuild succeeded. But the container will still
have git 2.39.x and git operations will fail inside the container. The
user will discover this at runtime. The warning message should be clear:

```
Warning: Repository uses git extensions that the container's git may
  not support. The prebuild was rebuilt with --rebuild but may not
  include a git version that supports these extensions.
```

This is a user configuration error, not a pipeline ordering issue. The
pipeline correctly allowed the rebuild and warned about the remaining
risk.

### E6: `--no-cache` Build Takes Longer Than Cached Build

When `force` is true, `--no-cache` causes `devcontainer build` to
rebuild all layers from scratch, including downloading base images and
re-running feature install scripts. This is significantly slower than a
cached build.

**Handling:** This is expected and acceptable. The user explicitly
requested `--rebuild`, which signals intent to pay the cost of a full
rebuild. The alternative (cached builds silently serving stale layers)
is worse because it defeats the purpose of `--rebuild` and forces the
user to manually run `docker builder prune -f`. The `--no-cache` flag
only applies when `force` is true; normal prebuild runs (including cache
misses without `--force`) still benefit from Docker's build cache.

### E7: Workspace Layout Mutations Needed Before Prebuild

In the current pipeline, workspace layout mutations (workspaceMount,
workspaceFolder, postCreateCommand) happen in Phase 0a before everything
else. Prebuild does NOT use any of these mutations -- it reads the
devcontainer.json directly and operates on the Dockerfile/image field.
The mutations only affect the generated extended config.

**Handling:** No issue. Prebuild is self-contained and does not depend on
workspace layout mutations. The mutations still happen in Phase 0a, just
after prebuild instead of before it.

## Test Plan

### Unit Tests in `up.integration.test.ts`

**T1: `--rebuild` reorders prebuild before validation**

Create a workspace with:
- Bare-repo layout with `extensions.relativeWorktrees = true` in git config
- `workspace.layout: "bare-worktree"` in devcontainer.json
- Prebuild features configured
- `rebuild: true`

Verify:
- `result.exitCode === 0`
- `result.phases.prebuild.exitCode === 0`
- `result.phases.workspaceLayout.exitCode === 0`
- `result.phases.workspaceLayout.message` contains "rebuild override"
- Mock calls show `devcontainer build` was called before any validation
  failure

**T2: Normal `lace up` still fails validation with extensions**

Same workspace as T1 but with `rebuild: false`.

Verify:
- `result.exitCode === 1`
- `result.phases.workspaceLayout.exitCode === 1`
- `result.phases.workspaceLayout.message` contains "git extensions"
- `result.phases.prebuild` is undefined (never reached)

**T3: `--rebuild` with prebuild failure returns error**

Same workspace as T1 but with a mock subprocess that fails
`devcontainer build`.

Verify:
- `result.exitCode !== 0`
- `result.phases.prebuild.exitCode !== 0`
- `result.phases.workspaceLayout` is undefined (skipped because prebuild
  failed early)

**T4: `--rebuild` does not downgrade non-extension errors**

Create a workspace with absolute gitdir paths (not git extensions) and
`rebuild: true`.

Verify:
- `result.exitCode === 1`
- `result.phases.workspaceLayout.exitCode === 1`
- `result.phases.workspaceLayout.message` contains "absolute gitdir"
- Prebuild ran successfully before the error

**T5: `--rebuild` without prebuild features uses normal ordering**

Create a workspace with git extensions but no prebuild features, and
`rebuild: true`.

Verify:
- Pipeline fails at workspace layout (normal ordering)
- No early prebuild attempted
- `result.phases.prebuild` is undefined

**T6: Normal `lace up` without extensions is unchanged**

Existing test coverage -- verify no regression for workspaces without
git extensions.

### Unit Tests in `prebuild.integration.test.ts`

**T7: `runPrebuild` with `force: true` passes `--no-cache` to `devcontainer build`**

Call `runPrebuild({ force: true, ... })` with a mock subprocess runner.

Verify:
- The mock subprocess was called with `devcontainer` and args that
  include `--no-cache`
- The `--no-cache` flag appears after `build` in the args array

**T8: `runPrebuild` without `force` does NOT pass `--no-cache`**

Call `runPrebuild({ force: false, ... })` (or `runPrebuild({})`) with a
mock subprocess runner, using a setup where the prebuild cache is stale
so the build actually runs.

Verify:
- The mock subprocess was called with `devcontainer` and args that do
  NOT include `--no-cache`

### Unit Tests in `workspace-layout.test.ts`

Minimal changes: verify that `applyWorkspaceLayout` returns the correct
`errorCode` for each error type. The existing tests already assert on
`status` and `message`; add assertions that `errorCode` is set to the
expected value (`"absolute-gitdir"`, `"unsupported-extension"`,
`"layout-mismatch"`, `"detection-failed"`) in each error case.

## Implementation Phases

### Phase 1: Add Early Prebuild Block in `runUp()` and `--no-cache` in `runPrebuild()`

**Changes:**
- `packages/lace/src/lib/up.ts`:
  - Between config reading (line ~138) and Phase 0a (line ~140), add a
    conditional early-prebuild block. This requires extracting
    `hasPrebuildFeatures` earlier than its current location (line ~207,
    which is after both validation phases). Move the
    `extractPrebuildFeatures` call into the early block:
    ```typescript
    const hasPrebuildFeatures =
      extractPrebuildFeatures(configMinimal.raw).kind === "features";
    if (rebuild && hasPrebuildFeatures) { ... }
    ```
  - Inside the early block: run `runPrebuild()` with `force: true`.
  - Track `prebuildCompleted` boolean.
  - In the existing prebuild phase (line ~558), skip if
    `prebuildCompleted` is true.
  - In the Phase 0a handling, add a branch: if `rebuild &&
    prebuildCompleted` and `layoutResult.errorCode ===
    "unsupported-extension"`, downgrade to a warning instead of
    returning an error.
  - The full config read (needed for prebuild's Dockerfile parsing) must
    also move into the early block when applicable.
  - The `hasPrebuildFeatures` extraction at line ~207 can remain (it is
    idempotent and still needed for the normal-path prebuild phase
    guard), or be replaced with a reference to the already-computed
    value.
- `packages/lace/src/lib/prebuild.ts`:
  - In `runPrebuild()`, conditionally add `--no-cache` to the
    `devcontainer build` args when `options.force` is true. This ensures
    Docker rebuilds all layers from scratch, preventing stale cached
    layers from serving old feature versions (e.g., git 2.39.x when
    `"version": "latest"` was configured).

**Constraints:**
- `workspace-layout.ts`: Only add an optional `errorCode` field to
  `WorkspaceLayoutResult` and set it in each existing error return. Do
  NOT change the function's behavior, control flow, or existing return
  values.
- Do NOT modify `workspace-detector.ts`.
- Do NOT change behavior when `rebuild` is false.
- Do NOT add new options or flags.

**Success criteria:**
- `lace up --rebuild` succeeds on a workspace with
  `extensions.relativeWorktrees` and a git prebuild feature with
  `"version": "latest"`.
- `lace up` (without `--rebuild`) still fails validation on the same
  workspace.
- When `force: true`, the `devcontainer build` subprocess receives
  `--no-cache` in its args.
- When `force: false` (or unset), the `devcontainer build` subprocess
  does NOT receive `--no-cache`.
- All existing tests pass without modification.

### Phase 2: Add Integration and Unit Tests

**Changes:**
- `packages/lace/src/commands/__tests__/up.integration.test.ts`: Add
  tests T1-T6 as described in the Test Plan section.
- `packages/lace/src/commands/__tests__/prebuild.integration.test.ts`:
  Add tests T7-T8 to verify `--no-cache` is conditionally passed to
  `devcontainer build` (using existing mock subprocess infrastructure).
- May need a helper to create bare-repo fixtures with git extension
  configs (similar to existing `createBareRepoWorkspace` helper).

**Constraints:**
- Use existing test infrastructure (mock subprocess, temp directories).
- Tests must be self-contained (no dependency on host git version).

**Success criteria:**
- All new tests pass.
- All existing tests pass.
- Test coverage confirms the conditional reorder triggers only when
  expected.

### Phase 3 (future, out of scope): Persistent Prebuild Git Version Marker

Record the git feature version from the last successful prebuild in
`.lace/prebuild/metadata.json`. During workspace layout validation,
check this marker to suppress the `unsupported-extension` error
automatically without requiring `--rebuild` or `--skip-validation` on
subsequent runs. This eliminates the UX friction described in Edge Case
E3.
