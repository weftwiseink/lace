---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T13:00:00-08:00
task_list: lace/packages-lace-cli
type: report
state: archived
status: done
tags: [devcontainer, cli, prebuild, architecture, design-decisions]
---

# Design Decisions: packages/lace Prebuild CLI

Reference document for the design decisions behind the `packages/lace` devcontainer wrapper CLI.
See the proposal: `cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md`.

## 1. Pre-bake features into the base image, not into the final image

Modifying the base image (the first `FROM` target) means all subsequent Dockerfile layers (apt installs, COPY, RUN) build on top of the pre-baked features.
This preserves the existing Dockerfile's layer structure and cache behavior.
Baking into the final image would require multi-stage build modification or post-build injection, both more complex and fragile.

## 2. Use `customizations.lace` namespace

The devcontainer spec provides `customizations.<tool>` for tool-specific configuration (VSCode uses `customizations.vscode`, Codespaces uses `customizations.codespaces`).
This keeps all container configuration in one file rather than introducing a separate lace config.

## 3. Tag pre-baked images as `lace.local/<image>:<tag>` preserving original version

Human-readable tags make debugging easier: `docker images | grep lace.local` shows what was pre-baked.
Preserving the original tag (e.g., `lace.local/node:24-bookworm` from `FROM node:24-bookworm`) makes lineage clear.
The lock file provides reproducibility; the tag provides the human interface.

For digest-based references (`FROM node@sha256:abc123...`), the tag format is `lace.local/node:from_sha256__abc123...` since Docker tags cannot contain `@`.
The `from_` prefix signals provenance; `__` substitutes for `:`.

## 4. Only rewrite the first `FROM` line

For single-stage Dockerfiles (the common devcontainer case), the first `FROM` is the only base image.
For multi-stage builds, the first FROM is a simple default that may not always be correct (it is often the build stage, not the runtime stage).
A future `--target-stage` flag can support multi-stage users.

## 5. Shell out to `devcontainer` CLI

The devcontainer CLI handles feature resolution, download, and installation with significant internal complexity.
Shelling out treats it as a stable interface, avoids coupling to internal APIs, and works with whatever CLI version the user has.
The `--image-name` flag on `devcontainer build` combines build and tag into one step.

Minimum CLI version requirements for `--image-name` support should be documented during implementation.

## 6. Rewritten Dockerfile is a local-only modification

The `lace.local/*` image only exists on the machine where `lace prebuild` ran.
Committing the rewrite would break `devcontainer up` for anyone who hasn't run prebuild.
The original Dockerfile stays committed; `.lace/` is gitignored.

This means prebuild is a purely local optimization.
New team members can skip lace entirely and `devcontainer up` works (features install at creation time, slower but functional).
This graceful degradation makes lace an optimization, not a hard dependency.

## 7. Cache full prebuild context in `.lace/prebuild/`

Storing the complete generated context (Dockerfile, devcontainer.json) alongside metadata enables:

- **Rebuild detection**: Comparing cached context against freshly generated context determines if a rebuild is needed. Because the cached devcontainer.json contains only prebuild features (not the original `features` entries), this comparison naturally ignores changes to non-prebuild configuration (vscode extensions, mounts, postCreateCommand, etc.).
- **Future smart cache invalidation**: Field-level diffing of the cached vs. new context can skip rebuilds when only non-impactful fields changed (see RFP: smart prebuild cache busting).
- **Debuggability**: `ls .lace/prebuild/` shows exactly what was fed to `devcontainer build`.

## 8. Namespace prebuild lock entries under `lace.prebuiltFeatures`

The devcontainer CLI reads `devcontainer-lock.json` to resolve feature versions.
Top-level prebuild entries would confuse it (attempting to resolve features already baked into the base image).
Namespacing under `lace.prebuiltFeatures` keeps entries invisible to the devcontainer CLI.
During prebuild, lace extracts these into the temp context's lock file for the devcontainer CLI to use.

## 9. Use a Dockerfile AST parser instead of regex

The Dockerfile spec has edge cases regex cannot handle cleanly: heredoc syntax, multi-line continuation, parser directives (`# syntax=`, `# escape=`), `ARG` before `FROM` with variable substitution.
A proper AST parser (e.g., `dockerfile-ast`) handles these and provides structured instruction access.

