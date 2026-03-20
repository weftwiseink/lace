---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T12:00:00-06:00
task_list: lace/up-pipeline
type: proposal
state: archived
status: implementation_accepted
tags: [lace-up, validation-architecture, container-verification, git-extensions, docker-no-cache]
related_to:
  - cdocs/proposals/2026-03-10-git-relativeworktrees-version-mismatch.md
  - cdocs/proposals/2026-02-15-workspace-validation-and-layout.md
supersedes:
  - cdocs/proposals/2026-03-11-rebuild-prebuild-before-validation.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-11T21:00:00-06:00
  round: 2
---

# Post-Container Git Extension Verification

> BLUF: The git extension validation is broken: it unconditionally flags
> all extensions without checking the container's actual git version. The
> fix is to replace the pre-build guesswork with a post-`devcontainer up`
> check: `docker exec <container> git --version`, then compare against
> known minimum versions per extension. This covers all configs (prebuild
> and non-prebuild) uniformly, is simpler than a post-prebuild check
> (no `prebuildTag` plumbing, no temporary containers, no ENTRYPOINT
> concerns), and favors correctness over fail-fast. Additionally,
> `--rebuild` should pass `--no-cache` to `devcontainer build` so Docker
> layer caching doesn't defeat feature version upgrades.

## Objective

Replace the broken git extension validation with a post-container
verification that checks the running container's actual git version.
This eliminates false-positive failures, the chicken-and-egg deadlock
with `--rebuild`, and the need for `--skip-validation` as a workaround.
All config types (prebuild and non-prebuild) are covered uniformly.

## Background

### The Broken Validation

The current git extension check in `checkGitExtensions()`
(`workspace-detector.ts:422-458`) flags **every** extension
unconditionally. The `GIT_EXTENSION_MIN_VERSIONS` map (which knows that
`relativeWorktrees` requires git 2.48+) is used only for the error
message text, never for actual comparison. There is no code that queries
or compares against the container's git version.

This means:
- A repo with `relativeWorktrees` always fails validation, even if the
  container has git 2.53.
