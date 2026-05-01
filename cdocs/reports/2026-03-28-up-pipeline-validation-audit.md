---
first_authored:
  by: "@claude-opus-4-6-20250527"
  at: 2026-03-28T12:00:00-07:00
task_list: lace/validation-audit
type: report
state: live
status: wip
tags: [audit, error_handling, validation, up_pipeline]
---

# Validation Depth and Error Quality Audit: lace up Pipeline

> BLUF: The two critical gaps (warning-only bind-mount validation, stale persisted mount assignments) have been fixed in this session.
> Remaining gaps: devcontainer up errors are still raw subprocess output (GAP 3), settings load errors are silently downgraded (GAP 4), and the troubleshooting guide lacks entries for missing bind-mount sources and stale persisted state.
> Error messages are generally actionable in lace's own phases but degrade to raw container runtime output once `devcontainer up` is invoked.

## Context / Background

A user ran `lace up` from `/home/mjr/code/apps/whelm` and hit:
```
Error: statfs /home/mjr/.local/share/sprack/lace: no such file or directory
```

The actual cause was a stale persisted mount assignment in `.lace/mount-assignments.json` that referenced a directory that no longer existed.
Lace emitted a warning ("Bind mount source does not exist") but then passed the mount through to `devcontainer up`, which passed it to podman, which produced the opaque `statfs` error.

This audit maps every validation checkpoint in the `up` pipeline, identifies gaps, and assesses error message quality.

## Pipeline Phase Map

The `up` pipeline in `packages/lace/src/lib/up.ts` executes these phases in order:

| # | Phase | Source | Validates | Error Behavior |
|---|-------|--------|-----------|----------------|
| 0 | Config parse | `readDevcontainerConfigMinimal()` | JSON syntax, file existence | Hard error, actionable message |
| 0a | Workspace layout | `applyWorkspaceLayout()` | Layout type vs actual repo | Hard error (or warning with `--skip-validation`) |
| 0b | Host validation | `runHostValidation()` | File existence checks from config | Hard error (or warning with `--skip-validation`) |
| 0c | User config | `loadUserConfig()` | JSON syntax, file existence | Hard error |
| 0c.1 | Mount policy | `validateMountSources()` | Credential directory blocking | Hard error for blocked; warning for missing sources |
| 0c.2 | Feature references | `validateFeatureReferences()` | No local paths in user features | Hard error |
| 1 | Metadata fetch | `fetchAllFeatureMetadata()` | Network, OCI registry, cache | Hard error |
| 1.1 | Option validation | `validateFeatureOptions()` | User options exist in schema | Hard error |
| 1.2 | Port declaration validation | `validatePortDeclarations()` | Port keys match option names | Hard error |
| 2 | Port template warnings | `warnPrebuildPortTemplates()` | Port templates in prebuild features | Warning only |
| 3 | Port auto-injection | `autoInjectPortTemplates()` | N/A (injection, not validation) | N/A |
| 4 | Mount auto-injection | `autoInjectMountTemplates()` | N/A (injection, not validation) | N/A |
| 5 | Mount namespace validation | `validateMountNamespaces()` | Namespace matches known features | Hard error |
| 5.1 | Mount target conflict | `validateMountTargetConflicts()` | No duplicate container targets | Hard error |
| 6 | Static port warnings | `warnPrebuildPortFeaturesStaticPort()` | Prebuild features with static ports | Warning only |
| 7 | Settings load | `loadSettings()` | JSON syntax, file existence | Warning (downgrades to "overrides will not apply") |
| 7.5 | sourceMustBe validation | Mount resolver `resolveSource()` | Source exists and matches type | Hard error (or warning with `--skip-validation`) |
| 8 | Template resolution | `resolveTemplates()` | Template syntax, feature existence | Hard error |
| 8.1 | **Inferred mount validation** | Inline in up.ts lines 671-708 | Bind mount source existence | **Warning only** |
| 9 | Prebuild | `runPrebuild()` | Feature overlap, Dockerfile, build | Hard error |
| 10 | Resolve repo mounts | `runResolveMounts()` | Repo existence, mount paths | Hard error |
| 11 | Generate config | `generateExtendedConfig()` | Path resolution, JSON write | Hard error |
| 12 | Config drift | `checkConfigDrift()` | Runtime fingerprint comparison | Silent (informational) |
| 13 | devcontainer up | `runDevcontainerUp()` | Everything devcontainer CLI checks | Hard error, but raw subprocess output |
| 14 | Container verification | `verifyContainerGitVersion()` | Git version in container | Hard error (or warning with `--skip-validation`) |

## Key Findings

### GAP 1 (Critical): Inferred bind-mount source validation is warning-only [FIXED]

