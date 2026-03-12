---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T12:00:00-06:00
task_list: lace/up-pipeline
type: proposal
state: archived
status: superseded
tags: [lace-up, validation-architecture, prebuild, container-verification, git-extensions, docker-no-cache]
related_to:
  - cdocs/proposals/2026-03-10-git-relativeworktrees-version-mismatch.md
  - cdocs/proposals/2026-02-15-workspace-validation-and-layout.md
supersedes_revision: 2
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-03-11T17:45:00-07:00
  round: 3
---

# Post-Build Container Verification for Git Extension Compatibility

> BLUF: The current git extension validation is fundamentally broken -- it
> detects that the host repo uses extensions, then unconditionally assumes
> the container can't handle them, producing false positives that block
> the pipeline. The fix is to replace the guesswork with an actual check:
> after prebuild produces a Docker image, run `docker run --rm <tag> git
> --version` to get the real git version, then compare against known
> minimum versions per extension. This introduces a general "post-build
> container verification" phase to the pipeline for checks that need
> container information, complementing the existing pre-build static
> checks. Additionally, `--rebuild` should pass `--no-cache` to
> `devcontainer build` so Docker layer caching doesn't defeat feature
> version upgrades.

## Objective

Replace the broken git extension validation (which always fails when
extensions are present) with a post-build verification that checks the
actual container image's git version. This eliminates the false-positive
failures, the chicken-and-egg deadlock with `--rebuild`, and the need for
`--skip-validation` as a permanent workaround.

## Background

### The Broken Validation

The current git extension check in `checkGitExtensions()`
(`workspace-detector.ts:422-458`) works as follows:

```typescript
for (const [extName, _value] of Object.entries(extensions)) {
    warnings.push({
      code: "unsupported-extension",
      message:
        `Repository uses git extension "${extName}"${versionHint} ` +
        "but the container's git may not support it.",
    });
}
```

It flags **every** extension unconditionally. The
`GIT_EXTENSION_MIN_VERSIONS` map (which knows that `relativeWorktrees`
requires git 2.48+) is only used for the error message text, never for
actual comparison. There is no code that queries or compares against the
container's git version. The check is a "you have extensions, assume the
worst" alarm.

This means:
- A repo with `relativeWorktrees` always fails validation, even if the
  container has git 2.53.
