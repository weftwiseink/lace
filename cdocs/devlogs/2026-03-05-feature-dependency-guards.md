---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-05T10:00:00-06:00
task_list: lace/feature-dependencies
type: devlog
state: live
status: done
tags: [devcontainer-features, dependencies, install-safety, dependsOn, lace]
related_to:
  - cdocs/proposals/2026-03-05-feature-install-context-dependency-safety.md
  - cdocs/reports/2026-03-05-devcontainer-feature-dependency-research.md
---

# Feature Dependency Guards: Devlog

## Objective

Implement the short-term recommendations from the feature install context dependency
safety RFP: add `dependsOn` declarations for hard feature dependencies, harden
install.sh guards, and document dependencies in feature READMEs.

## What Changed

### 1. `dependsOn` declarations in feature metadata

Added `dependsOn` to `devcontainer-feature.json` for three features:

| Feature | Depends On | Reason |
|---------|-----------|--------|
| wezterm-server | `ghcr.io/devcontainers/features/sshd:1` | SSH server for domain multiplexing |
| claude-code | `ghcr.io/devcontainers/features/node:1` | npm for CLI installation |
| portless | `ghcr.io/devcontainers/features/node:1` | npm for CLI installation |

neovim was excluded -- it only needs `curl` which is a base image tool, not a feature.
The existing `command -v curl` guard in its install.sh is sufficient.

Existing `installsAfter` declarations were preserved for backward compatibility with
tools that do not support `dependsOn` (notably DevPod).

### 2. Post-install sshd warning in wezterm-server

Added a non-fatal warning at the end of `wezterm-server/install.sh` that checks for
sshd presence via `command -v sshd` and `/usr/sbin/sshd`. The warning is deliberately
not a fatal error because:

- With `dependsOn`, sshd is auto-installed on supported tools -- but `dependsOn`
  guarantees sshd is installed *before* wezterm-server, so it should be present.
- With `installsAfter` only, sshd may install *after* wezterm-server, so its absence
  at install time is expected.
- DevPod does not support `dependsOn`, so users must add sshd manually. The warning
  gives them actionable guidance.

### 3. Existing install.sh guards verified

Verified that all four features have prerequisite guards with actionable error messages:

- **wezterm-server**: `command -v curl` (fatal, line 8)
- **claude-code**: `command -v npm` (fatal, line 7)
- **portless**: `command -v npm` (fatal, line 10)
- **neovim**: `command -v curl` (fatal, line 13)

All guards exit with non-zero and print the specific feature to add. No changes needed.

### 4. Dependency documentation in READMEs

Added a "Dependencies" section to each feature README documenting:

- What the feature depends on (table with dependency, reason, auto-installed status)
- That `dependsOn` auto-installs on supported tools (devcontainer CLI v0.44.0+, VS Code)
- That DevPod users must manually add the dependency
- That base images with npm satisfy the node dependency without duplication

Also created the missing portless README (it previously had none).

## Strategy: Layered Defense in Depth

The implementation follows a three-layer strategy:

1. **`dependsOn`** (spec-level): Automatic dependency resolution on tools that support
   it. Zero user configuration needed. This is the happy path.

2. **install.sh guards** (runtime): Fatal errors for install-time prerequisites (curl,
   npm), non-fatal warnings for runtime prerequisites (sshd). Works everywhere regardless
   of tool support. This is the safety net.

3. **README documentation** (human): Clear tables showing what is needed, why, and how
   to handle it per tool. This covers the edge cases neither layer above can express.

## Verification

### Test suite

All 812 tests across 32 test files pass. The `dependsOn` additions to JSON metadata do
not affect tests because the test suite uses local feature paths (which bypass OCI
resolution and `dependsOn` processing).

```
Test Files  32 passed (32)
     Tests  812 passed (812)
  Duration  47.98s
```

### JSON validation

All four `devcontainer-feature.json` files validated with `python3 -m json.tool`.

### What is NOT tested

- `dependsOn` resolution by the devcontainer CLI (requires a real `devcontainer up`
  against the published OCI artifacts, not local paths).
- DevPod behavior when encountering `dependsOn` (expected: silently ignored).
- The sshd warning firing during a real build (requires building without sshd present).

These would be validated during the next end-to-end integration test session.

## Commits

1. `feat(features): add dependsOn declarations for hard dependencies`
2. `feat(wezterm-server): add post-install sshd presence warning`
3. `docs(features): document dependencies in feature READMEs`