> NOTE(opus/lace-failure-debug): Fixed in this session.
> `up.ts` now returns a structured error result with `phases.mountValidation` instead of warning.

**Location:** `up.ts` lines 671-708

After template resolution, lace scans resolved mounts for missing bind-mount sources.
This is the exact validation that caught the `sprack/lace` directory issue.
But it only emits a `console.warn()` and continues to `devcontainer up`.

```typescript
if (!existsSync(source)) {
  console.warn(
    `Warning: Bind mount source does not exist: ${source} (target: ${target})\n` +
    `  → The container runtime will auto-create this as a root-owned directory...`,
  );
}
```

The warning message is good: it names the path, the target, and explains the consequence.
But the pipeline does not abort.
Podman then fails with `statfs <path>: no such file or directory`, which is opaque and loses all context.

NOTE(claude-opus-4-6/validation-audit): Podman's behavior differs from Docker here.
Docker auto-creates missing bind-mount source directories.
Podman `statfs` errors are a hard failure, which means the warning-only approach is doubly wrong on podman: the warning says "runtime will auto-create" but podman does not auto-create.

### GAP 2 (Critical): Stale persisted mount assignments are not validated [FIXED]

> NOTE(opus/lace-failure-debug): Fixed in this session.
> `resolveSource()` now checks `existsSync()` for persisted `sourceMustBe` assignments and re-resolves when the path is gone.

**Location:** `mount-resolver.ts` `MountPathResolver.load()` (lines 145-169)

The `load()` method reads `.lace/mount-assignments.json` and performs one staleness check: it compares the project ID segment in default paths.
But it does not validate that the `resolvedSource` path still exists on disk.

If a mount was previously resolved to `/home/mjr/.local/share/sprack/lace` (via a settings override or recommended source), and that directory is later deleted, the persisted assignment is loaded without validation.
On the next `lace up`, the stale path is used directly because `resolveSource()` returns the cached `existing.resolvedSource` on line 249 without checking existence.

The only thing that catches this is GAP 1 (the warning-only check), which does not abort.

### GAP 3 (Moderate): devcontainer up error output is raw and uninterpreted

**Location:** `up.ts` lines 958-963

```typescript
if (upResult.exitCode !== 0) {
  result.exitCode = upResult.exitCode;
  result.message = `devcontainer up failed: ${upResult.stderr}`;
  console.error(upResult.stderr);
  return result;
}
```

