---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-10T15:00:00-06:00
task_list: lace/workspace-validation
type: proposal
state: archived
status: result_accepted
tags: [git, worktree, devcontainer, version-mismatch, host-validation, extensions, relativeWorktrees]
related_to:
  - cdocs/proposals/2026-02-15-workspace-validation-and-layout.md
  - cdocs/proposals/2026-03-05-worktree-conversion-script.md
  - cdocs/reports/2026-02-13-worktree-aware-devcontainers.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-10T17:20:00-08:00
  round: 2
---

# Fix `extensions.relativeWorktrees` Git Version Mismatch in Devcontainers

> BLUF: The host's git 2.53.0 sets `extensions.relativeWorktrees = true` in
> the bare repo config when worktrees use relative gitdir paths. This
> extension was introduced in git 2.48.0. The lace devcontainer runs Debian
> Bookworm's git 2.39.5, which does not recognize the extension and fatally
> refuses to operate on the repository. The immediate fix is to upgrade git
> inside the container to 2.48+ via the `ghcr.io/devcontainers/features/git:1`
> prebuild feature with an explicit `version` option. The preventive fix adds
> a git extension compatibility check to lace's host validation phase (Phase 0b)
> that detects `repositoryformatversion = 1` + unrecognized extensions before
> container creation and surfaces an actionable error message.

## Objective

Make git operations work inside the lace devcontainer when the host git
(2.48+) has set `extensions.relativeWorktrees = true` in the repository
config. Prevent silent breakage when future git extensions create similar
version mismatches.

## Background

### The `extensions.relativeWorktrees` Extension