- After `lace up --rebuild` fixes the container's git, the next normal
  `lace up` still fails (validation doesn't know the image was fixed).
- The only workarounds are `--skip-validation` (which suppresses ALL
  validation) or `--rebuild` every time.

### The Chicken-and-Egg (Now Moot)

The prior revision of this proposal focused on a pipeline reorder to work
around the false positive: run prebuild before validation when
`--rebuild` is set. This added conditional phase reordering, an
`errorCode` field for error discrimination, and targeted downgrade logic.
All of that complexity exists to work around a validation check that
doesn't actually validate anything.

The right fix is to make the check actually check: query the container
image's git version after prebuild and compare it against the minimum
required by each detected extension.

### Docker Build Cache Problem (Still Relevant)

Even when `force: true` bypasses the lace-level prebuild cache (the
`contextsChanged` check), Docker's own build cache can cause the
`devcontainer build` subprocess to reuse stale layers. This is because
the `devcontainer build` command is currently invoked without
`--no-cache`. When a feature like `ghcr.io/devcontainers/features/git:1`
is configured with `"version": "latest"`, Docker sees the same
Dockerfile instructions and feature install layer, considers them
unchanged, and reuses the cached layer -- which still contains the old
git version.

The fix is to pass `--no-cache` to `devcontainer build` when
`options.force` is true. This is independent of the validation rework
and was correctly identified in the prior revision.

### Current Validation Architecture

The `lace up` pipeline has two pre-build validation phases:

| Phase | Checks | Nature |
|-------|--------|--------|
| **Phase 0a** (workspace layout) | Classification, config mutation, absolute gitdir paths, git extensions | Filesystem-only |
| **Phase 0b** (host validation) | File existence (`customizations.lace.validate.fileExists`) | Filesystem-only |

All checks are static -- they read host files and config, never query
containers. This is appropriate for most checks (classification,
absolute paths, file existence). But the git extension check is trying to
answer a question about the container ("does the container's git support
this extension?") using only host-side information. It cannot succeed.

### Two Categories of Validation

This rework formalizes a distinction that was implicit:

1. **Pre-build static checks**: questions answerable from host filesystem
   and config alone. These run before any Docker operations and fail
   fast. Examples: workspace classification, absolute gitdir paths, host
   file existence, mount namespace conflicts.

2. **Post-build container verification**: questions that require an
   actual container image. These run after prebuild produces a Docker
   image and verify that the image meets the repository's requirements.
   Example: git version supports detected extensions.

## Proposed Solution

### Approach: Move Extension Check to Post-Build Verification

Remove the git extension ERROR from `applyWorkspaceLayout` in Phase 0a.
Add a new post-build container verification phase after prebuild. The
new phase uses `docker run` to query the actual image and make a real
determination.

### Pipeline After This Change

```
Read config
-> Phase 0a: Workspace layout (static: classification, mutations,
   absolute-gitdir) -- extension check REMOVED from here
-> Phase 0b: Host validation (static: file existence)
-> Metadata + Templates + Mount validation
-> Prebuild (devcontainer build)
-> NEW: Post-build container verification (docker run checks)
-> Resolve mounts -> Generate config -> Devcontainer up
```

The extension check moves from a blind guess in Phase 0a to an informed
verification after prebuild. No pipeline reorder is needed. `--rebuild`
does not require special handling. Subsequent `lace up` runs check the
actual cached prebuild image and pass if the git version is adequate.

### Implementation Detail

#### 1. Remove Extension Error from `applyWorkspaceLayout`

In `workspace-layout.ts`, remove the error block at lines 201-218 (the
`unsupported-extension` check that causes the hard error). The extension
warnings from `checkGitExtensions` are still collected via the general
warning loop (lines 99-103) and appear in `layoutResult.warnings` as
informational messages. They are no longer fatal.

The hard classification checks (normal-clone, not-git, standard-bare,
malformed) and the absolute-gitdir check remain unchanged -- they are
genuinely pre-build static checks that don't need container info.

```typescript
// REMOVE this block from applyWorkspaceLayout (lines 201-218):
// const extensionWarnings = result.warnings.filter(
//   (w) => w.code === "unsupported-extension",
// );
// if (extensionWarnings.length > 0) { ... return error ... }
```

After this change, `applyWorkspaceLayout` returns `status: "applied"`
even when extensions are present. The extension info remains available
via the `classifyWorkspace` cache for the post-build phase to use.

#### 2. Add `verifyContainerGitVersion` Function

New function in `workspace-detector.ts` (co-located with
`checkGitExtensions` and `GIT_EXTENSION_MIN_VERSIONS` since it uses
both):

```typescript
export interface ContainerGitVerificationResult {
  /** Whether all detected extensions are supported by the image's git. */
  passed: boolean;
  /** Git version string from the container (e.g., "2.53.0"), or null if
   *  git is not installed or version could not be determined. */
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
 * Verify that a Docker image's git version supports all detected
 * repository extensions.
 *
 * Runs `docker run --rm <imageTag> git --version` to get the actual
 * version, then compares against GIT_EXTENSION_MIN_VERSIONS.
 *
 * Extensions not in the minimum-versions map are flagged as warnings
 * (unknown minimum) but do not fail the check.
 */
export function verifyContainerGitVersion(
  imageTag: string,
  detectedExtensions: Record<string, string>,
  subprocess: RunSubprocess,
): ContainerGitVerificationResult {
  // Query the image's git version
  const versionResult = subprocess("docker", [
    "run", "--rm", imageTag, "git", "--version",
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
          "Could not determine git version in prebuild image. " +
          "git may not be installed. Add the git prebuild feature: " +
          '"ghcr.io/devcontainers/features/git:1": { "version": "latest" }',
      }],
    };
  }

  // Parse "git version 2.53.0" -> "2.53.0"
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
      // Unknown extension -- warn but don't fail
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

#### 3. Add `getDetectedExtensions` Helper

Export a helper from `workspace-detector.ts` that returns the extension
map from a classification result, keeping the coupling between detection
and consumption explicit:

```typescript
/**
 * Extract detected git extensions from a classification result.
 * Returns null if no extensions are present or the classification
 * type does not have a bare git directory.
 *
 * Internally re-reads the bare repo's git config (OS page-cached
 * from the classification pass) to avoid threading the extension map
 * through the warning system.
 */
export function getDetectedExtensions(
  result: ClassificationResult,
): Record<string, string> | null {
  const { classification } = result;
  if (
    classification.type !== "worktree" &&
    classification.type !== "bare-root"
  ) {
    return null;
  }

  const bareGitDir = classification.bareRepoRoot;
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

This eliminates: (a) the fragile coupling to warning codes in `up.ts`,
(b) the `getBareGitDir` helper that would duplicate the private
`findBareGitDir`, and (c) direct git config re-parsing in `up.ts`.

#### 4. Integrate Post-Build Verification into `runUp()`

In `up.ts`, after the prebuild phase (line ~579) and before resolve
mounts (line ~581), add the post-build verification:

```typescript
// Phase: Post-build container verification
// Only runs when: (a) repo has git extensions AND (b) prebuild produced
// an image tag. Uses getDetectedExtensions (which reads the cached
// classification) to get the extension map, then queries the actual image.
if (hasPrebuildFeatures && prebuildResult?.prebuildTag) {
  const classResult = classifyWorkspace(workspaceFolder);
  const extensions = getDetectedExtensions(classResult);

  if (extensions) {
    const verification = verifyContainerGitVersion(
      prebuildResult.prebuildTag,
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
      // Follow the workspace layout convention: exitCode 0 with
      // "(downgraded)" suffix when --skip-validation bypasses failure.
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

The `containerVerification` phase needs to be added to the `UpResult`
phases interface:

```typescript
export interface UpResult {
  exitCode: number;
  message: string;
  phases: {
    workspaceLayout?: { exitCode: number; message: string };
    hostValidation?: { exitCode: number; message: string };
    containerVerification?: { exitCode: number; message: string };
    // ... existing phases
  };
}
```

#### 5. Pass `--no-cache` to `devcontainer build` When `force` Is True

Unchanged from the prior revision. In `runPrebuild()`
(`prebuild.ts:287-298`):

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

#### 6. Expose Prebuild Tag for Verification

The post-build verification needs the prebuild image tag. Currently,
`runPrebuild` computes the tag internally and returns it only in the
message string. The `PrebuildResult` interface needs a `prebuildTag`
field:

```typescript
export interface PrebuildResult {
  exitCode: number;
  message: string;
  /** The Docker image tag built (or reactivated from cache). */
  prebuildTag?: string;
}
```

The specific return paths in `runPrebuild` that must set `prebuildTag`:
- Fresh build success (line ~341): `prebuildTag` set to the built tag
- Cache reactivation (line ~241): `prebuildTag` set to the reactivated
  tag
- Up-to-date cache hit (lines ~214, ~225): `prebuildTag` set to the
  existing tag

Paths that should NOT set `prebuildTag`:
- Dry-run (returns planned actions, no image produced)
- Build failure (image not usable)
- No prebuild features / empty features (early returns)

## Important Design Decisions

### Decision: Post-Build Verification, Not Pipeline Reorder

**Decision:** Replace the broken pre-build extension check with a
post-build verification phase that queries the actual image, rather than
reordering the pipeline to work around the broken check.

**Why:** The prior approach (pipeline reorder + targeted downgrade) added
complexity to work around a validation that doesn't actually validate. It
also left a false-positive problem on subsequent runs (E3 in the prior
revision). By making the check query real data, the pipeline stays
simple, `--rebuild` needs no special handling, and subsequent runs
correctly pass when the image is adequate.

### Decision: `docker run --rm` for Version Check

**Decision:** Use `docker run --rm <tag> git --version` to query the
prebuild image's git version.

**Why:**
- It tests the actual image that will be used.
- `docker run --rm` creates a temporary container, runs one command, and
  destroys it. Latency is ~1-3 seconds (image layers are already local
  from prebuild). This only runs when the host repo has extensions.
- Alternative: `docker inspect` to read image metadata. But this doesn't
  tell us the git version -- features install binaries at build time, not
  as metadata.
- Alternative: Parse devcontainer feature version from config. But this
  only tells us what was requested, not what was installed (e.g.,
  `"latest"` resolves to a specific version at build time).

### Decision: Extension Detection Stays in `workspace-detector.ts`

**Decision:** Keep `checkGitExtensions` and `GIT_EXTENSION_MIN_VERSIONS`
in `workspace-detector.ts`. Add `verifyContainerGitVersion` and
`compareVersions` to the same module.

**Why:** The detection (parsing git config for extensions) and the
verification (checking if a version supports them) are two sides of the
same concern. Co-locating them keeps the `GIT_EXTENSION_MIN_VERSIONS`
map as the single source of truth for both detection messages and version
comparison. If more post-build checks are added in the future, a
dedicated `container-verification.ts` module could be extracted, but
premature extraction for a single check adds unnecessary indirection.

### Decision: Verification Phase Respects `--skip-validation`

**Decision:** The post-build container verification phase is gated by
`--skip-validation`, same as other validation checks.

**Why:** Consistent behavior. If the user says "skip validation," all
validation is skipped -- both pre-build and post-build. This avoids a
confusing UX where some checks respect the flag and others don't.

### Decision: Non-Prebuild Configs Skip Verification

**Decision:** If the config has no `prebuildFeatures`, the post-build
verification phase is skipped entirely. Extension warnings remain as
informational messages in the workspace layout phase output.

**Why:** Without prebuild features, there is no prebuild image to query.
The git version comes from whatever the Dockerfile installs, and the
full image isn't available until `devcontainer up` completes. Running
`docker run` on the base image wouldn't give the right answer (features
modify the image). For non-prebuild configs, the user controls git
installation directly; the informational warning is sufficient.

### Decision: Unknown Extensions Warn, Don't Fail

**Decision:** Extensions not in `GIT_EXTENSION_MIN_VERSIONS` produce a
warning ("no known minimum version") but do not fail the check.

**Why:** If a new git extension is added to a repo but our map doesn't
have the minimum version, failing would be a false positive. The warning
surfaces the unknown extension for the user to evaluate. The map can be
updated in future releases.

## Stories

### S1: User with Extensions and Adequate Git Feature

The user's bare-repo has `extensions.relativeWorktrees = true`. Their
prebuild image includes `ghcr.io/devcontainers/features/git:1` with
`"version": "latest"` (installs git 2.53).

**Current behavior:** Phase 0a fails with "git may not support it."

**Expected behavior:** Phase 0a passes (extension check removed).
Prebuild runs. Post-build verification runs `docker run --rm <tag> git
--version`, gets "2.53.0", compares against "2.48.0" requirement, logs
"Container git 2.53.0 supports all detected extensions." Pipeline
continues.

### S2: User with Extensions and Old Git Feature

Same as S1 but the git feature has `"version": "2.39"`.

**Expected behavior:** Phase 0a passes. Prebuild runs. Post-build
verification gets "2.39.x", compares against "2.48.0", fails with
'Extension "relativeworktrees" requires git 2.48+, but container has
2.39.x. Set version to "latest" in the git prebuild feature.'

### S3: Subsequent `lace up` After Fixing

After S1 succeeds, the user runs `lace up` (no `--rebuild`). Prebuild
cache is fresh, prebuild is a no-op (returns cached tag). Post-build
verification still runs `docker run --rm <cached-tag> git --version`
and passes.

**This is the key improvement over the prior revision.** No
`--skip-validation` needed. No false positives.

### S4: User Runs `lace up --rebuild` to Upgrade Git

The user changes git feature from `"version": "2.39"` to `"latest"` and
runs `lace up --rebuild`. Prebuild rebuilds with `--no-cache`. Post-
build verification checks the new image and passes.

### S5: Normal `lace up` Without Extensions

A user without git extensions runs `lace up`. No extension warnings from
workspace classification. Post-build verification phase is skipped (no
extensions to check). Pipeline identical to current behavior.

### S6: User Without Prebuild Features

A user with git extensions but no `prebuildFeatures` runs `lace up`.
Phase 0a emits informational extension warnings. Post-build verification
is skipped (no prebuild image to check). Pipeline continues. If git
inside the container is too old, operations fail at runtime (same as any
other Dockerfile misconfiguration).

## Edge Cases / Challenging Scenarios

### E1: `docker run` Fails (Image Missing or Docker Error)

The `docker run --rm <tag> git --version` command fails (non-zero exit).

**Handling:** The verification treats this as "git not installed" and
fails with guidance to add the git prebuild feature. The error message
is actionable. `--skip-validation` can bypass if the user knows git is
available through another mechanism.

### E2: Prebuild Image Has git But No `git --version` Output

The `git --version` output doesn't match the expected format.

**Handling:** Treated as verification failure with the raw output
included in the error message for debugging. Unlikely in practice since
`git --version` is standardized, but handled gracefully.

### E3: Extensions and Absolute Gitdir Paths

The workspace has both git extensions and absolute gitdir paths.

**Handling:** Phase 0a catches the absolute-gitdir error (hard error,
unchanged). Pipeline stops before reaching prebuild or post-build
verification. The user fixes the gitdir paths first, then on the next
run, the extension check occurs in the post-build phase.

### E4: `--no-cache` Build Takes Longer

When `force` is true, `--no-cache` rebuilds all Docker layers.

**Handling:** Expected and acceptable. The user explicitly requested
`--rebuild`. The `--no-cache` flag only applies when `force` is true;
normal runs benefit from Docker's build cache.

### E5: Post-Build Verification Latency

`docker run --rm <tag> git --version` adds ~1-3 seconds to the pipeline.

**Handling:** This only runs when the host repo has git extensions AND
prebuild features are configured. For repos without extensions (the
common case), the check is skipped entirely. The latency is negligible
compared to the prebuild itself.

### E6: Prebuild Returns Cached Tag (No Actual Build)

When prebuild is a no-op (cache is fresh), it returns the cached
prebuild tag. The post-build verification still runs `docker run` on
that tag.

**Handling:** This is correct. The cached image still exists locally
(prebuild verified this at `prebuild.ts:201-202`). The `docker run` uses
the local image and completes in ~1 second. This ensures that even
cached images are verified against the current repo's extensions --
important if the user added new extensions since the last prebuild.

### E7: Concurrent Prebuild Image Deletion

Between prebuild and post-build verification, someone deletes the
Docker image.

**Handling:** `docker run` fails with a "no such image" error. The
verification reports this as a failure. The user can re-run `lace up`
(prebuild will detect the missing image and rebuild). This is a race
condition that is theoretically possible but practically irrelevant.

### E8: Non-Prebuild Config with Extensions

No prebuild features. Extensions detected. The post-build verification
phase is skipped because there's no image to query.

**Handling:** The extension warnings appear as informational messages in
the workspace layout output. The user is informed that extensions were
detected. If the Dockerfile's git doesn't support them, operations fail
at runtime. This is a conscious trade-off: without prebuild, we have no
image to query before `devcontainer up`. Adding a post-`devcontainer up`
check is possible but would require a running container and is out of
scope.

### E9: Image with Custom ENTRYPOINT

The prebuild image has a custom ENTRYPOINT that interferes with
`docker run --rm <tag> git --version` (e.g., an entrypoint script that
expects specific arguments or reads from stdin).

**Handling:** Prebuild images are built from well-known base images
(node, python, etc.) with standard entrypoints. The devcontainer feature
install process does not typically modify the entrypoint. If a custom
entrypoint does interfere, the `docker run` call fails (non-zero exit)
and falls into E1 handling. The user can use `--skip-validation` to
bypass. If this becomes a recurring problem, the `docker run` invocation
could use `--entrypoint git` to override.

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
- Two checks: one `supported === true`, one with "no known minimum"

**T6: `verifyContainerGitVersion` with multiple extensions, mixed**

Mock subprocess returns `git version 2.30.0`.
Extensions: `{ relativeworktrees: "true", worktreeconfig: "true" }`.
(relativeWorktrees needs 2.48+, worktreeconfig needs 2.20+)

Verify:
- `result.passed === false`
- Two checks: relativeWorktrees fails, worktreeconfig passes

### Unit Tests in `workspace-layout.test.ts`

**T7: `applyWorkspaceLayout` no longer errors on extensions**

Create a workspace with `extensions.relativeWorktrees = true` and
`workspace.layout: "bare-worktree"`.

Verify:
- `result.status === "applied"` (was `"error"`)
- Extension info appears as warning in `result.warnings`
- Config mutations (workspaceMount, workspaceFolder) are applied

### Integration Tests in `up.integration.test.ts`

**T8: Pipeline with extensions runs post-build verification**

Create a workspace with extensions and prebuild features. Mock
subprocess to return:
- `devcontainer build`: exit 0
- `docker run --rm <tag> git --version`: "git version 2.53.0"

Verify:
- `result.exitCode === 0`
- `result.phases.containerVerification.exitCode === 0`
- `result.phases.containerVerification.message` contains "2.53.0"

**T9: Pipeline fails post-build verification when git too old**

Same setup but mock `docker run` returns "git version 2.39.5".

Verify:
- `result.exitCode === 1`
- `result.phases.containerVerification.exitCode === 1`
- `result.phases.containerVerification.message` contains remediation

**T10: Pipeline skips verification without prebuild features**

Create a workspace with extensions but no prebuild features.

Verify:
- `result.phases.containerVerification` is undefined
- Extension info appears in workspace layout warnings

**T11: `--skip-validation` bypasses post-build verification failure**

Same as T9 but with `skipValidation: true`.

Verify:
- `result.exitCode === 0` (pipeline continues)
- `result.phases.containerVerification.exitCode === 0` (downgraded,
  following the workspace layout convention where `--skip-validation`
  sets exitCode 0 with "(downgraded)" message suffix)
- `result.phases.containerVerification.message` contains "(downgraded)"
- Warning logged to stderr

**T12: Pipeline without extensions skips verification entirely**

Normal workspace without extensions and with prebuild features.

Verify:
- `result.phases.containerVerification` is undefined
- No `docker run` call in subprocess mock log

### Unit Tests in `prebuild.integration.test.ts`

**T13: `runPrebuild` with `force: true` passes `--no-cache`**

Mock subprocess. Call `runPrebuild({ force: true })`.

Verify:
- `devcontainer build` args include `--no-cache`

**T14: `runPrebuild` without `force` omits `--no-cache`**

Mock subprocess. Call `runPrebuild({})` with stale cache.

Verify:
- `devcontainer build` args do NOT include `--no-cache`

**T15: `runPrebuild` returns `prebuildTag` in result**

Verify:
- `result.prebuildTag` is set to the expected tag string

## Implementation Phases

### Phase 1: Core Verification Function + Remove Extension Error

**Changes:**
- `packages/lace/src/lib/workspace-detector.ts`:
  - Add `compareVersions()` function.
  - Add `ContainerGitVerificationResult` interface.
  - Add `verifyContainerGitVersion()` function.
  - Add `getDetectedExtensions()` helper (returns extension map from a
    `ClassificationResult`, using the bare repo root from the
    classification to read the git config internally).
  - Add import for `RunSubprocess` type.
- `packages/lace/src/lib/workspace-layout.ts`:
  - Remove the `unsupported-extension` error block (lines 201-218).
  - The general warning collection (lines 99-103) still includes
    extension warnings as informational messages.
- `packages/lace/src/lib/prebuild.ts`:
  - Add `prebuildTag?: string` to `PrebuildResult`.
  - Set `prebuildTag` in each return path that produces/reactivates an
    image: fresh build success (line ~341), cache reactivation (line
    ~241), up-to-date cache hit (lines ~214, ~225). Dry-run and failure
    paths do NOT set it.
  - Add `--no-cache` to `devcontainer build` args when `options.force`
    is true.

**Constraints:**
- Do NOT change hard classification checks in `workspace-layout.ts`.
- Do NOT change absolute-gitdir check in `workspace-layout.ts`.
- Do NOT change `checkGitExtensions` (detection still works the same,
  just no longer causes errors).
- Do NOT change host-validator.ts.

**Success criteria:**
- `applyWorkspaceLayout` returns `status: "applied"` for workspaces with
  extensions (was `"error"`).
- `verifyContainerGitVersion` correctly passes/fails based on actual
  version comparison.
- `getDetectedExtensions` returns the extension map for bare-worktree
  classifications with extensions, null otherwise.
- `runPrebuild` returns the `prebuildTag` in its result.
- `--no-cache` is passed when `force` is true.
- All existing tests updated to reflect that extension check is no
  longer an error in Phase 0a (test assertions that expected
  `status: "error"` for extensions now expect `status: "applied"`).

### Phase 2: Integrate Post-Build Verification into Pipeline

**Changes:**
- `packages/lace/src/lib/up.ts`:
  - Add `containerVerification` to `UpResult.phases` interface.
  - After the prebuild phase (line ~579), add the post-build
    verification block using `getDetectedExtensions()` (from
    `workspace-detector.ts`) and `verifyContainerGitVersion`.
  - Gate on `hasPrebuildFeatures`, presence of `prebuildResult.prebuildTag`,
    and non-null return from `getDetectedExtensions`.
  - Respect `--skip-validation` for the new phase (downgrade convention:
    exitCode 0 with "(downgraded)" suffix, matching workspace layout).
  - Use `prebuildResult.prebuildTag` from Phase 1.

**Constraints:**
- Pipeline ordering does not change (no conditional reorder).
- No new CLI flags.
- The verification only fires when extensions are detected AND prebuild
  produced an image.

**Success criteria:**
- `lace up` on a workspace with extensions + adequate prebuild git:
  passes post-build verification.
- `lace up` on a workspace with extensions + inadequate prebuild git:
  fails post-build verification with actionable message.
- `lace up` on a workspace without extensions: verification skipped.
- `lace up --skip-validation` on a workspace with extensions +
  inadequate git: verification downgraded to warning.
- All existing tests pass.

### Phase 3: Integration and Unit Tests

**Changes:**
- Add tests T1-T15 (including T1b) as described in the Test Plan.
- Update existing `workspace-layout.test.ts` tests that assert
  `status: "error"` for extension scenarios to assert `status: "applied"`.
- Review `workspace_smoke.test.ts` (~lines 121-138) which strips
  extensions from test repos to avoid the current error. After this
  change, that workaround is no longer necessary for the extension
  check. It may be retained for test isolation reasons but should be
  documented as optional.

**Constraints:**
- Use existing test infrastructure (mock subprocess, temp directories).
- Tests must be self-contained (no dependency on host git version or
  Docker availability).

**Success criteria:**
- All new tests pass.
- All existing tests pass (with assertion updates).
- Coverage confirms post-build verification triggers only when expected.