- After `lace up --rebuild` fixes the container's git, the next normal
  `lace up` still fails (validation can't see the fix).
- The only workarounds are `--skip-validation` (suppresses ALL
  validation) or `--rebuild` every time.

### Prior Revisions

This proposal supersedes two prior approaches:

1. **Pipeline reorder** (revision 1-2): Conditionally run prebuild
   before validation when `--rebuild` is set. Added complexity (error
   codes, conditional downgrade, `prebuildCompleted` flag) to work
   around the broken check. Left a false-positive on subsequent runs.

2. **Post-prebuild verification** (revision 3): Run `docker run --rm
   <tag> git --version` after prebuild. Better, but only covered
   prebuild configs, required `prebuildTag` plumbing, and had ENTRYPOINT
   concerns.

The current approach (post-`devcontainer up` via `docker exec`) is the
simplest: the container is already running, `docker exec` avoids
ENTRYPOINT issues, and all configs are covered uniformly.

### Docker Build Cache Problem (Still Relevant)

When `force: true` bypasses the lace-level prebuild cache, Docker's own
build cache can still serve stale layers. The `devcontainer build`
command is invoked without `--no-cache`, so floating tags like
`"version": "latest"` on features resolve to cached (old) versions.

The fix: pass `--no-cache` to `devcontainer build` when `options.force`
is true. This is independent of the validation rework.

### Two Categories of Validation

This rework formalizes a distinction that was implicit:

1. **Pre-build static checks**: answerable from host filesystem and
   config alone. Run before any Docker operations. Examples: workspace
   classification, absolute gitdir paths, host file existence.

2. **Post-container verification**: require a running container. Run
   after `devcontainer up` to verify the container meets requirements.
   Example: git version supports detected extensions.

## Proposed Solution

### Pipeline After This Change

```
Read config
-> Phase 0a: Workspace layout (static: classification, mutations,
   absolute-gitdir) -- extension ERROR removed, warnings remain
-> Phase 0b: Host validation (static: file existence)
-> Metadata + Templates + Mount validation
-> Prebuild (devcontainer build)
-> Resolve mounts -> Generate config -> Devcontainer up
-> NEW: Post-container verification (docker exec checks)
```

The extension check moves from a pre-build guess in Phase 0a to an
informed verification on the running container. No pipeline reorder.
No `--rebuild` special handling. All configs covered uniformly.

### Implementation Detail

#### 1. Remove Extension Error from `applyWorkspaceLayout`

In `workspace-layout.ts`, remove the error block at lines 201-218 (the
`unsupported-extension` check that causes the hard error). The extension
warnings from `checkGitExtensions` are still collected via the general
warning loop (lines 99-103) and appear in `layoutResult.warnings` as
informational messages. They are no longer fatal.

Hard classification checks (normal-clone, not-git, standard-bare,
malformed) and the absolute-gitdir check remain unchanged.

```typescript
// REMOVE this block from applyWorkspaceLayout (lines 201-218):
// const extensionWarnings = result.warnings.filter(
//   (w) => w.code === "unsupported-extension",
// );
// if (extensionWarnings.length > 0) { ... return error ... }
```

#### 2. Add `verifyContainerGitVersion` Function

New function in `workspace-detector.ts` (co-located with
`checkGitExtensions` and `GIT_EXTENSION_MIN_VERSIONS`):

```typescript
export interface ContainerGitVerificationResult {
  passed: boolean;
  /** Git version string (e.g., "2.53.0"), or null on failure. */
  gitVersion: string | null;
  /** Per-extension check results. */
  checks: Array<{
    extension: string;
    requiredVersion: string | null;
    supported: boolean;
    message: string;
  }>;
}

/**
 * Verify that a running container's git version supports all detected
 * repository extensions.
 *
 * Runs `docker exec <containerName> git --version` to get the actual
 * version, then compares against GIT_EXTENSION_MIN_VERSIONS.
 *
 * Extensions not in the minimum-versions map produce warnings but do
 * not fail the check.
 */
export function verifyContainerGitVersion(
  containerName: string,
  detectedExtensions: Record<string, string>,
  subprocess: RunSubprocess,
): ContainerGitVerificationResult {
  const versionResult = subprocess("docker", [
    "exec", containerName, "git", "--version",
  ]);

  if (versionResult.exitCode !== 0) {
    return {
      passed: false,
      gitVersion: null,
      checks: [{
        extension: "(git binary)",
        requiredVersion: null,
        supported: false,
        message:
          "Could not determine git version in container. " +
          "git may not be installed. Add the git prebuild feature: " +
          '"ghcr.io/devcontainers/features/git:1": { "version": "latest" }',
      }],
    };
  }

  // Parse "git version 2.53.0" or "git version 2.48.0 (Apple Git-140)"
  const versionMatch = versionResult.stdout
    .trim()
    .match(/git version (\d+\.\d+\.\d+)/);
  if (!versionMatch) {
    return {
      passed: false,
      gitVersion: null,
      checks: [{
        extension: "(git binary)",
        requiredVersion: null,
        supported: false,
        message:
          `Unexpected git version output: "${versionResult.stdout.trim()}"`,
      }],
    };
  }

  const gitVersion = versionMatch[1];
  const checks = [];
  let passed = true;

  for (const [extName, _value] of Object.entries(detectedExtensions)) {
    const requiredVersion = GIT_EXTENSION_MIN_VERSIONS[extName] ?? null;

    if (!requiredVersion) {
      checks.push({
        extension: extName,
        requiredVersion: null,
        supported: true,
        message:
          `Extension "${extName}" has no known minimum git version. ` +
          `Container has git ${gitVersion}.`,
      });
      continue;
    }

    const supported = compareVersions(gitVersion, requiredVersion) >= 0;
    if (!supported) passed = false;

    checks.push({
      extension: extName,
      requiredVersion,
      supported,
      message: supported
        ? `Extension "${extName}" requires git ${requiredVersion}+, ` +
          `container has ${gitVersion}. OK.`
        : `Extension "${extName}" requires git ${requiredVersion}+, ` +
          `but container has ${gitVersion}. ` +
          'Set version to "latest" in the git prebuild feature.',
    });
  }

  return { passed, gitVersion, checks };
}

/**
 * Compare two semver-like version strings (major.minor.patch).
 * Returns negative if a < b, zero if equal, positive if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
```

**Note:** The `docker exec` call is synchronous with no timeout, which
is consistent with all other subprocess calls in the codebase (e.g.,
`docker image inspect` in `prebuild.ts:201`). Since `devcontainer up`
just succeeded, the container is running and responsive. A timeout
would be a nice-to-have but is not necessary for correctness.

#### 3. Add `getDetectedExtensions` Helper

Export a helper from `workspace-detector.ts` that returns the extension
map from a classification result. Also export the existing private
`findBareGitDir` function (currently at line 321-335).

The helper must resolve the actual bare git directory (where the config
file lives), not use `classification.bareRepoRoot` (which is the
workspace root, not the git directory). The resolution depends on the
classification type:

- **worktree**: The `.git` file points to
  `.bare/worktrees/<name>`. `findBareGitDir` walks up to find the
  `.bare` directory (the bare git dir containing `HEAD` and `config`).
- **bare-root**: The `.git` file points directly to `.bare`. The
  resolved pointer path IS the bare git dir.

```typescript
/**
 * Extract detected git extensions from a classification result.
 * Returns null if no extensions are present or the classification
 * type does not have a bare git directory.
 *
 * The workspacePath is needed to resolve the .git file pointer to
 * the actual bare git directory where the config file lives.
 * (classification.bareRepoRoot is the workspace root, not the git
 * directory.)
 */
export function getDetectedExtensions(
  result: ClassificationResult,
  workspacePath: string,
): Record<string, string> | null {
  const { classification } = result;
  if (
    classification.type !== "worktree" &&
    classification.type !== "bare-root"
  ) {
    return null;
  }

  // Resolve the actual bare git directory (where config lives)
  const dotGitPath = join(workspacePath, ".git");
  let bareGitDir: string | null = null;
  try {
    const pointer = resolveGitdirPointer(dotGitPath);
    if (classification.type === "worktree") {
      // pointer.resolvedPath is .bare/worktrees/<name>;
      // findBareGitDir walks up to .bare
      bareGitDir = findBareGitDir(pointer.resolvedPath);
    } else {
      // bare-root: pointer.resolvedPath IS the bare git dir (.bare)
      bareGitDir = pointer.resolvedPath;
    }
  } catch {
    return null;
  }

  if (!bareGitDir) return null;

  const configPath = join(bareGitDir, "config");
  if (!existsSync(configPath)) return null;

  let configContent: string;
  try {
    configContent = readFileSync(configPath, "utf-8");
  } catch {
    return null;
  }

  const { formatVersion, extensions } =
    parseGitConfigExtensions(configContent);
  if (formatVersion < 1) return null;
  if (Object.keys(extensions).length === 0) return null;

  return extensions;
}
```

This keeps the coupling between detection and consumption explicit and
avoids re-parsing git config in `up.ts`. `findBareGitDir` must be
exported from `workspace-detector.ts` (it is currently private at line
321-335).

#### 4. Integrate Post-Container Verification into `runUp()`

In `up.ts`, after `devcontainer up` succeeds and before the final
return, add the verification.

**Container name resolution:** The actual Docker container name is
`sanitizeContainerName(projectName)` (up.ts:766), unless the user has
a custom `--name` in their `runArgs`. The integration code must mirror
the same logic used in `generateExtendedConfig`:

1. Read the extended config's `runArgs`.
2. If `hasRunArgsFlag(runArgs, "--name")` is true, extract the
   user-provided name (the value after `--name`).
3. Otherwise, use `sanitizeContainerName(projectName)`.

This ensures `docker exec` targets the correct container regardless of
how the name was determined.

```typescript
// Phase: Post-container verification
// Runs after devcontainer up on the running container.
// Covers all configs (prebuild and non-prebuild) uniformly.
if (!skipDevcontainerUp) {
  const classResult = classifyWorkspace(workspaceFolder);
  const extensions = getDetectedExtensions(classResult, workspaceFolder);

  if (extensions) {
    // Resolve the actual container name, mirroring generateExtendedConfig
    const containerName = resolveContainerName(projectName, configExtended);

    const verification = verifyContainerGitVersion(
      containerName,
      extensions,
      subprocess,
    );

    const verificationMsg = verification.passed
      ? `Container git ${verification.gitVersion} supports all ` +
        `detected extensions`
      : verification.checks
          .filter((c) => !c.supported)
          .map((c) => c.message)
          .join("\n");

    if (!verification.passed && !skipValidation) {
      result.phases.containerVerification = {
        exitCode: 1,
        message: verificationMsg,
      };
      result.exitCode = 1;
      result.message =
        `Container verification failed: ${verificationMsg}`;
      return result;
    }

    if (!verification.passed && skipValidation) {
      result.phases.containerVerification = {
        exitCode: 0,
        message: `${verificationMsg} (downgraded)`,
      };
      console.warn(
        `Warning: ${verificationMsg} ` +
          "(continuing due to --skip-validation)",
      );
    }

    if (verification.passed) {
      result.phases.containerVerification = {
        exitCode: 0,
        message: verificationMsg,
      };
      console.log(verificationMsg);
    }
  }
}
```

Add `containerVerification` to the `UpResult` phases interface:

```typescript
phases: {
  // ... existing phases
  containerVerification?: { exitCode: number; message: string };
};
```

#### 5. Add `resolveContainerName` Helper

Add a helper in `project-name.ts` (co-located with
`sanitizeContainerName` and `hasRunArgsFlag`):

```typescript
/**
 * Resolve the actual Docker container name that lace will use.
 * Mirrors the logic in generateExtendedConfig (up.ts:764-769):
 * if the user has --name in runArgs, use their value;
 * otherwise, use sanitizeContainerName(projectName).
 */
export function resolveContainerName(
  projectName: string,
  extendedConfig: Record<string, unknown>,
): string {
  const runArgs = (extendedConfig.runArgs ?? []) as string[];
  for (let i = 0; i < runArgs.length; i++) {
    // Handle --name value (space-separated)
    if (runArgs[i] === "--name" && i + 1 < runArgs.length) {
      return runArgs[i + 1];
    }
    // Handle --name=value (equals-separated)
    if (runArgs[i].startsWith("--name=")) {
      return runArgs[i].slice("--name=".length);
    }
  }
  return sanitizeContainerName(projectName);
}
```

This avoids duplicating the name-resolution logic and handles custom
`--name` in `runArgs` correctly.

#### 6. Pass `--no-cache` to `devcontainer build` When `force` Is True

In `runPrebuild()` (`prebuild.ts:287-298`):

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

if (options.force) {
  buildArgs.push("--no-cache");
}

const buildResult = run("devcontainer", buildArgs, { cwd: workspaceRoot });
```

## Important Design Decisions

### Decision: Post-Container, Not Post-Prebuild

**Decision:** Run verification after `devcontainer up` via `docker exec`,
not after prebuild via `docker run --rm`.

**Why:**
- **Simpler**: No `prebuildTag` plumbing on `PrebuildResult`. No
  temporary containers. No ENTRYPOINT concerns (`docker exec` runs
  inside an already-initialized container).
- **Uniform**: Covers all configs. Non-prebuild configs (where git comes
  from the Dockerfile) get the same verification as prebuild configs.
- **Correct**: Tests the actual running container, not just a prebuild
  intermediate image. If the Dockerfile adds a different git after
  prebuild, the check catches it.
- **Trade-off**: The full pipeline runs before verification. If git is
  inadequate, the container is running but useless for git operations.
  The user was explicit: correctness and simplicity over fail-fast.

### Decision: `docker exec`, Not `docker run --rm`

**Decision:** Use `docker exec <container> git --version` on the running
container.

**Why:**
- No ENTRYPOINT interference (exec runs in the container's existing
  process namespace).
- No temporary container creation (image layers are already loaded).
- The container is guaranteed to be running (we just succeeded at
  `devcontainer up`).
- The `--entrypoint` question from the prior revision is moot.

### Decision: Extension Detection Stays in `workspace-detector.ts`

**Decision:** Keep `checkGitExtensions` and `GIT_EXTENSION_MIN_VERSIONS`
in `workspace-detector.ts`. Add `verifyContainerGitVersion`,
`compareVersions`, and `getDetectedExtensions` to the same module.

**Why:** Detection and verification are two sides of the same concern.
Co-locating keeps `GIT_EXTENSION_MIN_VERSIONS` as the single source of
truth. A separate `container-verification.ts` would be premature for a
single check.

### Decision: Verification Respects `--skip-validation`

**Decision:** The post-container verification is gated by
`--skip-validation`, matching the pre-build check convention.

**Why:** Consistent behavior. The downgrade convention matches workspace
layout: exitCode 0 with "(downgraded)" message suffix.

### Decision: Unknown Extensions Warn, Don't Fail

**Decision:** Extensions not in `GIT_EXTENSION_MIN_VERSIONS` produce a
warning but do not fail the check.

**Why:** Avoids false positives for new git extensions. The map can be
updated in future releases.

### Decision: Skipped When `skipDevcontainerUp` Is True

**Decision:** When `skipDevcontainerUp` is true (testing), the
verification phase is skipped entirely.

**Why:** No running container to exec into. Integration tests that need
to test verification must mock the `docker exec` subprocess call, not
skip devcontainer up.

## Stories

### S1: User with Extensions and Adequate Git

Bare-repo with `extensions.relativeWorktrees = true`. Container has
git 2.53 (via prebuild git feature with `"latest"`).

**Current behavior:** Phase 0a fails.

**Expected behavior:** Phase 0a passes (informational warning).
Pipeline runs normally. After `devcontainer up`, verification runs
`docker exec <container> git --version`, gets "2.53.0", compares
against "2.48.0", passes.

### S2: User with Extensions and Old Git

Same as S1 but container has git 2.39.

**Expected behavior:** Phase 0a passes. Pipeline runs. Verification
fails: 'Extension "relativeworktrees" requires git 2.48+, but container
has 2.39.x.'

### S3: Subsequent `lace up` After Fixing

After S1 succeeds, subsequent `lace up` runs. Container is recreated.
Verification runs on the new container and passes.

### S4: `lace up --rebuild` to Upgrade Git

User changes git feature to `"latest"`, runs `lace up --rebuild`.
Prebuild rebuilds with `--no-cache`. New container has adequate git.
Verification passes.

### S5: Normal `lace up` Without Extensions

No extensions in repo. Verification phase skipped (no extensions).
Pipeline identical to current behavior.

### S6: Non-Prebuild Config with Extensions

Git comes from Dockerfile, not prebuild features. Phase 0a emits
informational extension warnings. Pipeline runs. Verification checks
the running container's git version.

**This is a key improvement over the post-prebuild approach**: non-
prebuild configs are now covered.

## Edge Cases / Challenging Scenarios

### E1: `docker exec` Fails

`docker exec <container> git --version` returns non-zero exit.

**Handling:** Treated as "git not installed." Fails with guidance to
add the git prebuild feature. `--skip-validation` can bypass.

### E2: Unexpected `git --version` Output

Output doesn't match the `git version X.Y.Z` regex.

**Handling:** Treated as verification failure with raw output in the
error message.

### E3: Extensions and Absolute Gitdir Paths

Workspace has both. Phase 0a catches absolute-gitdir (hard error).
Pipeline stops before `devcontainer up`. Verification never runs.

### E4: `--no-cache` Build Takes Longer

Expected. User requested `--rebuild`. Only applies when `force` is true.

### E5: Verification Fails but Container Is Running

The container started successfully but has inadequate git. The
verification reports failure with `exitCode: 1`.

**Handling:** The container remains running. The user can exec into it
for debugging or non-git work. They fix the config and re-run `lace up`.
This is the same state as any other runtime misconfiguration.

### E6: `skipDevcontainerUp` (Testing)

No running container. Verification is skipped entirely. Integration
tests that need to exercise verification must mock `docker exec`, not
skip devcontainer up.

### E7: Container Name Mismatch

The raw `projectName` from `deriveProjectName()` is not the Docker
container name. Two transformations can change it:

1. `sanitizeContainerName(projectName)` replaces non-alphanumeric
   characters (up.ts:766).
2. The user may have a custom `--name` in `runArgs`, which
   `generateExtendedConfig` respects via `hasRunArgsFlag()` (up.ts:767).

**Handling:** The `resolveContainerName()` helper (Detail 5) mirrors
the same logic used in `generateExtendedConfig` to determine the
actual container name. If the user has `--name` in `runArgs`, their
value is used. Otherwise, `sanitizeContainerName(projectName)` is
used. This ensures `docker exec` always targets the correct container.

## Test Plan

### Unit Tests in `workspace-detector.test.ts`

**T1: `compareVersions` basic cases**

```
"2.53.0" >= "2.48.0" -> true
"2.48.0" >= "2.48.0" -> true
"2.39.5" >= "2.48.0" -> false
"3.0.0"  >= "2.48.0" -> true
"2.48"   >= "2.48.0" -> true (missing patch treated as 0)
```

**T1b: `verifyContainerGitVersion` parses version with suffixes**

Mock subprocess returns `git version 2.48.0 (Apple Git-140)`.
Extensions: `{ relativeworktrees: "true" }`.

Verify:
- `result.passed === true`
- `result.gitVersion === "2.48.0"` (suffix stripped by regex)

**T2: `verifyContainerGitVersion` with adequate git**

Mock subprocess returns `git version 2.53.0`.
Extensions: `{ relativeworktrees: "true" }`.

Verify:
- `result.passed === true`
- `result.gitVersion === "2.53.0"`
- Single check with `supported === true`

**T3: `verifyContainerGitVersion` with inadequate git**

Mock subprocess returns `git version 2.39.5`.
Extensions: `{ relativeworktrees: "true" }`.

Verify:
- `result.passed === false`
- `result.gitVersion === "2.39.5"`
- Single check with `supported === false`
- Check message includes remediation

**T4: `verifyContainerGitVersion` with git not installed**

Mock subprocess returns exit code 1.

Verify:
- `result.passed === false`
- `result.gitVersion === null`
- Check message includes "git may not be installed"

**T5: `verifyContainerGitVersion` with unknown extension**

Mock subprocess returns `git version 2.53.0`.
Extensions: `{ relativeworktrees: "true", somefutureext: "true" }`.

Verify:
- `result.passed === true` (unknown extensions don't fail)
- Two checks: one supported, one with "no known minimum"

**T6: `verifyContainerGitVersion` with multiple extensions, mixed**

Mock subprocess returns `git version 2.30.0`.
Extensions: `{ relativeworktrees: "true", worktreeconfig: "true" }`.

Verify:
- `result.passed === false`
- relativeWorktrees fails (needs 2.48+), worktreeconfig passes (needs
  2.20+)

**T7: `getDetectedExtensions` returns extensions for bare-worktree**

Create a bare repo with `repositoryformatversion = 1` and
`[extensions]` section.

Verify: returns the extension map.

**T7b: `getDetectedExtensions` returns null for normal clone**

Verify: returns null (classification type is normal-clone).

### Unit Tests in `workspace-layout.test.ts`

**T8: `applyWorkspaceLayout` no longer errors on extensions**

Create a workspace with `extensions.relativeWorktrees = true` and
`workspace.layout: "bare-worktree"`.

Verify:
- `result.status === "applied"` (was `"error"`)
- Extension info appears as warning in `result.warnings`
- Config mutations (workspaceMount, workspaceFolder) are applied

### Integration Tests in `up.integration.test.ts`

**T9: Pipeline with extensions runs post-container verification**

Create a workspace with extensions. Mock subprocess:
- `devcontainer up`: exit 0
- `docker exec <name> git --version`: "git version 2.53.0"

Verify:
- `result.exitCode === 0`
- `result.phases.containerVerification.exitCode === 0`
- Message contains "2.53.0"

**T10: Pipeline fails verification when git too old**

Mock `docker exec` returns "git version 2.39.5".

Verify:
- `result.exitCode === 1`
- `result.phases.containerVerification.exitCode === 1`
- Message contains remediation

**T11: `--skip-validation` bypasses verification failure**

Same as T10 with `skipValidation: true`.

Verify:
- `result.exitCode === 0` (pipeline continues)
- `result.phases.containerVerification.exitCode === 0` (downgraded)
- Message contains "(downgraded)"

**T12: Pipeline without extensions skips verification**

Normal workspace without extensions.

Verify:
- `result.phases.containerVerification` is undefined
- No `docker exec` call in subprocess mock log

**T13: Non-prebuild config with extensions runs verification**

Workspace with extensions but no prebuild features. Mock `docker exec`
returns "git version 2.53.0".

Verify:
- `result.phases.containerVerification.exitCode === 0`
- Verification ran despite no prebuild

**T13b: Custom `--name` in `runArgs` targets correct container**

Config with `"runArgs": ["--name", "my-custom"]` and extensions.
Mock `docker exec my-custom git --version` returns "git version 2.53.0".

Verify:
- `docker exec` subprocess call targets `my-custom`, not `projectName`
- `result.phases.containerVerification.exitCode === 0`

### Unit Tests in `project-name.test.ts`

**T13c: `resolveContainerName` with custom `--name`**

Verify:
- `resolveContainerName("foo", { runArgs: ["--name", "bar"] })` returns
  `"bar"`
- `resolveContainerName("foo", { runArgs: ["--name=bar"] })` returns
  `"bar"` (equals-separated form)
- `resolveContainerName("foo.bar", { runArgs: [] })` returns
  `sanitizeContainerName("foo.bar")`

### Unit Tests in `prebuild.integration.test.ts`

**T14: `runPrebuild` with `force: true` passes `--no-cache`**

Verify: `devcontainer build` args include `--no-cache`.

**T15: `runPrebuild` without `force` omits `--no-cache`**

Verify: `devcontainer build` args do NOT include `--no-cache`.

## Implementation Phases

### Phase 1: Core Verification Function + Remove Extension Error

**Changes:**
- `packages/lace/src/lib/workspace-detector.ts`:
  - Add `compareVersions()` function.
  - Add `ContainerGitVerificationResult` interface.
  - Add `verifyContainerGitVersion()` function (uses `docker exec`).
  - Add `getDetectedExtensions(result, workspacePath)` helper.
  - Export `findBareGitDir` (currently private at line 321-335).
  - Add import for `RunSubprocess` type.
- `packages/lace/src/lib/workspace-layout.ts`:
  - Remove the `unsupported-extension` error block (lines 201-218).
- `packages/lace/src/lib/prebuild.ts`:
  - Add `--no-cache` to `devcontainer build` args when `options.force`
    is true.

**Constraints:**
- Do NOT change hard classification checks or absolute-gitdir check.
- Do NOT change `checkGitExtensions` (detection unchanged).
- Do NOT change host-validator.ts.

**Success criteria:**
- `applyWorkspaceLayout` returns `status: "applied"` for workspaces
  with extensions (was `"error"`).
- `verifyContainerGitVersion` correctly passes/fails based on actual
  version comparison using `docker exec`.
- `--no-cache` passed when `force` is true.

### Phase 2: Integrate Post-Container Verification into Pipeline

**Changes:**
- `packages/lace/src/lib/up.ts`:
  - Add `containerVerification` to `UpResult.phases` interface.
  - After `devcontainer up` succeeds, add the verification block using
    `getDetectedExtensions()` and `verifyContainerGitVersion()`.
  - Resolve the container name via `resolveContainerName()` (Detail 5).
  - Gate on `!skipDevcontainerUp` and non-null extensions.
- `packages/lace/src/lib/project-name.ts`:
  - Add `resolveContainerName()` helper.
  - Respect `--skip-validation` (downgrade convention: exitCode 0 with
    "(downgraded)" suffix).

**Constraints:**
- No pipeline reorder. Verification runs at the end.
- No new CLI flags.
- Verification fires for ALL configs with extensions (prebuild and
  non-prebuild).

**Success criteria:**
- `lace up` with adequate git: passes verification.
- `lace up` with inadequate git: fails with actionable message.
- `lace up` without extensions: verification skipped.
- `lace up --skip-validation` with inadequate git: downgraded.
- Non-prebuild configs with extensions: verification runs.

### Phase 3: Tests

**Changes:**
- Add tests T1-T15 as described in the Test Plan.
- Update existing `workspace-layout.test.ts` tests that assert
  `status: "error"` for extensions to assert `status: "applied"`.
- Review `workspace_smoke.test.ts` extension-stripping workaround --
  no longer necessary for the extension check.

**Constraints:**
- Use existing test infrastructure.
- Self-contained (no Docker dependency).

**Success criteria:**
- All new and existing tests pass.
- Coverage confirms verification triggers for all configs with
  extensions, skips without.
