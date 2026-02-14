---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T23:59:00-08:00
task_list: lace/template-variables
type: report
state: live
status: done
tags: [mount-resolver, template-variables, settings, extensibility, executive-summary]
related_to:
  - cdocs/proposals/2026-02-14-mount-template-variables.md
  - cdocs/devlogs/2026-02-14-mount-template-variables-implementation.md
  - cdocs/reviews/2026-02-14-r3-review-of-mount-template-variables.md
---

# Executive Summary: Mount Template Variables Implementation

> **BLUF:** The mount template variable system is fully implemented across 6 commits on the `mountvars` branch. It adds `${lace.mount.source(namespace/label)}` and `${lace.mount.target(namespace/label)}` template variables to the lace devcontainer pipeline, eliminating hardcoded host paths from devcontainer configs. The implementation covers all 6 proposal phases, adds 45 new tests (555 total, up from 510), and migrates lace's own devcontainer to use the new templates. Two minor deviations from the proposal were made for pragmatic reasons; neither affects correctness.

## What Was Built

The implementation introduces a mount path resolution system that mirrors the existing `${lace.port()}` architecture. It solves the problem of user-specific, non-portable host paths in devcontainer mount declarations.

**Before:**
```jsonc
"source=${localEnv:HOME}/code/dev_records/weft/bash/history,target=/commandhistory,type=bind"
```

**After:**
```jsonc
"source=${lace.mount.source(project/bash-history)},target=/commandhistory,type=bind"
```

New contributors get auto-created default directories under `~/.config/lace/<projectId>/mounts/`. Existing users configure overrides in `~/.config/lace/settings.json` pointing to their existing directories.

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| MountPathResolver | `packages/lace/src/lib/mount-resolver.ts` | Two-tier resolution: settings override, then default path derivation with auto-creation |
| Settings extension | `packages/lace/src/lib/settings.ts` | `MountOverrideSettings` interface, `mounts` key on `LaceSettings` |
| Template patterns | `packages/lace/src/lib/template-resolver.ts` | `LACE_MOUNT_SOURCE_PATTERN`, `LACE_MOUNT_TARGET_PATTERN`, guard relaxation, `autoInjectMountTemplates()`, `buildMountTargetMap()` |
| Feature metadata | `packages/lace/src/lib/feature-metadata.ts` | `LaceMountDeclaration` interface, `customizations.lace.mounts` parsing |
| Pipeline wiring | `packages/lace/src/lib/up.ts` | Resolver creation, auto-injection, target map building, mount assignment reporting |
| Reference migration | `.devcontainer/devcontainer.json` | Mounts 0-1 converted to `${lace.mount.source()}` templates |

## How It Works

The mount resolution pipeline integrates into the existing `runUp()` workflow:

1. **Auto-inject mount templates** -- `autoInjectMountTemplates()` reads `customizations.lace.mounts` from feature metadata and injects string mount entries into the config's `mounts` array, analogous to `autoInjectPortTemplates()` for ports.
2. **Create resolver** -- `MountPathResolver` is instantiated with the workspace folder and user settings. It loads any persisted assignments from `.lace/mount-assignments.json`.
3. **Resolve templates** -- During `resolveTemplates()`, `${lace.mount.source(label)}` expressions are replaced with concrete host paths. `${lace.mount.target(label)}` expressions resolve to container paths declared in feature metadata.
4. **Persist** -- Assignments are saved to `.lace/mount-assignments.json` for debugging and inspection.

Resolution order for `mount.source`: check settings override first (`settings.mounts[label].source`), then derive a default path at `~/.config/lace/<projectId>/mounts/<namespace>/<label>`. Default directories are auto-created; override paths must exist (hard error if missing, consistent with repoMounts).

## Test Coverage

| Test File | New Tests | Coverage Area |
|-----------|-----------|---------------|
| `mount-resolver.test.ts` | 17 | Default path derivation, settings overrides, auto-creation, persistence, label validation |
| `template-resolver.test.ts` | ~25 | Source resolution, target resolution, auto-injection, guard relaxation, mixed port+mount |
| `settings.test.ts` | 4 | Mount override parsing, tilde expansion, empty/missing mounts |
| `up-mount.integration.test.ts` | 8 | End-to-end mount resolution, settings integration, error propagation |

**Totals:** 45 new tests, 555 total (up from 510 across 22 files to 555 across 23 files). All passing.

## Deviations from Proposal

Two deviations were made during implementation:

1. **Settings loading not hoisted.** The proposal's Phase 3 constraints recommended hoisting `loadSettings()` to `runUp()` level so it could be shared between `MountPathResolver` and `runResolveMounts()`. The implementation loads settings separately in `up.ts` instead of modifying the `runResolveMounts()` interface. Both calls read the same JSON file and are lightweight. This avoided a cross-cutting interface change for minimal benefit.

2. **Phase ordering.** Phase 6 (devcontainer migration) was executed in parallel with Phase 4 (feature mount declarations) since it only depended on Phase 3 output. This was more efficient without affecting correctness.

Neither deviation introduces technical debt or changes observable behavior.

## Commits

```
798cf13 feat(template-resolver): add ${lace.mount.target()} resolution (Phase 5)
2f42de5 feat(mounts): add feature mount declarations and auto-injection (Phase 4)
fb457a1 feat(devcontainer): migrate lace mounts to template variables (Phase 6)
1782af0 feat(up): wire MountPathResolver into runUp pipeline (Phase 3)
1f335cf feat(template-resolver): integrate mount source resolution (Phase 2)
2eec3b8 feat(mount-resolver): add MountPathResolver and settings mount overrides
```

All commits use conventional commit format. The branch is clean (no uncommitted changes).

## What Is Not Yet Done

The following items from the proposal's open questions remain future work:

- **File mounts.** The system targets directory mounts with auto-creation semantics. Single-file mounts (e.g., SSH authorized_keys) are out of scope. No motivating use case has emerged.
- **Cleanup semantics.** Stale mount directories under `~/.config/lace/<project>/mounts/` are never auto-deleted. A future `lace clean` command could list and optionally remove orphaned directories.
- **Multi-project mount sharing.** Two projects declaring `${lace.mount.source(project/bash-history)}` get isolated directories (different `<projectId>` segments). Cross-project sharing is achievable via settings overrides pointing both projects to the same directory, but no first-class mechanism exists.
- **RepoMounts convergence.** Mount template variables and repoMounts coexist as independent systems. RepoMounts have clone/update lifecycle and conflict detection that generic mounts do not. Convergence is theoretically possible but premature.

## Review History

The proposal went through 3 review rounds, all by automated review agents:

- **R1:** Identified 5 blocking issues (consent model contradiction, missing edge cases, incorrect line references). All resolved.
- **R2:** 8 non-blocking items (optional parameter, test coverage gaps, error semantics). All resolved.
- **R3:** Accepted. 3 non-blocking items (internal contradiction in one bullet point, phase numbering ambiguity, omitted error message update). None affected implementation.

---

*Report generated: 2026-02-14*
