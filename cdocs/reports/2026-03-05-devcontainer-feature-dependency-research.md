---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-05T00:00:00-05:00
type: report
state: live
status: review_ready
tags: [devcontainer-features, dependencies, spec-research]
---

# Devcontainer Feature Dependency Research

> BLUF: The devcontainer spec **does** support hard feature dependencies via a `dependsOn` property, added to the spec in August 2023 and shipped in devcontainer CLI v0.44.0 (June 2023). However, adoption is extremely low: zero of the 30+ official `devcontainers/features` use it, the `devcontainers/action` only added schema support in December 2023, and DevPod still does not implement it (as of March 2026). The official features repo relies exclusively on `installsAfter` (soft ordering) and self-contained `install.sh` scripts that bundle their own prerequisites. For lace's wezterm-server feature, which needs sshd, the pragmatic path today is to continue using `installsAfter` plus documentation -- but `dependsOn` on `ghcr.io/devcontainers/features/sshd:1` is the correct long-term declaration once tool support stabilizes.

## Context / Background

Lace publishes devcontainer features (wezterm-server, portless, claude-code, neovim) that have implicit relationships with other features. The most critical case: wezterm-server requires an SSH server (sshd) to function, but currently declares this as a soft ordering dependency via `installsAfter` rather than a hard requirement. If a user omits the sshd feature from their `devcontainer.json`, the wezterm-server feature installs successfully but fails at runtime with no clear error.

This report investigates whether the devcontainer spec provides a mechanism for declaring hard dependencies, what the ecosystem does in practice, and what the implications are for lace's feature authoring strategy.

## 1. Does the Spec Support Feature Dependencies?

**Yes.** The spec defines two dependency mechanisms:

### `dependsOn` -- Hard Dependencies

