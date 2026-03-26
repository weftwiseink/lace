---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T18:30:00-07:00
task_list: lace/podman-migration
type: proposal
state: archived
status: implementation_accepted
tags: [architecture, podman, migration]
last_reviewed:
  status: accepted
  by: "@mjr"
  at: 2026-03-26T20:30:00-07:00
  round: 3
---

# Podman-First Container Runtime for lace Core TypeScript Package

> BLUF: Replace hardcoded `"docker"` subprocess calls in `packages/lace/src/` with a cached `getPodmanCommand()` that defaults to `"podman"` and is overridable via `~/.config/lace/settings.json`.
> No parameter threading: each call site calls `getPodmanCommand()` directly.
> The `devcontainer` CLI calls gain `--docker-path` pointing to the same command string.
> The mount policy blocklist gains podman-equivalent entries.
> Total scope: 5 call sites in 4 source files, 2 devcontainer CLI integration points, 1 mount policy update, 1 settings field.

> NOTE(opus/lace/podman-migration): This proposal covers only the TypeScript core package.
> The bin scripts (`lace-discover`, `lace-inspect`, `lace-into`, etc.) are covered by the companion proposal `cdocs/proposals/2026-03-26-podman-exec-container-entry.md`.
> That proposal's `resolve_runtime()` bash function should read the same config file (defaulting to `"podman"`) rather than using an env var, for cross-tool consistency.
> Both proposals share the `lace/podman-migration` task list and should be implemented together.

## Objective

Enable `packages/lace/` to work with podman as the container runtime without requiring `podman-docker`.
Default to `"podman"`.
Allow override via a user-level config setting for environments that need a different binary or path.

## Docker CLI Call Site Inventory

| # | File | Function | Command | Purpose |
|---|------|----------|---------|---------|
| 1 | `lib/up.ts:74` | `getContainerHostPorts()` | `docker ps -q --filter label=...` | Find running container by devcontainer label |
| 2 | `lib/up.ts:82` | `getContainerHostPorts()` | `docker port <id>` | Get host port bindings for owned-port detection |
| 3 | `lib/prebuild.ts:212` | `runPrebuild()` | `docker image inspect --format {{.Id}} <tag>` | Check if prebuild image exists locally |
| 4 | `commands/up.ts:13` | `isContainerRunning()` | `docker ps --filter label=... --format {{.ID}}` | Quick container-running check for LACE_RESULT metadata |
| 5 | `lib/workspace-detector.ts:506` | `verifyContainerGitVersion()` | `docker exec <name> git --version` | Run git inside container for extension verification |

### Devcontainer CLI call sites

| # | File | Function | Command | Notes |
|---|------|----------|---------|-------|
| 6 | `lib/up.ts:1212` | `runDevcontainerUp()` | `devcontainer up ...` | Needs `--docker-path` |
| 7 | `lib/prebuild.ts:327` | `runPrebuild()` | `devcontainer build ...` | Needs `--docker-path` |

A third devcontainer CLI call (`feature-metadata.ts:317`, `devcontainer features info manifest`) is a registry operation and does not interact with the container runtime.
It does not need `--docker-path`.

### Compatibility

All docker CLI subcommands used by lace (`ps`, `port`, `image inspect`, `exec`) produce identical output with podman.
The `--filter`, `--format`, and label filtering flags work the same way.
No `docker compose` usage exists: lace delegates compose handling to the devcontainer CLI.

## Proposed Solution

### 1. `getPodmanCommand()`: cached command resolution

Create `packages/lace/src/lib/container-runtime.ts`:

```typescript
import { loadSettings } from "./settings";

let cachedCommand: string | null = null;
let warnedNonPodman = false;

/**
 * Return the podman command string. Cached after first call.
 * Reads overridePodmanCommand from ~/.config/lace/settings.json.
 * Defaults to "podman".
 */
export function getPodmanCommand(): string {
  if (cachedCommand !== null) return cachedCommand;

  const settings = loadSettings();
  const override = settings.overridePodmanCommand;

  if (override) {
    if (!override.includes("podman") && !warnedNonPodman) {
      console.warn(
        `overridePodmanCommand is set to "${override}", which does not contain "podman". ` +
        `Non-podman runtimes may cause issues with sprack and other tooling.`
      );
      warnedNonPodman = true;
    }
    cachedCommand = override;
  } else {
    cachedCommand = "podman";
  }

  return cachedCommand;
}

/** Reset the cache. For testing only. */
export function resetPodmanCommandCache(): void {
  cachedCommand = null;
  warnedNonPodman = false;
}
```

