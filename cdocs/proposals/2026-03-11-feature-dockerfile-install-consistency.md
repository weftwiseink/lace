---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T12:00:00-08:00
task_list: cdocs/task-lists/lace-devcontainer.md
type: proposal
state: live
status: request_for_proposal
tags: [devcontainer, dockerfile, features, validation, developer-experience]
related_to:
  - cdocs/proposals/2026-03-10-git-relativeworktrees-version-mismatch.md
  - cdocs/reports/2026-03-07-weftwise-lace-migration-failure-analysis.md
  - cdocs/proposals/2026-03-05-feature-install-context-dependency-safety.md
---

# Feature-Dockerfile Install Consistency: Detect and Prevent Shadowed Binaries

> BLUF: Dockerfile `apt-get install` commands can install older versions of tools
> that devcontainer features also install, creating shadowed binaries at different
> paths (e.g., git 2.39.5 at `/usr/bin/git` from apt vs git 2.53.0 at
> `/usr/local/bin/git` from the git feature). This class of version mismatch
> caused the `extensions.relativeWorktrees` breakage and is a general hazard in
> the devcontainer ecosystem. Lace should detect, warn about, and guide users
> away from Dockerfile-feature install conflicts.
>
> - **Motivated By:**
>   - `cdocs/proposals/2026-03-10-git-relativeworktrees-version-mismatch.md`
>   - `cdocs/reports/2026-03-07-weftwise-lace-migration-failure-analysis.md`

## Objective

When a Dockerfile installs a tool via `apt-get` and a devcontainer feature
installs the same tool to a different path, users encounter subtle version
mismatches, PATH shadowing bugs, and configuration incompatibilities. The git
version mismatch in lace's own devcontainer (Dockerfile's apt-installed git
2.39.5 vs the git feature's 2.53.0) is a concrete example: the older git could
not understand `extensions.relativeWorktrees`, breaking all git operations inside
the container. The fix was removing `git` from the Dockerfile's `apt-get install`
line and relying solely on the feature.

This problem is not git-specific. Any tool installed by both a Dockerfile and a
feature is at risk: `curl`, `ssh`, `node`, `python`, etc. Lace should provide
guardrails that help users avoid this class of bug entirely, rather than
discovering it through cryptic runtime failures.

## Scope

The full proposal should explore:

### 1. Startup Validation

When `lace up` runs, detect version mismatches between Dockerfile-installed
tools and feature-installed tools. Specifically:

- After the container is running, check for binaries that exist at multiple
  paths (e.g., `/usr/bin/git` and `/usr/local/bin/git`).
- Compare versions of duplicated binaries.
- Warn users when a feature-installed binary is shadowed by an older
  Dockerfile-installed binary (or vice versa), depending on PATH order.
- Consider whether this check belongs in a post-up validation phase or as a
  health check that runs on `lace status`.

### 2. Dockerfile Linting and Analysis

During `lace prebuild` or `lace up`, analyze the Dockerfile for `apt-get
install` packages that overlap with configured features:

- Parse `RUN apt-get install` lines in the Dockerfile to extract package names.
- Cross-reference against the configured features in
  `customizations.lace.prebuildFeatures` (or top-level `features`).
- Warn when a Dockerfile installs a package that a configured feature is known
  to provide (e.g., `apt-get install git` when
  `ghcr.io/devcontainers/features/git:1` is configured).
- Suggest removal of the redundant Dockerfile install, or suggest removing the
  feature if the user prefers the apt version.

### 3. User Guidance

Guide users toward using features instead of Dockerfile installs for common
developer tools:

- Documentation: a "best practices" section in lace docs explaining why features
  should be preferred for tooling (version control, declarative config,
  reproducibility).
- Warnings: emit actionable warnings during `lace up` when conflicts are
  detected, with specific remediation steps (which line to remove from the
  Dockerfile, or which feature to remove).
- Auto-suggestions: when `lace init` scaffolds a new project, detect common
  tools in the Dockerfile and suggest migrating them to features.

### 4. Feature-First Philosophy

Consider whether lace's API and documentation should encourage a "features-first"
approach:

- The Dockerfile handles the base image and application-specific dependencies
  (libraries, build tools, runtime data).
