---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-18T00:00:00-07:00
task_list: lace/devcontainer-lifecycle
type: proposal
state: archived
status: implementation_accepted
tags: [rebuild, config-drift, devcontainer, wez-into, bug-fix]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-19T00:00:00-07:00
  round: 2
---

# Fix `--rebuild` Cascading and Add Config Drift Detection

> BLUF: `lace up --rebuild` silently fails to cascade to the container runtime
> because `--rebuild` is only forwarded to the prebuild phase. The fix has two
> parts: (1) forward `--rebuild` to `devcontainer up` so explicit rebuilds work,
> and (2) add config drift detection so `lace up` can warn or auto-rebuild when
> runtime-affecting config changes between runs. This also addresses `wez-into
> --start` which has the same gap. See the companion report
> (`cdocs/reports/2026-03-18-rebuild-config-cascading-gaps.md`) for the full
> investigation.

## Summary

The core issue is a semantic mismatch: users interpret `--rebuild` as "recreate
everything from scratch," but lace only applies it to the prebuild image layer.
The `devcontainer up` CLI never receives the flag, so it happily reuses a stale
container with old env vars, mount paths, and labels.

Phase 1 is a minimal, low-risk fix. Phase 2 introduces config fingerprinting to
detect drift automatically, eliminating the class of bug where users change config
and run `lace up` (without `--rebuild`) expecting the change to take effect.

## Objective

- Make `lace up --rebuild` actually rebuild the container, matching user expectations.
- Detect when runtime config has changed between `lace up` invocations and surface this to the user (or auto-rebuild).
- Ensure `wez-into --start` benefits from the same drift-awareness.

## Background

- Investigation report: `cdocs/reports/2026-03-18-rebuild-config-cascading-gaps.md`
- The `devcontainer` CLI's `--rebuild` flag removes the existing container and creates a new one from the current config. This is exactly what's needed when runtime config changes.
- Docker container environment variables, labels, and mounts are immutable after `docker create`. Any change to `containerEnv`, `workspaceMount`, `workspaceFolder`, `runArgs`, `mounts`, `forwardPorts`, or `remoteUser` requires container recreation.
- The prebuild system already handles image-level drift correctly (Dockerfile/feature changes trigger rebuilds). This proposal covers the runtime-config layer only.

## Proposed Solution

### Phase 1: Forward `--rebuild` to `devcontainer up`

When `rebuild` is true in `UpOptions`, include `--rebuild-container` in the args
passed to `runDevcontainerUp()`.

> NOTE(opus/devcontainer-lifecycle): We use `--remove-existing-container` rather
> than `--rebuild` because the `devcontainer` CLI's `--rebuild` flag triggers a
> full image rebuild which would duplicate the work already done by lace's prebuild
> phase. The `--remove-existing-container` flag removes the container but reuses
> the existing image, which is the correct behavior when the prebuild image is
> already fresh. Verified against `devcontainer up --help`.

The change is in `runDevcontainerUp()` at `lib/up.ts:875-895`:

```typescript
function runDevcontainerUp(
  options: RunDevcontainerUpOptions,
): SubprocessResult {
  const { workspaceFolder, subprocess, devcontainerArgs, useExtendedConfig } =
    options;

  const args = ["up"];

  if (useExtendedConfig) {
    const extendedPath = join(workspaceFolder, ".lace", "devcontainer.json");
    if (existsSync(extendedPath)) {
      args.push("--config", extendedPath);
    }
  }

  args.push("--workspace-folder", workspaceFolder);
  args.push(...devcontainerArgs);

  return subprocess("devcontainer", args);
}
```

Becomes:

```typescript
interface RunDevcontainerUpOptions {
  workspaceFolder: string;
  subprocess: RunSubprocess;
  devcontainerArgs: string[];
  useExtendedConfig: boolean;
  removeExistingContainer?: boolean;  // NEW
}

function runDevcontainerUp(
  options: RunDevcontainerUpOptions,
): SubprocessResult {
  const { workspaceFolder, subprocess, devcontainerArgs, useExtendedConfig,
          removeExistingContainer } = options;

  const args = ["up"];

  if (removeExistingContainer) {
    args.push("--remove-existing-container");
  }

  if (useExtendedConfig) {
    const extendedPath = join(workspaceFolder, ".lace", "devcontainer.json");
    if (existsSync(extendedPath)) {
      args.push("--config", extendedPath);
    }
  }

  args.push("--workspace-folder", workspaceFolder);
  args.push(...devcontainerArgs);

  return subprocess("devcontainer", args);
}
```