Each call site replaces its hardcoded `"docker"` with `getPodmanCommand()`.
No parameter threading, no `runtime` argument on every function signature.

### 2. `overridePodmanCommand` in `settings.json`

Add an `overridePodmanCommand` field to the `LaceSettings` interface in `packages/lace/src/lib/settings.ts`:

```typescript
export interface LaceSettings {
  repoMounts?: { [repoId: string]: RepoMountSettings };
  mounts?: { [label: string]: MountOverrideSettings };
  overridePodmanCommand?: string;
}
```

This goes in `settings.json` (not `user.json`) because:
- `settings.json` holds global operational preferences (mount overrides, repo mount config).
- `user.json` holds identity and per-container injection (git identity, shell, mounts, features) that get merged into the devcontainer config.
- The podman command is an operational preference about how lace runs, not something injected into containers.
- `settings.json` is loaded by `loadSettings()` which is already a simple read-and-return; it does not merge with per-project config.

Example `~/.config/lace/settings.json`:

```jsonc
{
  "overridePodmanCommand": "/usr/bin/podman"
}
```

Or for docker users:

```jsonc
{
  // Warning: non-podman runtimes may cause issues with sprack
  "overridePodmanCommand": "docker"
}
```

### 3. Call site migration

Each hardcoded `"docker"` string becomes `getPodmanCommand()`:

```typescript
// Before:
const psResult = subprocess("docker", ["ps", "-q", ...]);

// After:
import { getPodmanCommand } from "./container-runtime";
const psResult = subprocess(getPodmanCommand(), ["ps", "-q", ...]);
```

This applies to all 5 call sites listed in the inventory.
The `RunSubprocess` interface is unchanged: the command string is its first argument.

### 4. Devcontainer CLI `--docker-path`

When calling `devcontainer up` and `devcontainer build`, inject `--docker-path` with the value from `getPodmanCommand()`:

```typescript
// In runDevcontainerUp():
args.push("--docker-path", getPodmanCommand());

// In runPrebuild():
buildArgs.push("--docker-path", getPodmanCommand());
```

The `--docker-path` flag is passed unconditionally.
It accepts both bare command names (`podman`) and absolute paths (`/usr/bin/podman`).
Passing it when `podman-docker` is installed is harmless.

> NOTE(opus/lace/podman-migration): Verified via `devcontainer up --help`: the `--docker-path` flag is a `[string]` type.
> Both `podman` (resolved via PATH) and `/usr/bin/podman` (absolute) work in both contexts: as a subprocess command AND as the `--docker-path` value.
> No mismatch between the two use cases.

### 5. Mount policy blocklist update

Add podman-equivalent entries to `DEFAULT_MOUNT_POLICY` in `packages/lace/src/lib/user-config.ts`:

```
# Podman storage
~/.local/share/containers

# Podman socket (expanded at evaluation time)
${XDG_RUNTIME_DIR}/podman/podman.sock
```

> NOTE(opus/lace/podman-migration): `$XDG_RUNTIME_DIR` must be expanded at evaluation time via `process.env.XDG_RUNTIME_DIR`.
> The existing blocklist uses literal paths, but the podman socket path varies per user.
> `~/.config/containers` is excluded from the blocklist: it contains configuration files (registries, storage config), not credentials, and users may legitimately want to mount it.

## Design Decisions

### Default to podman, no fallback to docker

The default is `"podman"`, not auto-detection with fallback.
If someone wants docker, they set `overridePodmanCommand`.
This eliminates the detection logic entirely and makes the behavior deterministic.
Sprack and other tooling depend on podman-specific features (rootless socket paths, `podman inspect` extensions); supporting docker as a first-class runtime would require ongoing compatibility work we choose not to take on.

### Config file over env var

The env var approach (`CONTAINER_RUNTIME`) is dropped in favor of `overridePodmanCommand` in `settings.json`.
A config file is more discoverable, persists across sessions, and does not require shell-specific setup.
The companion `podman-exec-container-entry` proposal's bash scripts should also read this config file for consistency.

### No parameter threading

Each call site calls `getPodmanCommand()` directly rather than receiving `runtime` as a parameter.
This avoids touching every function signature in the call chain.
The value is cached after the first call, so there is no repeated config file reads.

> WARN(opus/lace/podman-migration): The cached global makes unit testing slightly less ergonomic: tests must call `resetPodmanCommandCache()` between cases that exercise different override values.
> This is a minor cost; the existing `loadSettings()` has the same pattern of reading from the filesystem, and tests already manage env vars for `LACE_SETTINGS`.
> The alternative (threading `runtime` as a parameter through 5 call sites and 2 devcontainer CLI calls across 4 files) is disproportionate complexity.