- Features handle developer tooling (git, ssh, editors, language runtimes, CLI
  tools).
- This separation is already implicit in lace's `prebuildFeatures` design, but
  it is not enforced or documented as a best practice.
- Should lace emit a warning when a Dockerfile installs packages from a known
  "tooling" category (git, curl, wget, ssh, vim, neovim, etc.) that have
  well-known feature equivalents?

## Open Questions

- **Binary-to-feature mapping**: How do we reliably detect which binaries a
  feature provides vs what `apt-get` installs? Feature metadata
  (`devcontainer-feature.json`) does not declare the binaries a feature installs.
  We would need either a maintained mapping database, heuristics based on feature
  IDs (e.g., `features/git:1` obviously provides `git`), or post-install
  introspection inside the container.

- **Severity level**: Should duplicate installs be a hard error, a warning, or
  configurable severity? A hard error would be safest but could block legitimate
  use cases. A warning with `--strict` escalation may be more practical.

- **Intentional overrides**: How do we handle cases where the user intentionally
  wants the apt version over the feature version (e.g., pinning to a specific
  Debian-packaged version for reproducibility)? There should be an escape hatch,
  perhaps an annotation in the Dockerfile or a lace config option like
  `allowDockerfileOverrides: ["git"]`.

- **Known-features database**: Should lace maintain a static mapping of common
  feature IDs to the binaries/packages they provide? For example:
  - `ghcr.io/devcontainers/features/git:1` -> `git`
  - `ghcr.io/devcontainers/features/node:1` -> `node`, `npm`, `npx`
  - `ghcr.io/devcontainers/features/python:1` -> `python`, `pip`
  - `ghcr.io/devcontainers/features/sshd:1` -> `sshd`
  This could start small and grow, or it could be community-contributed.

- **Scope boundary with feature-install-context-dependency-safety**: The related
  proposal (`2026-03-05-feature-install-context-dependency-safety.md`) addresses
  features that depend on base-image prerequisites. This proposal addresses the
  inverse: base-image installs that conflict with features. Should these be
  unified into a single "feature-Dockerfile coherence" system, or kept as
  separate checks?

- **Static vs runtime detection**: Dockerfile analysis (static) can catch
  obvious overlaps before building, but cannot detect version mismatches or PATH
  shadowing. Container introspection (runtime) can detect actual conflicts but
  only after the container is built. Should lace do both, with static analysis as
  an early warning and runtime checks as confirmation?

## Context

### The Git Version Incident

Lace's own `.devcontainer/Dockerfile` previously included `apt-get install -y
git`, which installed Debian Bookworm's git 2.39.5 to `/usr/bin/git`. The
prebuild feature `ghcr.io/devcontainers/features/git:1` with `version: latest`
installed git 2.53.0 to `/usr/local/bin/git`. Because `/usr/local/bin` precedes
`/usr/bin` in the default PATH, the feature's git took precedence -- but only
when the feature was properly installed. During certain build phases or in edge
cases, the apt-installed git could be resolved first.

The mismatch became critical when the host's git 2.53.0 set
`extensions.relativeWorktrees = true` in the bare repo config. The container's
git (whichever version was resolved) needed to be 2.48+ to understand this
extension. The fix was two-part:

1. Remove `git` from the Dockerfile's `apt-get install` line (prevent the
   conflict).
2. Add the `unsupported-extension` validation check to lace's workspace detector
   (prevent the symptom).

The Dockerfile now includes a comment explaining why git is not installed there:

```dockerfile
# NOTE: git is NOT installed here; it is provided by the devcontainer feature
#   ghcr.io/devcontainers/features/git:1 (see .lace/prebuild/devcontainer.json)
```

This comment-based approach works for lace's own Dockerfile, but does not scale
to other projects that lace manages. Automated detection would catch this class
of problem across all lace-managed projects.

### The Devcontainer Feature Ecosystem

The devcontainer features spec provides a declarative way to install tools into
containers. Features install to `/usr/local/bin` (or similar paths) and are
designed to be composable. However, the spec does not address conflicts with
tools already present in the base image or installed by the Dockerfile. This is
a known gap in the ecosystem, and lace is well-positioned to fill it for its
users.
