# Contributing to lace

This guide covers codebase idioms, testing patterns, and conventions for
contributors. For user-facing documentation, see
[`packages/lace/README.md`](packages/lace/README.md) and the docs in
[`packages/lace/docs/`](packages/lace/docs/).

> **NOTE:** Documented patterns should be verified against source code on
> each major version. If a pattern described here does not match what you
> see in the code, **the code is authoritative** -- please update this
> guide.

## Project structure

```
lace/
  packages/lace/         # Devcontainer orchestration CLI (TypeScript)
  devcontainers/features/ # Devcontainer features (OCI-published)
  cdocs/                 # Project documentation (proposals, devlogs)
```

### Build and test

```sh
pnpm install
pnpm --filter lace build
pnpm --filter lace test
```

## Codebase idioms

### 1. Custom error classes with `.name` property

Every module that can fail defines its own error class extending `Error`
with `this.name` set in the constructor. This enables catch-site
discrimination via `.name` rather than `instanceof`, which can be
unreliable across module boundaries.

```typescript
// From devcontainer.ts
export class DevcontainerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevcontainerConfigError";
  }
}
```

Error classes in the codebase:

| Class | Module | Purpose |
|-------|--------|---------|
| `DevcontainerConfigError` | `devcontainer.ts` | Config read/parse failures |
| `MetadataFetchError` | `feature-metadata.ts` | OCI registry fetch failures (includes `kind` discriminant) |
| `AnnotationMissingError` | `feature-metadata.ts` | Internal sentinel for blob fallback (not exported) |
| `RepoCloneError` | `repo-clones.ts` | Git clone/update failures |
| `DockerfileParseError` | `dockerfile.ts` | Dockerfile AST parse failures (includes optional line number) |
| `MountsError` | `mounts.ts` | Repo mount resolution failures |
| `SettingsConfigError` | `settings.ts` | Settings file read/parse failures |

### 2. Discriminated unions with `kind` discriminant

Functions that can succeed in multiple ways (or fail in multiple ways)
return tagged unions with a `kind` discriminant. Callers switch on `kind`
for exhaustive handling.

```typescript
// From devcontainer.ts
export type PrebuildFeaturesResult =
  | { kind: "features"; features: Record<string, Record<string, unknown>> }
  | { kind: "absent" }
  | { kind: "null" }
  | { kind: "empty" };
```

Other discriminated unions in the codebase:

| Type | Module | Variants |
|------|--------|----------|
| `PrebuildFeaturesResult` | `devcontainer.ts` | `features`, `absent`, `null`, `empty` |
| `ConfigBuildSource` | `devcontainer.ts` | `dockerfile`, `image` |
| `RepoMountsResult` | `devcontainer.ts` | `repoMounts`, `absent`, `null`, `empty` |
| `ValidationError` | `feature-metadata.ts` | `unknown_option`, `port_key_mismatch` |
| `MetadataFetchKind` | `feature-metadata.ts` | `fetch_failed`, `invalid_response`, `annotation_invalid`, `blob_fallback_failed` |

### 3. Command-level result objects

Top-level commands return structured result objects with `exitCode`,
`message`, and per-phase detail. This enables structured output, testing
without `process.exit()`, and phase-level error reporting.

```typescript
// From up.ts
export interface UpResult {
  exitCode: number;
  message: string;
  phases: {
    workspaceLayout?: { exitCode: number; message: string };
    hostValidation?: { exitCode: number; message: string };
    portAssignment?: { exitCode: number; message: string; port?: number };
    metadataValidation?: { exitCode: number; message: string };
    templateResolution?: { exitCode: number; message: string };
    prebuild?: { exitCode: number; message: string };
    resolveMounts?: { exitCode: number; message: string };
    generateConfig?: { exitCode: number; message: string };
    devcontainerUp?: { exitCode: number; stdout: string; stderr: string };
  };
}
```

Tests assert on `result.exitCode`, `result.message`, and individual
`result.phases.*` entries rather than parsing console output.

### 4. Subprocess injection for testability

External commands (devcontainer CLI, git, docker, OCI fetches) are invoked
through a `RunSubprocess` function type that can be injected via options
parameter. Production code uses the real `execFileSync` wrapper; tests
inject mocks.

```typescript
// From subprocess.ts
export type RunSubprocess = (
  command: string,
  args: string[],
  options?: { cwd?: string },
) => SubprocessResult;
```

Every class or function that shells out accepts an optional `subprocess`
parameter:

```typescript
// From up.ts
export interface UpOptions {
  subprocess?: RunSubprocess;
  // ...
}
```

This avoids global mocking and makes tests hermetic. A mock returns a
predetermined `SubprocessResult`:

```typescript
const mockSubprocess: RunSubprocess = (cmd, args) => ({
  exitCode: 0,
  stdout: '{ "manifest": { "annotations": { ... } } }',
  stderr: "",
});
```

### 5. JSONC parsing throughout

All config files are parsed with `jsonc-parser` (not `JSON.parse`). This
allows comments in `devcontainer.json` and `settings.json`. When modifying
JSONC files (like the prebuild image rewrite), lace uses `jsonc-parser`'s
edit operations to preserve comments and formatting.