**Implementation note**: Verify `dockerfile-ast` heredoc support during Phase 2.
If unsupported, tests should validate that lace detects the unsupported syntax and reports it clearly rather than silently producing incorrect output.
This aligns with the general principle: detect what we can't handle and fail loudly.

## 10. `image`-based devcontainer configs are unsupported for v1

When devcontainer.json uses `"image"` instead of `"build.dockerfile"`, the devcontainer CLI may ignore a generated Dockerfile in favor of the `image` field.
Rather than introducing a second rewrite path (mutating devcontainer.json's `image` field) with unclear devcontainer CLI behavior, v1 declares this variant unsupported with a clear error message.
The Dockerfile rewrite path is the primary and well-understood mechanism.
`image`-based support can be revisited as a future enhancement if demand warrants.

## Usage Stories

### Developer adds a heavy feature

Developer adds claude-code under `customizations.lace.prebuildFeatures`, runs `lace prebuild`.
Subsequent `devcontainer up` starts in seconds instead of 90+ with feature installation.
The Dockerfile's FROM line now points to `lace.local/node:24-bookworm` with claude-code pre-installed.

### CI rebuilds on feature version bumps

CI runs `lace prebuild` after devcontainer.json changes.
Lock file is committed for reproducibility.
Unchanged prebuild config (detected via cached context comparison) is a no-op.

### New team member without lace

Clone repo, run `devcontainer up` directly.
The committed Dockerfile uses the original base image, so the container builds.
`prebuildFeatures` are not installed (not in `features` block), but the container is functional.
Install lace later for the speed optimization. Lace is not a hard dependency.

### Branch switching with different feature sets

Branch A: claude-code + wezterm. Branch B: claude-code only.
`lace prebuild` produces branch-specific `lace.local/*` images.
`lace restore` returns the Dockerfile to its committed state.

---

## Post-Implementation Additions (2026-02-01)

The following decisions emerged from post-implementation amendments. They build on decisions #3, #6, and #7 above.

## 11. Bidirectional tag encoding (`parseTag` as inverse of `generateTag`)

`lace restore` does not require `.lace/prebuild/metadata.json` to recover the original FROM reference. The `lace.local/` tag format is designed to be reversible:

- Strip `lace.local/` prefix for tagged images.
- Detect `from_` prefix and `__` substitution for digest-based images.

This shifts metadata from "required state" to "optional cache." Restore is self-healing: it works even if metadata is missing, corrupted, or from a different lace version. Metadata remains a fallback for edge cases where tag parsing fails.

The trade-off is a minor ambiguity: `lace.local/node:latest` restores to `node:latest`, which is semantically equivalent to the original `FROM node` (untagged) but not byte-identical.

## 12. Preserve `.lace/prebuild/` on restore (cache over cleanup)

Restore only rewrites the Dockerfile FROM line. It does not delete `.lace/prebuild/`. The cached context, metadata, and lock data persist for:

- **Cache reactivation**: `lace prebuild` after `lace restore` detects fresh cache and rewrites the FROM line without calling `devcontainer build`. This makes the `restore → commit → re-prebuild` workflow instant.
- **Debugging**: `.lace/prebuild/` always shows what the last prebuild used.
- **Future tooling**: inspecting prebuild state without requiring a rebuild.

The prior approach (delete on restore) meant every `lace prebuild` after `lace restore` was a full Docker build, even when nothing changed. Cache reactivation is the natural consequence of keeping the cache around.

## 13. Concurrency protection at the CLI layer, not the library layer

`withFlockSync` uses the Unix `flock(1)` command to acquire an exclusive lock on `.lace/prebuild.lock`. The lock is applied in the CLI command wrappers (`commands/prebuild.ts`, `commands/restore.ts`), not in the library functions (`lib/prebuild.ts`, `lib/restore.ts`).

This means:
- Tests call library functions directly, without contention or lock overhead.
- Library consumers can choose their own locking strategy (or skip locking for single-threaded use).
- The CLI layer is the natural boundary for process-level mutual exclusion.

The flock implementation uses fd passing via `spawnSync` stdio: the parent opens the lock file, passes the fd as stdio[3] to a child `flock -xn 3` process, and the lock persists on the shared file description after the child exits. This is the standard Unix pattern for in-process flock acquisition without native bindings.