And the call site at `lib/up.ts:641`:

```typescript
const upResult = runDevcontainerUp({
  workspaceFolder,
  subprocess,
  devcontainerArgs,
  useExtendedConfig: true,
  removeExistingContainer: rebuild,  // NEW
});
```

### Phase 2: Config Drift Detection

After generating `.lace/devcontainer.json`, compare a fingerprint of the
runtime-affecting properties against the previous run's fingerprint. If they
differ:
- In interactive mode: warn the user and suggest `--rebuild`
- If `--rebuild` was passed: already handled by Phase 1
- Optionally (flag-gated): auto-pass `--remove-existing-container`

#### Fingerprint Design

Compute a SHA-256 hash of the JSON-serialized subset of properties that require
container recreation:

```typescript
const RUNTIME_KEYS = [
  "containerEnv",
  "mounts",
  "workspaceMount",
  "workspaceFolder",
  "runArgs",
  "forwardPorts",
  "appPort",
  "remoteUser",
  "postCreateCommand",
  // NOTE(opus/devcontainer-lifecycle): postStartCommand and postAttachCommand
  // are intentionally excluded. They run on every container start and do not
  // require container recreation to take effect.
] as const;

/** Deterministic JSON serialization with sorted keys at every depth. */
function sortedStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}

function computeRuntimeFingerprint(
  config: Record<string, unknown>,
): string {
  const subset: Record<string, unknown> = {};
  for (const key of RUNTIME_KEYS) {
    if (key in config) {
      subset[key] = config[key];
    }
  }
  return createHash("sha256")
    .update(sortedStringify(subset))
    .digest("hex")
    .slice(0, 16);
}
```

#### State File

Store the fingerprint in `.lace/runtime-fingerprint` (a plain text file
containing the hash). This is:
- Written after a successful `devcontainer up` (so it reflects the container's
  actual state)
- Read at the start of the next `lace up` for comparison
- Deleted when `--rebuild` is passed (forces clean state)

#### Drift Response

```
if (previousFingerprint !== currentFingerprint) {
  if (rebuild) {
    // Phase 1 already handles this: --remove-existing-container is passed
    log("Runtime config changed; container will be recreated (--rebuild).");
  } else {
    warn(
      "Runtime config has changed since the container was last created.\n" +
      "Run `lace up --rebuild` to apply the changes, or pass " +
      "`--remove-existing-container` directly."
    );
  }
}
```

The warning approach (rather than auto-rebuild) is preferred for the initial
implementation. Auto-rebuild is destructive (removes the container and all
non-persisted state) and should require explicit user intent.

### Phase 2 Addendum: `wez-into --start` Integration

`bin/wez-into`'s `start_and_connect()` currently calls `lace up` without
`--rebuild`. With drift detection in place, this flow becomes:

1. `wez-into --start` calls `lace up` as before
2. `lace up` detects drift and warns
3. The user sees the warning in the wezterm pane and can re-run with `--rebuild`

No changes to `wez-into` itself are needed for drift detection to surface. However,
we should consider adding a `--rebuild` passthrough to `wez-into --start` for
convenience:

```bash
# In start_and_connect():
local lace_args=("up" "--workspace-folder" "$workspace_path")
if [[ "$rebuild" == "true" ]]; then
  lace_args+=("--rebuild")
fi
"$lace_cli" "${lace_args[@]}"
```

This would let users run `wez-into --start --rebuild clauthier` as a single
command to pick up config changes after stopping a container.

> NOTE(opus/devcontainer-lifecycle): `--rebuild` should be added to `wez-into`'s
> option parsing near the `--start` flag and documented in its usage output.

## Important Design Decisions

1. **`--remove-existing-container` vs `--rebuild` for the devcontainer CLI.**
   The devcontainer CLI's `--rebuild` triggers both container removal AND image
   rebuild, which would duplicate lace's prebuild work. `--remove-existing-container`
   only removes the container and lets it be recreated from the existing image.
   This is more efficient and avoids redundant builds.

2. **Warning vs auto-rebuild on drift.** Auto-rebuild is tempting but removing a
   running container is destructive. Users may have unsaved state, running
   processes, or SSH sessions. Warnings let users choose when to rebuild. We can
   revisit auto-rebuild as an opt-in flag later.

3. **Fingerprint scope.** We fingerprint only the properties that require
   container recreation, not the full config. This avoids false positives from
   comment changes, ordering differences, or image-only changes that the prebuild
   system already handles.