Files that use `jsonc-parser`: `devcontainer.ts`, `settings.ts`, `up.ts`.

### 6. Template expression regex with full-match coercion

Template resolution uses regex patterns to find `${lace.port(...)}` and
`${lace.mount(...)}` expressions. When a template is the entire string
value (full match), it is coerced to the appropriate type. When embedded
in a larger string, it is substituted as a string.

```typescript
// From template-resolver.ts
const LACE_PORT_FULL_MATCH = /^\$\{lace\.port\(([^)]+)\)\}$/;
```

This enables `"port": "${lace.port(sshd/port)}"` to resolve as
`"port": 22430` (integer, not string "22430"). Embedded expressions like
`"${lace.port(sshd/port)}:2222"` resolve to `"22430:2222"` (string).

A guard pattern rejects any unrecognized `${lace.*}` expression:

```typescript
// From template-resolver.ts
const LACE_UNKNOWN_PATTERN = /\$\{lace\.(?!port\(|mount\()([^}]+)\}/;
```

### 7. Label validation pattern

Mount and port labels follow the `namespace/label` format validated by:

```typescript
// From mount-resolver.ts
const LABEL_PATTERN = /^[a-z0-9_-]+\/[a-z0-9_-]+$/;
```

The namespace must be `project` (for project-level mounts) or a feature
short ID (the last path segment of the feature reference, version
stripped). Labels that do not match the pattern fail with a descriptive
error that identifies the specific invalid characters.

## Testing patterns

### Scenario workspace helpers

Integration tests use `createScenarioWorkspace()` from
`src/__tests__/helpers/scenario-utils.ts` to create isolated temp
directories with `.devcontainer/`, `.lace/`, and metadata cache
subdirectories. Each workspace has a `cleanup()` method for teardown.

```typescript
// From scenario-utils.ts
export function createScenarioWorkspace(name: string): ScenarioWorkspace {
  // Creates temp dir with .devcontainer/ subdirectory
  // Returns: { workspaceRoot, devcontainerDir, laceDir, metadataCacheDir, cleanup }
}
```

Related helpers:
- `writeDevcontainerJson(ctx, config)` -- write a devcontainer.json
- `setupScenarioSettings(ctx, settings)` -- write settings.json and set `LACE_SETTINGS`
- `symlinkLocalFeature(ctx, featureName)` -- symlink a local feature for testing
- `readGeneratedConfig(ctx)` -- read `.lace/devcontainer.json`
- `readPortAssignments(ctx)` -- read `.lace/port-assignments.json`

### Docker-gated tests

Tests that require Docker use `isDockerAvailable()` with
`describe.skipIf()`:

```typescript
describe.skipIf(!isDockerAvailable())(
  "wezterm-server Docker integration",
  () => { /* ... */ }
);
```

This allows the full test suite to run on machines without Docker,
skipping integration tests gracefully.

### Port connectivity helpers

End-to-end tests that start real containers use TCP-level verification:

- `waitForPort(port, maxRetries, intervalMs)` -- waits for a TCP port to
  accept connections
- `getSshBanner(port, timeoutMs)` -- reads the SSH version string from a
  port

### Subprocess mocking

Tests create mock `RunSubprocess` functions that return predetermined
`SubprocessResult` objects. This avoids shelling out to real CLIs:

```typescript
const mockSubprocess: RunSubprocess = (command, args) => {
  if (command === "devcontainer" && args[0] === "features") {
    return { exitCode: 0, stdout: manifestJson, stderr: "" };
  }
  return { exitCode: 0, stdout: "", stderr: "" };
};
```

## Conventions

### `IMPLEMENTATION_VALIDATION` marker

Every source file starts with `// IMPLEMENTATION_VALIDATION`. This is a
tooling marker. All 42+ source and test files in `packages/lace/src/`
use it consistently.

### Interface ownership

Interfaces are exported from the module that owns the concept:

| Interface | Module |
|-----------|--------|
| `LaceMountDeclaration` | `feature-metadata.ts` |
| `PortAllocation` | `port-allocator.ts` |
| `RunSubprocess`, `SubprocessResult` | `subprocess.ts` |
| `UpResult`, `UpOptions` | `up.ts` |
| `LaceSettings` | `settings.ts` |

There is no shared `types.ts` file. Each module owns its types.

### Test file locations

Unit tests live alongside source files in `__tests__/` subdirectories:

```
src/lib/port-allocator.ts
src/lib/__tests__/port-allocator.test.ts
```

Integration tests for commands live in `src/commands/__tests__/`:

```
src/commands/__tests__/up.integration.test.ts
src/commands/__tests__/prebuild.integration.test.ts
```

End-to-end scenario tests live in `src/__tests__/`:

```
src/__tests__/wezterm-server-scenarios.test.ts
src/__tests__/workspace_smoke.test.ts
```

Test helpers live in `src/__tests__/helpers/`:

```
src/__tests__/helpers/scenario-utils.ts
```