Added to the spec via [PR #234](https://github.com/devcontainers/spec/pull/234) (proposed May 2023, merged June 2023), with the reference implementation in [CLI PR #530](https://github.com/devcontainers/cli/pull/530) (merged June 2023), and synthesized into the main spec document via [PR #292](https://github.com/devcontainers/spec/pull/292) (merged August 2023). The formal specification lives at [`docs/specs/feature-dependencies.md`](https://github.com/devcontainers/spec/blob/main/docs/specs/feature-dependencies.md).

The `dependsOn` property is declared in `devcontainer-feature.json` and mirrors the `features` object syntax from `devcontainer.json`:

```json
{
  "id": "my-feature",
  "dependsOn": {
    "ghcr.io/devcontainers/features/sshd:1": {},
    "ghcr.io/some-org/some-feature:2": { "someOption": true }
  }
}
```

Key semantics:

- **Hard requirement.** All dependencies must be satisfied before the feature installs. If any dependency cannot be resolved, the entire devcontainer creation fails.
- **Recursive resolution.** If a dependency has its own `dependsOn`, those are resolved transitively.
- **Automatic installation.** Unlike `installsAfter`, the implementing tool must fetch and install `dependsOn` targets even if the user did not list them in their `devcontainer.json`.
- **Options passthrough.** Dependencies can receive configuration options, just like features in `devcontainer.json`.
- **Version and digest pinning.** Dependencies support semver tags and SHA256 digest pinning.

From the spec:

> "All Features indicated in the `dependsOn` property **must** be satisfied (a Feature equal to each dependency is present in the installation order) *before* the given Feature is set to be installed."

### `installsAfter` -- Soft Dependencies

The older mechanism (shipped with the original features spec, formalized in [issue #43](https://github.com/devcontainers/spec/issues/43)):

```json
{
  "id": "my-feature",
  "installsAfter": [
    "ghcr.io/devcontainers/features/common-utils",
    "ghcr.io/devcontainers/features/sshd"
  ]
}
```

Key semantics:

- **Ordering only.** Only affects the installation order of features that are *already* listed in the user's `devcontainer.json`.
- **Not recursive.** Does not traverse transitive `installsAfter` chains.
- **No auto-install.** If the referenced feature is not in the user's config, the relationship is silently ignored.
- **No options.** Cannot pass configuration to the referenced feature.

From the spec:

> "`installsAfter` only influences the installation order of Features that are **already set to be installed**."

### Historical Context

The original tracking issue is [devcontainers/spec#16](https://github.com/devcontainers/spec/issues/16) (February 2022), filed by Josh Spicer of the Codespaces team:

> "How do we handle an inevitable dependency graph for features that depend on other features. Currently we have no deterministic way to install dev container 'features', nor do we have any mechanism to indicate dependencies."

This evolved through several stages:
- [Issue #43](https://github.com/devcontainers/spec/issues/43) (June 2022): `installsAfter` proposal for soft ordering
- [Issue #109](https://github.com/devcontainers/spec/issues/109) (October 2022): "Composite features" tracking issue, the umbrella for hard dependencies
- [PR #208](https://github.com/devcontainers/spec/pull/208) (March 2023): "Composite Features" proposal (closed, superseded by `dependsOn`)
- [PR #234](https://github.com/devcontainers/spec/pull/234) (May 2023): `dependsOn` proposal (merged June 2023)
- [PR #292](https://github.com/devcontainers/spec/pull/292) (August 2023): Formal spec integration

There were no rejected proposals for alternative dependency mechanisms -- `dependsOn` was the accepted solution after the "composite features" concept was refined into it.

## 2. What Do Feature Authors Do in Practice?

### The Official Features Repo: Zero `dependsOn` Usage

The `devcontainers/features` repository -- the canonical collection maintained by the spec team -- contains **zero** uses of `dependsOn`. Every feature uses `installsAfter` exclusively:

| Feature | `installsAfter` targets |
|---------|------------------------|
| node | `common-utils` |
| python | `common-utils`, `oryx` |
| sshd | `common-utils` |
| go | `common-utils` |
| docker-in-docker | `common-utils` |
| git-lfs | `common-utils` |

This is a deliberate choice. As maintainer Chuck Lantz explained in the [issue #109 discussion](https://github.com/devcontainers/spec/issues/109):

> "`installsAfter` affects ordering but does not create a direct dependency that forces the download. That allows you to alter behavior based on whether or not something has already happened. e.g., if you need python, you can say that your feature happens after the python feature, and if there's no python by the time your feature executes, then you can install the system one to meet the need."

### Pattern: Self-Contained install.sh

The dominant pattern is that features bundle their own prerequisite logic. If a feature needs a tool, it checks for it and installs a minimal version itself rather than depending on another feature:

```bash
# From a community contributor in issue #109:
if ! type python3 >/dev/null 2>&1; then
  echo "ERROR: Use a base image with python3 installed, add it to your
  Dockerfile or use a python feature like
  https://github.com/devcontainers/features/tree/main/src/python"
  exit 1
fi
```

Community member AlexanderLanin articulated this philosophy directly in [issue #109](https://github.com/devcontainers/spec/issues/109):

> "I was missing hard-dependencies since I started experimenting with features, but actually that would be a bad idea. The whole point of features is to avoid god like Dockerfiles. We want small reusable pieces. Dependencies between features make it impossible to use a different feature to install python. Or maybe it's already in my base image and I don't even need a feature at all."

### Pattern: Fail-with-Error

Features that strictly require a prerequisite typically check with `command -v` or `type` and exit with a helpful error message directing users to the appropriate feature or base image. This is the "check and fail loudly" pattern.

### Pattern: README Documentation Only

Many community features simply document requirements in their README without any runtime checks. This is the least robust approach but also the most common for informal feature collections.

### Real-World `dependsOn` Usage

Usage of `dependsOn` in the wild is vanishingly rare. The most notable example found is the [Radius project's `radcli` feature](https://github.com/radius-project/radius/blob/main/deploy/devcontainer-feature/src/radcli/devcontainer-feature.json):

```json
{
  "name": "Radius CLI",
  "id": "radcli",
  "version": "0.1.0",
  "dependsOn": {
    "ghcr.io/dhoeric/features/oras:1": {}
  }
}
```

This example is also notable because it exposed a bug: the `devcontainers/action` schema validation rejected `dependsOn` as an unrecognized property ([issue #205](https://github.com/devcontainers/action/issues/205)), which was not fixed until [spec PR #354](https://github.com/devcontainers/spec/pull/354) added `dependsOn` to the JSON schema in December 2023 -- six months after the feature shipped in the CLI.

### devcontainers-contrib

The `devcontainers-contrib` collection (danielbraun89's features, now archived as of January 2025) implemented a primitive dependency system outside the spec. Daniel described it as "the most primitive one you can think of" in [issue #109](https://github.com/devcontainers/spec/issues/109). The maintainer noted they would simply adopt the official `dependsOn` implementation once available.

## 3. What Has the Devcontainer Team Stated?

### Official Guidance

Josh Spicer (devcontainer CLI maintainer) announced `dependsOn` availability in [issue #109](https://github.com/devcontainers/spec/issues/109) (June 2023):

> "An implementation based on [the `dependsOn` proposal] has been merged and shipped with version 0.44.0 of the CLI. GitHub Codespaces and the Dev Containers extension will pick up the changes in the coming weeks. [...] If you'd like to take advantage of these new changes, I'd suggest iterating on your Features directly with the dev container CLI, and staging the changes for when the functionality is available in the aforementioned tools!"

### Why `installsAfter` Exists but `dependsOn` Came Later

The spec team deliberately started with soft dependencies. As Spicer explained in [issue #109](https://github.com/devcontainers/spec/issues/109):

> "Our current goal with Features is that installation of one is atomic and idempotent (although we recognize that might not always be possible)."

The key design tension that delayed `dependsOn`: what happens when a user also specifies the dependency feature directly with different options? Spicer noted two possible behaviors -- deduplicate (per [issue #44](https://github.com/devcontainers/spec/issues/44)) or install twice. The spec ultimately chose: features with different options are treated as distinct, and a feature may install multiple times.

### Known Complexity Acknowledged by the devcontainers-contrib Maintainer

Daniel Braun provided an excellent analysis of the design challenges in [issue #109](https://github.com/devcontainers/spec/issues/109):

> "Lets assume a user has some kind of `extended java` feature. It wants the feature to be dependent on another feature [...] What was the user intention here?" He enumerated four distinct interpretations of what "depends on Java" means, from "any JDK" to "specifically this feature's install script." He concluded: "I'm not even talking about 'diamond' dependency collisions [...] There is absolutely no way to solving those other than require people to pin their feature versions and create a version lock file, as many other full-fledge dependency managers do."

### No Roadmap for Further Dependency Features

There are no open issues or proposals for extending the dependency system beyond what `dependsOn` and `installsAfter` provide. The spec team appears to consider the current system sufficient.

## 4. Implementation Support Matrix

| Tool | `installsAfter` | `dependsOn` | Notes |
|------|-----------------|-------------|-------|
| devcontainer CLI | Supported (v0.29+) | Supported (v0.44.0+, June 2023) | Reference implementation |
| VS Code Dev Containers | Supported | Supported | Picks up CLI releases |
| GitHub Codespaces | Supported | Supported | Rolled out weeks after CLI v0.44.0 |
| devcontainers/action | Supported | Schema added Dec 2023; [issue #205](https://github.com/devcontainers/action/issues/205) still open | Workaround: `disable-schema-validation` |
| DevPod | Supported | **Not implemented** | [Issue #1073](https://github.com/loft-sh/devpod/issues/1073) stale-closed; [issue #1950](https://github.com/loft-sh/devpod/issues/1950) open. A community fork (skevetter/devpod v0.8.1) has a partial implementation |
| JetBrains IDEs | Supported | Unknown | No public documentation found |
| Coder | Partial | Unknown | Devcontainer support is being reworked ([issue #16491](https://github.com/coder/coder/issues/16491)) |

The critical gap is DevPod. Their maintainer acknowledged `dependsOn` as a gap in [issue #1073](https://github.com/loft-sh/devpod/issues/1073) (May 2024): "it's indeed a gap in our implementation. We'll add it to the roadmap!" -- but the issue was subsequently stale-closed without implementation.

## 5. Current Landscape Summary

The ecosystem has settled into a clear pattern hierarchy:

1. **Self-contained features** (dominant pattern). Features install their own prerequisites. The official `devcontainers/features` collection follows this exclusively.

2. **`installsAfter` + README documentation** (common pattern). Features declare soft ordering for common co-installed features, and document hard requirements in their README. This is what lace's features currently do.

3. **`installsAfter` + fail-with-error** (emerging pattern). Features check for prerequisites in `install.sh` and exit with a clear error message if missing. This gives the user actionable feedback.

4. **`dependsOn`** (rare, forward-looking). Formally in the spec and supported by the reference CLI and VS Code, but not used by the official features collection, not supported by DevPod, and with only a handful of known adopters (Radius project).

The ecosystem's reluctance to adopt `dependsOn` appears driven by three factors:

- **Philosophy of independence.** The community values features that work on any base image without assumptions about other features. Hard dependencies reduce flexibility.
- **Tool support fragmentation.** DevPod's lack of support means features using `dependsOn` break for a significant user segment.
- **The "good enough" alternative.** Self-contained features with `installsAfter` hints solve most real-world cases without the complexity of recursive dependency resolution.

## 6. Implications for Lace

### Current State

Lace's wezterm-server feature uses `installsAfter` for sshd:

```json
"installsAfter": [
    "ghcr.io/devcontainers/features/common-utils",
    "ghcr.io/devcontainers/features/sshd"
]
```

This means: if a user includes sshd in their `devcontainer.json`, wezterm-server will install after it. If the user omits sshd, wezterm-server still installs but silently fails at runtime because there is no SSH server.

### The Dependency Gap

The TODO in the wezterm-server feature metadata already identifies this problem:

> "TODO: Decouple SSH port handling into a thin sshd wrapper feature. The wezterm-server feature should not own SSH port metadata -- it should depend on an sshd feature that declares its own port."

### Recommended Strategy (Layered)

**Short term: Add prerequisite checking to install.sh.** The wezterm-server `install.sh` should check for sshd presence (or at least for the sshd feature's marker files) and fail with a clear error message if missing. This follows the "fail-with-error" pattern used by community features.

**Medium term: Add `dependsOn` alongside `installsAfter`.** Once DevPod implements `dependsOn` support (or if lace's user base is exclusively VS Code / Codespaces), declare the hard dependency:

```json
{
  "dependsOn": {
    "ghcr.io/devcontainers/features/sshd:1": {}
  },
  "installsAfter": [
    "ghcr.io/devcontainers/features/common-utils",
    "ghcr.io/devcontainers/features/sshd"
  ]
}
```

The `installsAfter` is kept for backward compatibility with tools that do not implement `dependsOn` -- the spec notes that unknown properties should be ignored, so `dependsOn` will be silently skipped by older tools while `installsAfter` still provides ordering.

**Long term: Lean into lace's orchestration layer.** Since lace already manages the devcontainer lifecycle (`lace up` generates the extended config), lace itself can validate that required co-features are present before invoking `devcontainer up`. This is strictly more powerful than `dependsOn` because lace can check for features, mounts, port allocations, and other prerequisites in a single validation pass. The `customizations.lace` metadata already provides the vocabulary for this.

### Risk Assessment

- Using `dependsOn` today risks breaking DevPod users. DevPod silently ignores the property, so the feature installs but the dependency does not.
- Not using `dependsOn` means users who forget to include sshd get a confusing runtime failure.
- The layered approach (fail-with-error in `install.sh` + `dependsOn` + `installsAfter`) provides defense in depth.

## Sources

- [devcontainers/spec issue #16: Feature Dependency Management](https://github.com/devcontainers/spec/issues/16) -- original tracking issue (Feb 2022)
- [devcontainers/spec issue #43: Feature Installation Order](https://github.com/devcontainers/spec/issues/43) -- `installsAfter` proposal (June 2022)
- [devcontainers/spec issue #109: Composite Features](https://github.com/devcontainers/spec/issues/109) -- umbrella issue with extensive community discussion (Oct 2022)
- [devcontainers/spec PR #234: Feature `dependsOn` Proposal](https://github.com/devcontainers/spec/pull/234) -- formal proposal (merged June 2023)
- [devcontainers/cli PR #530: Feature Dependencies](https://github.com/devcontainers/cli/pull/530) -- reference implementation (merged June 2023)
- [devcontainers/spec PR #292: Add Feature Dependencies to Main Spec](https://github.com/devcontainers/spec/pull/292) -- spec integration (merged August 2023)
- [devcontainers/spec PR #354: Add `dependsOn` to schema](https://github.com/devcontainers/spec/pull/354) -- JSON schema fix (merged December 2023)
- [Feature Dependencies spec document](https://github.com/devcontainers/spec/blob/main/docs/specs/feature-dependencies.md) -- formal specification
- [Dev Container Features reference](https://containers.dev/implementors/features/) -- property definitions
- [devcontainers/action issue #205: Error using dependsOn](https://github.com/devcontainers/action/issues/205) -- schema validation failure (Dec 2023)
- [loft-sh/devpod issue #1073: Feature dependencies support](https://github.com/loft-sh/devpod/issues/1073) -- DevPod gap acknowledgment (May 2024, stale-closed)
- [loft-sh/devpod issue #1950: dependsOn property support](https://github.com/loft-sh/devpod/issues/1950) -- DevPod user report with repro (Dec 2025, open)
- [Radius project radcli feature](https://github.com/radius-project/radius/blob/main/deploy/devcontainer-feature/src/radcli/devcontainer-feature.json) -- real-world `dependsOn` example
- [Best Practices: Authoring a Dev Container Feature](https://containers.dev/guide/feature-authoring-best-practices) -- official guidance
- [devcontainers/features sshd](https://github.com/devcontainers/features/tree/main/src/sshd) -- official sshd feature