The entire `stderr` of the `devcontainer` CLI (which includes podman's stderr) is surfaced as-is.
There is no attempt to parse, classify, or provide remediation guidance for common podman/docker errors.

Common raw errors users might see:
- `Error: statfs /path: no such file or directory` (missing bind mount source)
- `Error: OCI runtime error: ...` (permission issues)
- `Error: creating container storage: ...` (disk space, podman storage)
- Network-related pull failures

Each of these has a known cause and remediation, but the user sees raw container runtime output.

### GAP 4 (Moderate): Settings load error is silently downgraded

**Location:** `up.ts` lines 558-567

```typescript
try {
  settings = loadSettings();
} catch (err) {
  if (err instanceof SettingsConfigError) {
    console.warn(`Warning: ${err.message}. Mount overrides will not apply.`);
  } else {
    throw err;
  }
}
```

If settings.json is malformed or `LACE_SETTINGS` points to a missing file, the pipeline continues without mount overrides.
This could silently cause mounts to resolve to default paths instead of user-configured paths, leading to confusing "empty data" symptoms.
The warning message is clear but the consequence is hard to trace.

### GAP 5 (Low): No validation of persisted port assignments

**Location:** `port-allocator.ts` (not read in full, but parallel to mount-resolver)

Port assignments are persisted in `.lace/port-assignments.json`.
The `ownedPorts` mechanism checks if the container already holds the port, but there is no validation that the port is actually available before passing it to `devcontainer up`.
If another process grabbed a previously-assigned port, `devcontainer up` fails with a raw podman bind error.

### GAP 6 (Low): Prebuild stale image removal silently swallowed

**Location:** `up.ts` lines 1217-1219

```typescript
subprocess(getPodmanCommand(), ["rm", "-f", "-a", "--filter", "ancestor=dev_container_feature_content_temp"]);
subprocess(getPodmanCommand(), ["rmi", "-f", "dev_container_feature_content_temp"]);
```

These cleanup commands run before `devcontainer up` but their exit codes are not checked.
If they fail (e.g., podman daemon not running), the failure is silent and `devcontainer up` may fail with a confusing stale-image error.

### GAP 7 (Low): Config drift detection failure is fully silent

**Location:** `up.ts` lines 907-938

The entire config drift block is wrapped in a bare `catch {}` that silently drops any error.
If the extended config file cannot be read (unlikely, since it was just written), drift detection is skipped with no warning.

## Error Message Quality Assessment

### Strong

- **DevcontainerConfigError**: "Cannot read devcontainer.json: `<path>`" - clear and actionable.
- **MetadataFetchError**: Includes the feature ID, reason, error kind, and bypass flag (`--skip-metadata-validation`). One of the best error messages in the codebase.
- **Mount override source missing**: "Mount override source does not exist for `<label>`: `<path>`. Create the directory or remove the override from settings.json." - actionable with two remediation options.
- **sourceMustBe validation**: Includes feature name, expected type, path, description, hint, and settings override instructions. The best error in the codebase.
- **Unknown template variable**: Lists supported templates. Actionable.
- **Mount namespace validation**: Lists valid namespaces. Actionable.
- **Host validation (fileExists)**: Shows original path, expanded path, and optional hint. Actionable.

### Adequate

- **Port exhaustion**: Shows all active assignments and the range. Actionable but doesn't suggest remediation (e.g., "stop unused containers" or "delete port-assignments.json").
- **Feature overlap**: "Feature overlap detected between prebuildFeatures and features: `<list>`" - names the features but doesn't explain what to do.
- **User mount policy blocked**: Explains the matching rule and how to override in mount-policy. Actionable.

### Weak

- **devcontainer up failure**: Raw stderr passthrough. No classification, no remediation. This is where users hit opaque podman errors like the `statfs` one.
- **Bind mount source warning**: The warning text itself is good, but since it doesn't abort the pipeline, the user actually sees the subsequent podman error instead.
- **Settings load failure (downgraded)**: "Warning: `<message>`. Mount overrides will not apply." - doesn't explain what will happen instead (default paths).
- **Container verification failure**: Shows git version check messages but no remediation for "how do I get a newer git in my container?"

## Troubleshooting Guide Coverage

`packages/lace/docs/troubleshooting.md` covers 12 scenarios.

| Scenario | Coverage | Notes |
|----------|----------|-------|
| Port exhaustion | Covered (#1) | Good remediation steps |
| Stale metadata cache | Covered (#2) | Clear |
| Prebuild image missing | Covered (#3) | Clear |
| Auto-created directory instead of file | Covered (#4) | Good, explains `sourceMustBe` |
| Template syntax errors | Covered (#5) | Clear |
| Default path instead of expected data | Covered (#6) | Explains settings override |
| Workspace layout mismatch | Covered (#7) | Clear |
| Metadata fetch failure | Covered (#8) | Thorough with 4 remediation steps |
| Mount namespace errors | Covered (#9) | Clear |
| Lock file contention | Covered (#10) | Clear |
| Claude Code sign-in | Covered (#11) | Detailed |
| Plugin path errors | Covered (#12) | Two approaches listed |
| **Missing bind-mount source** | **NOT covered** | The exact scenario that triggered this audit |
| **Stale mount-assignments.json** | **NOT covered** | Root cause of the triggering incident |
| **Stale port-assignments.json** | **NOT covered** | Parallel issue |
| **Podman-specific errors** | **NOT covered** | No podman vs docker error differentiation |
| **Raw devcontainer up failures** | **NOT covered** | No general troubleshooting for runtime failures |
| **Settings.json parse errors** | **NOT covered** | Downgraded to warning |

## Recommendations

### P0: Make bind-mount source validation a hard error [DONE]

Fixed: the inferred mount validation now returns a structured error result with `exitCode: 1` and `phases.mountValidation`.
Lists all missing sources with targets and provides remediation guidance (settings.json override, clearing stale cache).

### P0: Validate persisted mount assignments on load [DONE]

Fixed: `resolveSource()` now checks `existsSync()` for persisted `sourceMustBe` assignments.
When the source is gone, the stale entry is dropped and the mount is re-resolved with fresh variable substitution and auto-creation.

### P1: Add error classification for devcontainer up failures

Parse common patterns from the `devcontainer up` stderr and provide wrapped error messages:
- `statfs.*no such file or directory` -> "A bind mount source path does not exist. Check the mount paths above."
- `address already in use` -> "A port is already in use. Run `lace up --rebuild` or delete `.lace/port-assignments.json`."
- `OCI runtime error` -> "Container runtime error. Check podman logs."

### P1: Add missing troubleshooting entries

Add entries for:
- Missing bind-mount source (the triggering incident)
- Stale persisted state (mount-assignments.json, port-assignments.json)
- General `devcontainer up` runtime failures and how to debug

### P2: Tighten settings load failure handling

Consider making malformed `settings.json` a hard error rather than a warning.
A user who has configured mount overrides and gets a parse error should not silently fall back to default paths.

### P2: Validate persisted port assignments

On load, check if each assigned port is still available (or owned by this workspace's container).
Discard stale assignments proactively rather than letting podman fail on bind.