### Warning for non-podman overrides

If `overridePodmanCommand` does not contain the substring `"podman"`, a one-time warning is printed.
This catches the docker case explicitly: you can use it, but you are on notice that sprack integration and other tooling may break.

## Edge Cases

### Absolute path override (`/usr/bin/podman`)

Works in both contexts: subprocess spawning resolves absolute paths directly, and `--docker-path` accepts absolute paths per the devcontainer CLI help output.

### Neither podman nor docker installed

The default `"podman"` is returned regardless.
The first subprocess call will fail with a clear OS-level error: `"podman: command not found"` or equivalent.
This is acceptable: lace is podman-first, and the error message is self-explanatory.

### `podman-docker` installed alongside native podman

Both `podman` and `docker` (symlink) resolve to podman.
`getPodmanCommand()` returns `"podman"` (the default), which is the native binary.
The `--docker-path podman` flag passed to devcontainer CLI is redundant but harmless.

### Test mocks reference `"docker"` as the command

Unit tests that mock `RunSubprocess` check `command === "docker"`.
After migration, these checks become `command === "podman"` (or `command === getPodmanCommand()` for flexibility).
Alternatively, tests can call `resetPodmanCommandCache()` and set `overridePodmanCommand` to a known value.

### Podman socket path in mount policy

The podman socket is at `$XDG_RUNTIME_DIR/podman/podman.sock`.
The blocklist evaluation must expand `$XDG_RUNTIME_DIR` at runtime.
If the env var is unset, skip the socket check (the path cannot be determined).

## Test Plan

### Unit tests: `getPodmanCommand()`

New test file `packages/lace/src/lib/__tests__/container-runtime.test.ts`:

1. Returns `"podman"` with no settings file.
2. Returns override value when `overridePodmanCommand` is set in settings.
3. Prints warning when override does not contain `"podman"`.
4. Caches the result (second call does not re-read settings).
5. `resetPodmanCommandCache()` clears the cache.

### Unit tests: call site updates

Update mock assertions in existing test files to expect `"podman"` instead of `"docker"` as the subprocess command.
Key files: `get-container-host-ports.test.ts`, `up.integration.test.ts`, `e2e.test.ts`.

### Unit tests: `--docker-path` injection

1. `runDevcontainerUp()` args include `--docker-path podman`.
2. `runPrebuild()` `devcontainer build` args include `--docker-path podman`.
3. Override value propagates: `--docker-path /usr/bin/podman` when override is set.

### Mount policy tests

New cases in `user-config.test.ts`:
1. Blocks `~/.local/share/containers`.
2. Blocks `$XDG_RUNTIME_DIR/podman/podman.sock` (with env var expansion).

### Integration test

Manual verification on a podman-only Fedora system (no `podman-docker`):

- [ ] `lace up` uses `podman ps`, `podman port`, `podman image inspect`, `podman exec`.
- [ ] `devcontainer up` receives `--docker-path podman`.
- [ ] `devcontainer build` receives `--docker-path podman`.
- [ ] Container starts and port allocation works.
- [ ] Mount policy blocks podman-specific paths.
- [ ] Setting `overridePodmanCommand` to `/usr/bin/podman` works end-to-end.

## Implementation Phases

### Phase 1: `getPodmanCommand()` and settings field

1. Add `overridePodmanCommand?: string` to `LaceSettings` interface in `settings.ts`.
2. Create `container-runtime.ts` with `getPodmanCommand()` and `resetPodmanCommandCache()`.
3. Create `__tests__/container-runtime.test.ts` with the 5 test cases.
4. No existing code changes yet.

**Success criteria:** New tests pass. Existing tests unaffected.

### Phase 2: Migrate all call sites and devcontainer CLI

1. Replace `"docker"` with `getPodmanCommand()` at all 5 call sites.
2. Add `--docker-path` to `runDevcontainerUp()` and `runPrebuild()`.
3. Update all affected test files to expect `"podman"` as the command.
4. Add `--docker-path` injection test cases.

**Success criteria:** All 445+ tests pass. No hardcoded `"docker"` subprocess calls remain in non-test source.

### Phase 3: Mount policy and cleanup

1. Add podman entries to `DEFAULT_MOUNT_POLICY` in `user-config.ts`.
2. Add mount policy test cases.
3. Update `scenario-utils.ts` and smoke tests to use `getPodmanCommand()` for real CLI calls.
4. Update JSDoc comments that reference "Docker" to say "container runtime" where appropriate.

**Success criteria:** Mount policy blocks podman paths. Full test suite passes.