Git 2.48.0 ([released January 2025](https://github.blog/open-source/git/highlights-from-git-2-48/))
introduced the `relativeWorktrees` repository extension. When a worktree is
created or repaired with `--relative-paths`, or when `worktree.useRelativePaths`
is set to `true`, git automatically sets `extensions.relativeWorktrees = true`
in the repository config and bumps `core.repositoryformatversion` to `1`.

Repository format version `1` tells git to inspect the `extensions.*`
namespace. Any extension key that the running git version does not recognize
causes a fatal error:

```
fatal: unknown repository extension found:
	relativeworktrees
```

This is by design: unknown extensions could indicate data format changes that
an older git would misinterpret. The error is non-bypassable -- there is no
`-c` flag or config override that suppresses it.

### How This Manifested

The lace project's bare repo at `/var/home/mjr/code/weft/lace/` has the
following config (set by the host's git 2.53.0):

```ini
[core]
	repositoryformatversion = 1
	bare = true
[extensions]
	relativeWorktrees = true
```

The worktrees correctly use relative gitdir paths:

```
# /var/home/mjr/code/weft/lace/main/.git
gitdir: ../.git/worktrees/main

# /var/home/mjr/code/weft/lace/.git/worktrees/main/gitdir
../../../main/.git
```

When this bare repo is bind-mounted into the container at `/workspace/lace/`,
the container's git 2.39.5 (Debian Bookworm) encounters `extensions.relativeWorktrees`
and fatally refuses to operate:

```
$ docker exec lace git -C /workspace/lace/main status
fatal: unknown repository extension found:
	relativeworktrees
```

This breaks all git operations inside the container: `git status`, `git log`,
`git diff`, `git commit`, etc.

### Version Landscape

| Location | Git Version | Recognizes `relativeWorktrees`? |
|----------|-------------|-------------------------------|
| Host (Fedora 43) | 2.53.0 | Yes (introduced in 2.48.0) |
| Container (Debian Bookworm) | 2.39.5 | No |
| Git minimum for extension | 2.48.0 | Yes |

### The Container's Git Source

The container installs git from two sources:

1. **Dockerfile** (`apt-get install -y git`): Installs Debian Bookworm's
   packaged git 2.39.5.
2. **Prebuild feature** (`ghcr.io/devcontainers/features/git:1`): Runs
   during the prebuild phase. With no explicit `version` option, the
   devcontainer git feature defaults to `os-provided`, which is a no-op
   since git is already installed from apt.

Neither source installs a version new enough to recognize `extensions.relativeWorktrees`.

### Existing Lace Infrastructure

Lace already has infrastructure relevant to this problem:

- **`workspace-detector.ts`**: Classifies workspaces as `worktree`,
  `bare-root`, `normal-clone`, etc. Checks for absolute gitdir paths and
  emits warnings. Does not inspect the bare repo's `config` file.
- **`workspace-layout.ts`**: Applies workspace layout (workspaceMount,
  workspaceFolder) based on classification. Calls `classifyWorkspace()`.
- **`host-validator.ts`**: Runs `customizations.lace.validate.fileExists`
  checks during Phase 0b. Currently only supports file-existence checks.
- **`wt-clone`** (nushell dotfile script): Creates fresh bare-worktree
  clones with relative gitdir paths. Manually fixes paths rather than
  relying on `git worktree repair --relative-paths` for cross-version
  compatibility.

### Prior Art: The `absolute-gitdir` Warning

The workspace detector already has a pattern for detecting git configuration
issues that will break inside the container. When a worktree uses an absolute
gitdir path, `classifyWorkspace()` emits an `absolute-gitdir` warning, and
`applyWorkspaceLayout()` promotes it to a fatal error. This proposal follows
the same pattern for extension version mismatches.

## Proposed Solution

### Part 1: Immediate Fix -- Upgrade Git in the Container

Upgrade the container's git to 2.48+ by configuring the prebuild git feature
with an explicit version:

```jsonc
// .devcontainer/devcontainer.json
{
  "customizations": {
    "lace": {
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {
          "version": "latest"
        }
      }
    }
  }
}
```

The `ghcr.io/devcontainers/features/git:1` feature supports a `version`
option. When set to `"latest"` (or a specific version like `"2.48.0"`), it
builds git from source rather than using the OS package. This is the
standard devcontainer approach for getting a newer git on Debian Bookworm.

> NOTE: Building git from source adds build time to the prebuild phase
> (typically 2-3 minutes). Since the prebuild is cached, this cost is
> paid only on first build or when the feature changes.

### Part 2: Preventive Check -- Git Extension Compatibility Validation

Add a new check to the lace up pipeline that detects git extension
incompatibilities before container creation. This runs during the
workspace layout phase (Phase 0a), after workspace classification
but before config mutation.

#### Detection Algorithm

1. After `classifyWorkspace()` returns a `worktree` or `bare-root`
   classification, read the bare repo's git config file.
2. Parse `core.repositoryformatversion`. If it is `0`, no extensions
   are active -- skip the check.
3. If `repositoryformatversion >= 1`, extract all `extensions.*` keys.
4. Build a set of "known extensions" that the container's git is
   expected to support. Initially this is a static allowlist based on
   the git version known to be installed in the container.
5. If any extensions are present that are not in the allowlist, emit a
   warning with the extension name and the minimum git version required.

#### Where It Lives

The check belongs in `workspace-detector.ts` as a new function
`checkGitExtensions()`, called from `classifyWorkspaceUncached()` after
successfully classifying the workspace. It adds a new warning code
`unsupported-extension` to the `ClassificationWarning` type.

`workspace-layout.ts` (`applyWorkspaceLayout()`) promotes
`unsupported-extension` warnings to fatal errors (same pattern as
`absolute-gitdir`), with a clear remediation message.

#### Warning Shape

```typescript
export interface ClassificationWarning {
  code: "absolute-gitdir" | "standard-bare" | "prunable-worktree" | "unsupported-extension";
  message: string;
  remediation?: string;
}
```

Example warning:

```
ERROR: Repository uses git extension "relativeWorktrees" (requires git 2.48+)
  but the container's git may not support it.
  Hint: Set version to "latest" in the git prebuild feature:
    "ghcr.io/devcontainers/features/git:1": { "version": "latest" }
  Or remove the extension: git config --unset extensions.relativeWorktrees
```

#### Extension Version Map

A static mapping of known extensions to their minimum git version:

```typescript
const GIT_EXTENSION_MIN_VERSIONS: Record<string, string> = {
  "objectformat": "2.36.0",  // SHA-256 object format
  "worktreeconfig": "2.20.0", // Per-worktree config
  "relativeworktrees": "2.48.0",
};
```

> NOTE: This map does not need to be exhaustive. Unknown extensions that
> are NOT in the map still trigger a warning -- the message just cannot
> specify the minimum version. The map enhances the error message, not
> the detection.

### Part 3: Container Git Version Discovery (Future Enhancement)

The Phase 0 check runs on the host before the container exists, so it
cannot query the container's git version directly. The initial
implementation uses a conservative heuristic:

- If the devcontainer config includes
  `ghcr.io/devcontainers/features/git:1` with `version: "latest"` or a
  version >= 2.48, assume the container will have adequate git support and
  suppress the warning.
- Otherwise, assume the container has Debian Bookworm's default git
  (2.39.x) and flag any extensions requiring newer git.

A future enhancement could add a post-up check that runs `git --version`
inside the container and validates compatibility. This is out of scope for
this proposal.

## Important Design Decisions

### Decision: Upgrade Git via Feature Version, Not Apt Backport

**Decision:** Use `"ghcr.io/devcontainers/features/git:1": { "version": "latest" }`
to build git from source, rather than adding a backports apt source.

**Why:** The devcontainer git feature already has mature support for
building from source with arbitrary version selection. Debian Bookworm's
backports repository does not carry git 2.48+. Third-party PPAs (like
git-core PPA on Ubuntu) are not available for Debian. Building from source
via the standard feature is the idiomatic devcontainer approach and is
already cached by the prebuild pipeline.

### Decision: Check Runs in Workspace Detector, Not Host Validator

**Decision:** Add the extension check to `workspace-detector.ts` (called
from `classifyWorkspace()`), not to `host-validator.ts`.

**Why:** The extension check requires filesystem access to the bare repo's
git config file, which is already being read during workspace classification.
The host validator operates on `customizations.lace.validate` declarations
from devcontainer.json -- it checks user-declared preconditions, not
automatically detected issues. The workspace detector already has the
`absolute-gitdir` precedent for automatically detecting git configuration
problems. The extension check follows the same pattern: detect during
classification, promote to error during layout application.

### Decision: Static Extension Map Rather Than Runtime Git Query

**Decision:** Use a static map of extension names to minimum git versions
rather than querying the container's git at check time.

**Why:** The check runs during Phase 0 of `lace up`, before the container
exists. There is no container to query. The host's git version is
irrelevant (the host's git works fine). The static map provides actionable
error messages ("requires git 2.48+") without requiring a running
container. The map is small, stable (git extensions are added rarely), and
easy to maintain.

### Decision: Parse Git Config Directly, Do Not Shell Out to Git

**Decision:** Parse the bare repo's config file directly using simple
string parsing, rather than shelling out to `git config --list`.

**Why:** The workspace detector already uses filesystem-only detection (no
git binary required). Shelling out to git would introduce a dependency on
the host's git binary and would fail if the host's git is also old enough
to reject the extensions (unlikely but possible in CI environments).
Direct parsing of the INI-like git config format is straightforward for
the specific keys we need (`core.repositoryformatversion` and
`extensions.*`).

### Decision: Warning Promotion Pattern Matches `absolute-gitdir`

**Decision:** The workspace detector emits a `unsupported-extension`
warning; `applyWorkspaceLayout()` promotes it to a fatal error that
blocks `lace up`.

**Why:** This matches the existing `absolute-gitdir` pattern exactly.
Both represent git configuration issues that will cause the container's
git to fail at runtime. Both have clear remediations. Both should block
container creation rather than letting the user discover the problem
after a multi-minute build. The `--skip-validation` flag provides an
escape hatch for users who know what they are doing.

## Edge Cases / Challenging Scenarios

### E1: Multiple Extensions in Config

A repository could have multiple extensions (e.g., both `worktreeConfig`
and `relativeWorktrees`). The check should report all unsupported
extensions, not just the first one. Each gets its own warning entry.

**Handling:** Iterate all `extensions.*` keys and emit a warning for each
one not recognized by the container's expected git version.

### E2: User Removes Extension on Host, Then Re-adds It

If the user runs `git config --unset extensions.relativeWorktrees` to
unblock the container, then later runs `git worktree repair --relative-paths`
or creates a new worktree with `worktree.useRelativePaths = true`, the
extension will be re-added automatically by the host's git.

**Handling:** This is why the container git upgrade (Part 1) is the
primary fix. Removing the extension is a workaround that addresses the
symptom. The host validation check (Part 2) catches the recurrence
and surfaces a clear message.

### E3: Non-Bare-Worktree Repos With Extensions

Normal clones can also have `repositoryformatversion = 1` with extensions
(e.g., `objectFormat` for SHA-256 repos). The extension check should work
for all repository types, not just bare-worktree layouts.

**Handling:** The current proposal scopes the check to workspaces
classified as `worktree` or `bare-root` (the only types that trigger
workspace layout). For normal clones, the extension check is not needed
because lace does not bind-mount the `.git` directory into the container
in that case -- devcontainer handles it natively.

### E4: Devcontainer Feature Installs Latest Git But Extension Map Is Stale

If a new git extension is introduced in git 2.55, and the container's
feature installs `"latest"` (which would be 2.55+), the static extension
map might not list the new extension. The check would emit a false-positive
warning.

**Handling:** The heuristic in Part 3 suppresses warnings when the git
feature specifies `version: "latest"` or a version that exceeds the
maximum in the extension map. The worst case is a warning that can be
bypassed with `--skip-validation`.

### E5: Git Config Format Edge Cases

Git's config format has edge cases: values can span multiple lines with
trailing backslash, section names are case-insensitive, key names are
lowercased internally, and comments start with `#` or `;`.

**Handling:** The parser only needs to extract two patterns:
`repositoryformatversion = <N>` and `<key> = <value>` under
`[extensions]`. A line-by-line parser that tracks the current section
is sufficient. No need for a full INI parser.

### E6: The `wt-clone` Script Creates Repos Without the Extension

The `wt-clone` nushell script manually fixes gitdir paths rather than
using `git worktree repair --relative-paths`. This means `wt-clone`
does not trigger git to set `extensions.relativeWorktrees`. However,
subsequent git operations on the host (e.g., adding another worktree
with `worktree.useRelativePaths = true`) could still set it.

**Handling:** Document this in `wt-clone`'s output: "Note: relative
gitdir paths set manually. If you later use `git worktree repair
--relative-paths`, git will set `extensions.relativeWorktrees` which
requires git 2.48+ in your devcontainer."

## Test Plan

### Diagnosis Verification

1. **Confirm the error is reproducible:**
   ```sh
   docker exec lace git -C /workspace/lace/main status
   # Expected: "fatal: unknown repository extension found: relativeworktrees"
   ```

2. **Confirm the extension is in the config:**
   ```sh
   docker exec lace cat /workspace/lace/.git/config | grep -A1 extensions
   # Expected: relativeWorktrees = true
   ```

3. **Confirm the container's git version:**
   ```sh
   docker exec lace git --version
   # Expected: git version 2.39.5
   ```

### Fix Verification

4. **After upgrading the git feature version, rebuild the container and confirm:**
   ```sh
   docker exec lace git --version
   # Expected: git version 2.48.0 or later
   docker exec lace git -C /workspace/lace/main status
   # Expected: normal git status output, no fatal error
   ```

### Unit Tests for Extension Detection

5. **`workspace-detector.test.ts`:**
   - Create a bare-repo fixture with `repositoryformatversion = 1` and
     `extensions.relativeWorktrees = true` in the config.
   - Classify the workspace and verify a `unsupported-extension` warning
     is emitted.
   - Create a fixture with `repositoryformatversion = 0` and no extensions.
     Verify no warning.
   - Create a fixture with `repositoryformatversion = 1` and
     `extensions.noop = true`. Verify no warning (noop is universally
     supported).

6. **`workspace-layout.test.ts`:**
   - Pass a classified workspace with `unsupported-extension` warnings to
     `applyWorkspaceLayout()`. Verify it returns `status: "error"` with
     an actionable message.
   - Verify `--skip-validation` downgrades the error to a warning.

### Git Config Parser Tests

7. **Parser unit tests:**
   - Standard config with extensions section.
   - Config with comments, blank lines, multi-word section headers.
   - Config with no extensions section.
   - Config with `repositoryformatversion = 0` (no extension checking).
   - Config with multiple extensions.

### Integration Smoke Test

8. **End-to-end validation:**
   - Run `lace up --skip-devcontainer-up` on a workspace with the
     `extensions.relativeWorktrees` config present and no git version
     upgrade configured.
   - Verify the pipeline fails at the workspace layout phase with a
     clear error message.

## Implementation Phases

### Phase 1: Immediate Fix -- Upgrade Container Git

Update the lace devcontainer configuration to install a git version that
supports `extensions.relativeWorktrees`.

**Changes:**
- `.devcontainer/devcontainer.json`: Add `"version": "latest"` to the
  `ghcr.io/devcontainers/features/git:1` prebuild feature entry.
- Rebuild the prebuild image (`lace prebuild --force`).
- Verify git operations work inside the container.

**Success criteria:**
- `docker exec lace git --version` reports 2.48.0 or later.
- `docker exec lace git -C /workspace/lace/main status` succeeds.
- `docker exec lace git -C /workspace/lace/main log --oneline -5` succeeds.

### Phase 2: Git Config Parser

Add a minimal git config parser to `workspace-detector.ts` that extracts
`core.repositoryformatversion` and `extensions.*` keys from a bare repo's
config file.

**Changes:**
- `packages/lace/src/lib/workspace-detector.ts`: Add `parseGitConfigExtensions()`
  function that reads a git config file path and returns
  `{ formatVersion: number; extensions: Record<string, string> }`.
- `packages/lace/src/lib/__tests__/workspace-detector.test.ts`: Unit tests
  for the parser covering standard configs, comments, blank lines, missing
  sections, and edge cases.

**Constraints:**
- No changes to the classification logic yet -- this phase only adds the
  parser.
- No git binary dependency -- pure filesystem read + string parsing.

**Success criteria:**
- Parser correctly extracts format version and extensions from test
  fixtures.
- Parser handles edge cases (no extensions section, comments, blank lines).

### Phase 3: Extension Compatibility Warning

Wire the git config parser into the workspace classification pipeline.
Emit `unsupported-extension` warnings when the repository uses extensions
that may not be supported by the container's git.

**Changes:**
- `packages/lace/src/lib/workspace-detector.ts`:
  - Add `unsupported-extension` to the `ClassificationWarning.code` union.
  - Add `GIT_EXTENSION_MIN_VERSIONS` static map.
  - Add `checkGitExtensions()` function that reads the bare repo config
    and emits warnings for unrecognized extensions.
  - Call `checkGitExtensions()` from `classifyWorkspaceUncached()` for
    `worktree` and `bare-root` classifications.
- `packages/lace/src/lib/workspace-layout.ts`:
  - In `applyWorkspaceLayout()`, promote `unsupported-extension` warnings
    to fatal errors (matching the `absolute-gitdir` pattern).
  - Include actionable remediation in the error message.
- Update tests in both files.

**Constraints:**
- Do not modify `host-validator.ts` -- the check goes in the workspace
  detector.
- The warning code and message format should be consistent with existing
  warning types.

**Success criteria:**
- `classifyWorkspace()` on a repo with `extensions.relativeWorktrees`
  emits an `unsupported-extension` warning.
- `applyWorkspaceLayout()` blocks `lace up` with a clear error.
- `--skip-validation` bypasses the error.
- No false positives on repos without extensions or with only well-known
  extensions.

### Phase 4 (future, out of scope): Smart Suppression for Configured Git Feature

Add logic to suppress the extension warning when the devcontainer config
includes a git feature with a version known to support the detected
extensions. This is deferred because Phase 1 already fixes the actual
breakage, and the `--skip-validation` flag provides an escape hatch for
the warning. The complexity of version comparison logic (`"latest"`,
`"lts"`, semver) does not justify the marginal UX improvement at this
stage.
