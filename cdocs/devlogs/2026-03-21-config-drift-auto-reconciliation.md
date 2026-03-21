---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-21T08:56:20-07:00
task_list: lace/devcontainer-lifecycle
type: devlog
state: archived
status: done
tags: [config-drift, devcontainer, ux]
---

# Config Drift Auto-Reconciliation: Devlog

## Objective

Change `lace up` to auto-recreate the container when runtime config drift is detected, instead of only warning.
The prior behavior forced users to run `--rebuild` (which unnecessarily rebuilds the prebuild image) for config changes that only require container recreation.

## Plan

1. Introduce a `recreateContainer` variable in the drift detection phase of `up.ts`
2. Set it `true` when drift is detected (regardless of `--rebuild`)
3. Pass it to `runDevcontainerUp` as `removeExistingContainer`
4. Change the drift log message from a warning to an informational message
5. Update existing tests that expect the old warning behavior
6. Add new tests for auto-reconciliation

## Testing Approach

Unit tests via the existing integration test suite in `up.integration.test.ts`.
Key scenarios:
- Drift detected without `--rebuild`: container is recreated (was: warning only)
- Drift detected with `--rebuild`: container is recreated (unchanged)
- No drift, no rebuild: container reused (unchanged)
- First run (no prior fingerprint): no recreation (unchanged)

## Implementation Notes

The change is minimal: introduce a `recreateContainer` boolean alongside the existing `rebuild` flag.
When drift is detected, `recreateContainer` is set to `true`, and `removeExistingContainer` on the `devcontainer up` call becomes `rebuild || recreateContainer`.
The `console.warn` is replaced with `console.log` since the system now acts on the drift rather than leaving it to the user.

The `--rebuild` flag retains its dual role (force prebuild rebuild + container recreation) for the cache-corruption escape hatch.
The difference: routine config iteration no longer requires `--rebuild`.

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/up.ts` | Drift detection phase: warn -> auto-recreate. New `recreateContainer` variable drives `removeExistingContainer`. |
| `packages/lace/src/commands/__tests__/up.integration.test.ts` | Replaced "warns on drift" test with "auto-recreates container when drift is detected without --rebuild". Verifies `--remove-existing-container` is passed and fingerprint is updated. |

## Verification

**Tests:**
```
 Test Files  34 passed (34)
      Tests  928 passed (928)
   Duration  31.70s
```

All 928 tests pass, including the updated drift test that verifies auto-recreation behavior.
