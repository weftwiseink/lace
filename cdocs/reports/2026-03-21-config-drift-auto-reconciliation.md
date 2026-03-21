---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-21T08:56:20-07:00
task_list: lace/devcontainer-lifecycle
type: report
state: archived
status: done
tags: [analysis, devcontainer, config-drift, ux]
---

# Config Drift: Auto-Reconciliation Analysis

> BLUF: `lace up` detects config drift (e.g., changed repoMounts) but only warns.
> The user must pass `--rebuild`, which is a sledgehammer: it forces a full prebuild image rebuild with `--no-cache` in addition to container recreation.
> For runtime-only config changes like mounts, env vars, and workspace paths, a lighter auto-reconciliation path is needed.
> The passthrough `--remove-existing-container` works as a workaround but is undocumented and fires a spurious warning.

## Context / Background

The 2026-03-18 report ([rebuild-config-cascading-gaps](2026-03-18-rebuild-config-cascading-gaps.md)) identified that `lace up --rebuild` didn't cascade to `devcontainer up`.
Since then, two improvements were made:
- `--rebuild` now passes `--remove-existing-container` to `devcontainer up` (`up.ts:722`)
- Runtime fingerprinting detects config drift (`config-drift.ts`)

The remaining gap surfaced when adding `repoMounts` to a devcontainer.json: `lace up` warned about drift but took no action.
The user had to run `lace up --rebuild`, which unnecessarily rebuilt the prebuild image from scratch.

## Key Findings

### 1. `--rebuild` is overloaded

`--rebuild` does two unrelated things:
- Forces prebuild image rebuild with `--no-cache` (`prebuild.ts` via `force: rebuild`)
- Triggers container recreation via `--remove-existing-container`

For runtime config changes (mounts, env, workspace paths), only the second action is needed.
The prebuild rebuild adds minutes of unnecessary Docker build time.

### 2. Drift detection is warning-only

`config-drift.ts` correctly fingerprints `RUNTIME_KEYS` (containerEnv, mounts, workspaceMount, workspaceFolder, runArgs, remoteUser, postCreateCommand).
When drift is detected, `up.ts:691-696` prints:

```
Warning: Runtime config has changed since the container was last created.
Run `lace up --rebuild` to apply the changes, or pass
`--remove-existing-container` directly.
```

The warning accurately describes both options but doesn't act on either.

### 3. The passthrough workaround exists but is rough

`lace up --remove-existing-container` works: the flag isn't in the filtered list (`up.ts:80`), so it passes through to `devcontainer up`.
Issues:
- The drift warning still fires (fingerprint isn't cleared pre-check)
- The fingerprint IS correctly updated after success (`up.ts:736-738`), so subsequent runs are clean
- This flag is undocumented in lace's own `--help` and feels like implementation leakage
- Users have to know this devcontainer CLI detail

### 4. Properties tracked vs not tracked

Tracked (trigger drift warning): `containerEnv`, `mounts`, `workspaceMount`, `workspaceFolder`, `runArgs`, `remoteUser`, `postCreateCommand`.

Not tracked (intentionally): `features`, `prebuildFeatures` (prebuild cache handles these), `forwardPorts`, `appPort` (port allocator handles these), `postStartCommand`, `postAttachCommand` (run every start).

This split is well-reasoned.

## Analysis: What "Smart `lace up`" Looks Like

The user's vision: `lace up` should "just work" for config iteration.
This breaks into two behaviors:

### A. Auto-recreate on runtime drift

When drift is detected:
1. Log that runtime config changed and the container will be recreated
2. Pass `--remove-existing-container` to `devcontainer up`
3. Write the new fingerprint

This is safe because:
- The `.lace/devcontainer.json` is already regenerated with the correct state
- Container recreation is the documented way to apply runtime changes
- The user explicitly ran `lace up`, signaling intent to bring the environment current
- `postCreateCommand` re-runs on recreation, restoring setup state

Risk: a user with a long `postCreateCommand` might not want automatic recreation for a minor env var change.
Mitigation: a `--no-recreate` flag to suppress auto-recreation, or an interactive prompt.

### B. Auto-rebuild prebuild on build-context drift

The prebuild cache (`metadata.ts:contextsChanged`) already handles this: if the Dockerfile or prebuild devcontainer.json changed, lace rebuilds the image automatically without `--rebuild`.
`--rebuild` only adds `--no-cache` (ignoring Docker layer cache).

This is already the desired behavior.

### C. Separation of concerns

The ideal flag decomposition:

| Flag | Prebuild | Container | Use case |
|------|----------|-----------|----------|
| (none) | Cache-aware rebuild if contexts changed | Auto-recreate if drift detected | Normal iteration |
| `--rebuild` | Force rebuild with `--no-cache` | Force recreate | Nuclear option, cache corruption |
| `--no-recreate` | Normal | Skip recreation even if drift detected | Intentional reuse |

With auto-reconciliation, `--rebuild` becomes the rare "I suspect cache corruption" escape hatch rather than the routine config iteration path.

## Recommendations

### 1. Auto-recreate on drift (primary recommendation)

Change drift handling in `up.ts:691-696` from warning to action:
- When `drift.drifted && !rebuild`, set `removeExistingContainer = true` and log the action
- Keep `--rebuild` for force-rebuilding the prebuild image
- Optionally add `--no-recreate` for users who want the old warning-only behavior

Estimated scope: ~10 lines changed in `up.ts`.

### 2. Add `--recreate` as explicit lightweight flag

If auto-recreation feels too aggressive as a default, introduce `--recreate`:
- Only triggers container recreation (no prebuild rebuild)
- Clears and rewrites the runtime fingerprint
- Becomes the documented answer to the drift warning

This is the conservative alternative to recommendation 1.

### 3. Update the drift warning message

If keeping warning-only behavior, improve the message:
- Distinguish "run `--rebuild` to force full rebuild" from "run `--recreate` to apply runtime changes"
- Or: suggest `--remove-existing-container` explicitly as the lightweight path (current behavior, just needs documentation)