4. **Fingerprint written after `devcontainer up`, not after config generation.**
   This ensures the fingerprint reflects actual container state. If `devcontainer up`
   fails, the old fingerprint is retained, and the next run will correctly detect
   drift.

## Edge Cases / Challenging Scenarios

- **First run (no existing container):** No fingerprint file exists.
  `--remove-existing-container` is a no-op when there's no container. No special
  handling needed.
- **User manually removes container:** The fingerprint file still exists but
  there's no container. `devcontainer up` creates a new one. The fingerprint may
  or may not match, but since there's no stale container, it doesn't matter.
  The fingerprint will be updated after the successful `up`.
- **Multiple worktrees of the same project:** Each worktree has its own `.lace/`
  directory and its own fingerprint. No collision.
- **Config changes that are semantically equivalent but serialize differently:**
  Handled by `sortedStringify()`, which recursively sorts keys at every depth
  before serialization.

## Test Plan

### Phase 1

- **Unit test:** `runDevcontainerUp` includes `--remove-existing-container` in
  args when `removeExistingContainer: true`.
- **Unit test:** `runDevcontainerUp` does NOT include the flag when
  `removeExistingContainer` is false or undefined.
- **Integration test:** `lace up --rebuild` with a changed `mountTarget` results
  in the container using the new path (verify via `docker inspect` of
  `CONTAINER_WORKSPACE_FOLDER`).

### Phase 2

- **Unit test:** `computeRuntimeFingerprint` produces different hashes for
  configs differing in any `RUNTIME_KEYS` property.
- **Unit test:** `computeRuntimeFingerprint` produces the same hash for configs
  differing only in non-runtime properties (e.g., `features`, `build`).
- **Unit test:** Drift detection warns when fingerprint changes and `rebuild` is
  false.
- **Unit test:** Drift detection does not warn when fingerprint is unchanged.
- **Unit test:** `computeRuntimeFingerprint` produces the same hash for two
  configs with identical keys inserted in different order (verifies deterministic
  serialization).
- **Integration test:** Change `containerEnv` → `lace up` → observe warning →
  `lace up --rebuild` → verify new env var is present in container.

## Verification Methodology

After implementing each phase:

1. Use the clauthier project as the test case: change `mountTarget` from
   `/workspace/lace` to `/workspaces/clauthier`, run `lace up --rebuild`,
   `wez-into clauthier`, and verify the shell starts in `/workspaces/clauthier/main`.
2. Verify via `docker inspect clauthier` that `CONTAINER_WORKSPACE_FOLDER` matches
   the new value.
3. For drift detection: change `containerEnv` without `--rebuild`, run `lace up`,
   verify the warning appears. Then `lace up --rebuild` and verify the env var
   is present.

## Implementation Phases

### Phase 1: Forward `--rebuild` to container lifecycle (minimal fix)

1. Add `removeExistingContainer?: boolean` to `RunDevcontainerUpOptions` interface
   in `lib/up.ts`.
2. When the flag is true, push `--remove-existing-container` into the `args`
   array in `runDevcontainerUp()`.
3. Pass `removeExistingContainer: rebuild` at the call site (`lib/up.ts:641`).
4. Update the `--rebuild` flag description in `commands/up.ts` from
   "Force rebuild of prebuild image (bypass cache)" to
   "Force full rebuild: rebuild prebuild image and recreate container".
5. Add unit tests for the new flag handling.
6. Manually verify with the clauthier project.

> NOTE(opus/devcontainer-lifecycle): Verified. `devcontainer up --help` confirms
> `--remove-existing-container` is a supported flag:
> `--remove-existing-container  Removes the dev container if it already exists.  [boolean] [default: false]`

### Phase 2: Config drift detection

1. Implement `computeRuntimeFingerprint()` in a new module
   (e.g., `lib/config-drift.ts`).
2. After `generateExtendedConfig()` completes, compute the fingerprint of the
   newly generated config.
3. Compare against `.lace/runtime-fingerprint` (if it exists).
4. If drift is detected and `rebuild` is false, emit a warning to stderr.
5. After a successful `devcontainer up`, write the current fingerprint to
   `.lace/runtime-fingerprint`.
6. When `rebuild` is true, delete the fingerprint file before comparison (or
   skip comparison entirely, since Phase 1 already handles recreation).
7. Add unit tests for fingerprinting and drift detection.
8. Add `--rebuild` passthrough support to `wez-into --start`.
