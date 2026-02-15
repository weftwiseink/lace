---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T22:00:00-08:00
task_list: lace/template-variables
type: proposal
state: live
status: evolved
superseded_by: cdocs/proposals/2026-02-15-mount-accessor-api.md
tags: [mount-resolver, template-variables, settings, extensibility]
related_to:
  - cdocs/proposals/2026-02-14-structured-devcontainer-output.md
  - cdocs/reports/2026-02-14-devcontainer-json-object-specifications.md
  - cdocs/proposals/2026-02-06-rfp-claude-tools-lace-feature.md
  - cdocs/proposals/2026-02-15-mount-accessor-api.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-14T23:59:00-08:00
  round: 3
---

# Mount Template Variables

> BLUF: Introduce `${lace.mount.source(namespace/label)}` and `${lace.mount.target(namespace/label)}` template variables for devcontainer mount paths, following the architecture established by the `${lace.port()}` system in `template-resolver.ts`.
> The implementation adds a `MountPathResolver` class (analog to `PortAllocator` in `port-allocator.ts`) that resolves mount labels to host paths via a two-tier lookup: first check `~/.config/lace/settings.json` for a user override, then derive a default path under `~/.config/lace/<projectId>/mounts/<namespace>/<label>` with auto-creation.
> Phased rollout: Phase 1 delivers `${lace.mount.source()}` for project-level mounts only (no feature integration), Phase 2 adds feature mount declarations via `customizations.lace.mounts` with settings-based consent, Phase 3 adds `${lace.mount.target()}` for cross-feature container path references.
> The system resolves the current fragility in `.devcontainer/devcontainer.json` where mounts use hardcoded `${localEnv:HOME}/code/dev_records/weft/...` paths that are user-specific and non-portable.
>
> - **Key source files:** `template-resolver.ts` (pattern matching + resolution), `port-allocator.ts` (structural model), `settings.ts` (override infrastructure), `mounts.ts` (mount spec generation), `up.ts` (pipeline orchestration)
> - **Motivated by:** hardcoded mount paths in `.devcontainer/devcontainer.json` (lines 76-84) marked with `// TODO: Generalize`

## Objective

Enable devcontainer configs and features to declare mount points using template variables that lace resolves to concrete host and container paths, with sensible defaults and user-overridable configuration.
The system should:

1. **Eliminate hardcoded host paths** from devcontainer.json files.
A mount like `source=${localEnv:HOME}/code/dev_records/weft/bash/history,target=/commandhistory` should become `source=${lace.mount.source(project/bash-history)},target=/commandhistory`.

2. **Enable features to declare mount needs** (Phase 2).
A feature like claude-code could declare "I need persistent config storage mounted into the container" via its `devcontainer-feature.json` metadata, and lace would handle host path resolution and mount generation: analogous to how features declare port needs via `customizations.lace.ports` today.

3. **Support per-user overrides.**
Users with non-standard directory layouts can override mount sources in `~/.config/lace/settings.json` without modifying project configs.

4. **Auto-create host directories.**
When a mount source resolves to a lace-managed default path and that directory does not exist, lace creates it during `lace up`, preventing Docker's default behavior of creating root-owned directories for missing bind mount sources.

## Background

### The Hardcoded Mount Problem

The lace project's own `.devcontainer/devcontainer.json` contains four mounts (lines 75-84):

```jsonc
"mounts": [
  "source=${localEnv:HOME}/code/dev_records/weft/bash/history,target=/commandhistory,type=bind",
  "source=${localEnv:HOME}/code/dev_records/weft/claude,target=/home/node/.claude,type=bind",
  "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly",
  "source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly"
]
```

Mounts 1-2 use hardcoded paths under `${localEnv:HOME}/code/dev_records/weft/`.
These work only for the original author's machine layout.
Any other contributor would need to either replicate this directory structure or fork the devcontainer config.
This is exactly the problem `${lace.port()}` solved for port numbers: the hardcoded value works for one person but breaks portability.

### The Port System as a Structural Model

The `${lace.port()}` system in `template-resolver.ts` (lines 33-35) provides the architectural template:

- **Pattern matching:** `LACE_PORT_PATTERN` regex identifies template expressions in config strings
- **Label format:** `featureId/optionName` namespaces labels to features
- **Allocation:** `PortAllocator` in `port-allocator.ts` assigns from a numeric range (22425-22499), persists in `.lace/port-assignments.json`
- **Resolution:** `resolveStringValue()` (line 294) checks for unknown patterns (hard error), then resolves port templates with type coercion (standalone = integer, embedded = string)
- **Auto-injection:** `autoInjectPortTemplates()` (line 120) reads `customizations.lace.ports` from feature metadata and injects templates for options the user has not set
- **Feature validation:** port declaration keys must match option names in the feature schema
- **Guard:** `LACE_UNKNOWN_PATTERN` (line 34) rejects any `${lace.*}` expression that is not `${lace.port()}`

Mount template variables translate these concepts to the filesystem domain.
The key simplification: mounts have no contention problem (unlike ports, two mounts can coexist at arbitrary paths), so "allocation" reduces to path derivation with a naming convention.
Mounts always resolve to strings (paths): no type coercion is needed.

### Existing Mount Infrastructure

Lace already has two mount systems:

1. **repoMounts** (`customizations.lace.repoMounts` in devcontainer.json): cross-repository mounts that lace clones and bind-mounts.
Handled by `mounts.ts` and `resolve-mounts.ts`.
Has its own override system in `settings.ts` via `RepoMountSettings` (`{ overrideMount: { source, readonly?, target? } }`).

2. **User-authored mounts** (top-level `mounts` array in devcontainer.json): static mounts passed through to Docker, currently using string format with `${localEnv:...}` variables.

Mount template variables introduce a third category: **lace-resolved mounts**, where the `source` field contains a `${lace.mount.source()}` expression that lace resolves to a concrete host path before generating `.lace/devcontainer.json`.
These coexist with the other two categories in the output `mounts` array.

> NOTE: The `RepoMountSettings` interface in `settings.ts` (line 19) already provides the shape needed for mount override configuration: `{ source: string, readonly?: boolean, target?: string }`.
> The mount template variable settings should be consistent with this pattern to reduce cognitive overhead.

### Prior Art and Constraints

- **Structured output proposal** (`2026-02-14-structured-devcontainer-output.md`): `status: rejected`.
Its `DevcontainerMount` type cannot be assumed to exist.
However, its research findings (archived in `2026-02-14-devcontainer-json-object-specifications.md`) remain valid: the Mount JSON schema has `additionalProperties: false` with only `{type, source, target}`, so readonly mounts must use string format.
- **Claude tools RFP** (`2026-02-06-rfp-claude-tools-lace-feature.md`): proposes `${lace.local.home}` and `${lace.container.username}` template variables.
Mount template variables subsume the mount-related aspects of that RFP.
- **Devcontainer feature mount spec**: features declare mounts as object-only (no string format), with `additionalProperties: false`.
Template variables in feature mount source fields would fail schema validation.
This eliminates Option C from the RFP's Section 6 analysis.

## Proposed Solution

### Architecture Overview

```
devcontainer.json                    settings.json
       │                                  │
       │  ${lace.mount.source(…)}         │  mounts overrides
       ▼                                  ▼
┌─────────────────────────────────────────────┐
│              template-resolver.ts            │
│                                              │
│  LACE_MOUNT_SOURCE_PATTERN ──► resolveMount │
│                      Source()               │
│                         │                    │
│                         ▼                    │
│              ┌──────────────────┐            │
│              │ MountPathResolver │            │
│              │                  │            │
│              │  1. settings     │            │
│              │     override?    │            │
│              │  2. default path │            │
│              │  3. mkdir -p     │            │
│              └──────────────────┘            │
│                         │                    │
│                         ▼                    │
│              resolved host path              │
└──────────────────────────────────────────────┘
       │
       ▼
.lace/devcontainer.json (concrete paths)
```

### Template Variable Syntax

Two template variable forms:

- `${lace.mount.source(namespace/label)}`: resolves to an absolute host path
- `${lace.mount.target(namespace/label)}`: resolves to a container path declared by a feature (Phase 3)

The `namespace/label` format mirrors the port system's `featureId/optionName` convention.
For project-level mounts (not tied to a feature), the reserved namespace `project` is used: `${lace.mount.source(project/bash-history)}`.

### MountPathResolver Class

`MountPathResolver` (new file: `packages/lace/src/lib/mount-resolver.ts`) is the analog to `PortAllocator`:

```typescript
export interface MountAssignment {
  label: string;
  resolvedSource: string;
  isOverride: boolean;
  assignedAt: string;
}

export interface MountAssignmentsFile {
  assignments: Record<string, MountAssignment>;
}

export class MountPathResolver {
  private assignments: Map<string, MountAssignment>;
  private persistPath: string;

  constructor(
    private workspaceFolder: string,
    private settings: LaceSettings,
  ) {
    this.persistPath = join(workspaceFolder, ".lace", "mount-assignments.json");
    this.load();
  }

  resolve(label: string): string { ... }
  save(): void { ... }
}
```

The `resolve()` method implements the two-tier lookup:

1. **Check settings override:** if `settings.mounts[label].source` exists, expand and resolve that path.
2. **Derive default path:** `~/.config/lace/<projectId>/mounts/<namespace>/<var>` where `projectId` comes from `deriveProjectId()` in `repo-clones.ts`.
3. **Auto-create:** call `mkdirSync(resolvedPath, { recursive: true })` for the default path.
Do not auto-create override paths (the user specified them; they should exist).

The resolver persists assignments to `.lace/mount-assignments.json` for inspection and debugging.
Unlike `PortAllocator`, there is no contention detection: path derivation is deterministic.

> NOTE: `MountPathResolver` diverges from `PortAllocator` in two intentional ways.
> First, the constructor takes `LaceSettings` as a parameter (the allocator does not need settings because port allocation has no override mechanism).
> Second, `resolve()` is synchronous (returns `string`), while `PortAllocator.allocate()` is async (returns `Promise<number>`) because port allocation requires TCP availability checking.
> Mount path derivation is purely deterministic, so the resolver needs neither async nor availability checks.
> Implementers should not cargo-cult the async pattern from the port system.

### Regex Patterns

New patterns added to `template-resolver.ts`, introduced incrementally across phases:

**Phase 2 (mount source resolution):**

```typescript
const LACE_MOUNT_SOURCE_PATTERN = /\$\{lace\.mount\.source\(([^)]+)\)\}/g;
```

**Phase 5 (mount target resolution):**

```typescript
const LACE_MOUNT_TARGET_PATTERN = /\$\{lace\.mount\.target\(([^)]+)\)\}/g;
```

The existing `LACE_UNKNOWN_PATTERN` must be relaxed in Phase 2 to permit both mount expression forms, even though target resolution is not implemented until Phase 5.
This ensures `${lace.mount.target()}` expressions pass through the guard without error during Phases 2-4 (they are left as literal strings until the target resolver is wired in Phase 5):

```typescript
// Before:
const LACE_UNKNOWN_PATTERN = /\$\{lace\.(?!port\()([^}]+)\}/;

// After (Phase 2):
const LACE_UNKNOWN_PATTERN = /\$\{lace\.(?!port\(|mount\.source\(|mount\.target\()([^}]+)\}/;
```

### Resolution in `resolveStringValue()`

Mount templates always resolve to strings (paths), so there is no type coercion branch.
The resolution order in `resolveStringValue()` becomes:

1. Check for unknown `${lace.*}` patterns (hard error)
2. Skip strings with no lace templates
3. Resolve `${lace.port()}` expressions (existing, with type coercion)
4. Resolve `${lace.mount.source()}` expressions (new, always string)
5. Resolve `${lace.mount.target()}` expressions (Phase 5, always string)

Mount source resolution does not need a `FULL_MATCH` integer coercion path: mounts are always strings.
No `LACE_MOUNT_SOURCE_FULL_MATCH` pattern is defined; one can be added later if standalone-expression validation becomes necessary.

### Settings Schema Extension

`LaceSettings` in `settings.ts` gains a `mounts` key:

```typescript
export interface LaceSettings {
  repoMounts?: {
    [repoId: string]: RepoMountSettings;
  };
  mounts?: {
    [label: string]: MountOverrideSettings;
  };
}

export interface MountOverrideSettings {
  /** Absolute or tilde-prefixed path to mount from the host */
  source: string;
}
```

Example `~/.config/lace/settings.json`:

```jsonc
{
  "mounts": {
    "project/bash-history": {
      "source": "~/code/dev_records/weft/bash/history"
    },
    "project/claude-config": {
      "source": "~/code/dev_records/weft/claude"
    }
  }
}
```

The override shape is intentionally minimal for Phase 1: just `source`.
The `RepoMountSettings` pattern includes `readonly` and `target` overrides, but mount template variables handle those properties at the mount declaration level, not the settings override level.

### Concrete Before/After

**Bash history mount:**

```jsonc
// Before:
"source=${localEnv:HOME}/code/dev_records/weft/bash/history,target=/commandhistory,type=bind"

// After:
"source=${lace.mount.source(project/bash-history)},target=/commandhistory,type=bind"
```

Without settings override, resolves to: `source=~/.config/lace/lace/mounts/project/bash-history`.
With the override `{ "project/bash-history": { "source": "~/code/dev_records/weft/bash/history" } }`, resolves to: `source=/home/mjr/code/dev_records/weft/bash/history`.

> NOTE: The doubled "lace" in `~/.config/lace/lace/mounts/...` is a cosmetic quirk of the lace project having `lace` as both the config directory name and the `deriveProjectId()` output.
> Other projects (e.g., `dotfiles`) would produce `~/.config/lace/dotfiles/mounts/...`.
> This is consistent with repo clone paths (`~/.config/lace/lace/repos/...`) and should not be "fixed" without also changing the repo clone convention.

**Claude config mount:**

```jsonc
// Before:
"source=${localEnv:HOME}/code/dev_records/weft/claude,target=/home/node/.claude,type=bind"

// After:
"source=${lace.mount.source(project/claude-config)},target=/home/node/.claude,type=bind"
```

Without settings override, resolves to: `source=~/.config/lace/lace/mounts/project/claude-config` (an empty directory, auto-created).
With the override `{ "project/claude-config": { "source": "~/code/dev_records/weft/claude" } }`, resolves to the existing directory.

**Excluded from scope:**

- SSH authorized keys (`source=${localEnv:HOME}/.ssh/lace_devcontainer.pub`): this is a single-file mount referencing an existing host file.
It is better handled by a feature option or left as a static mount.
Mount template variables target directory mounts with lace-managed defaults.
- WezTerm container config (`source=${localWorkspaceFolder}/.devcontainer/wezterm.lua`): this uses `${localWorkspaceFolder}`, a devcontainer variable for workspace-relative paths.
It references a file in the project tree, not user-specific state.
Mount template variables solve user-specific host path resolution; workspace-relative paths are already handled by devcontainer variables.

### Pipeline Integration

In `up.ts`, mount source template resolution fits into the existing pipeline after port template resolution (Phase 4) and before mount resolution (Phase 5):

```
Phase 1: Read config (readDevcontainerConfigMinimal)
Phase 2: Detect features, fetch metadata
Phase 3: Auto-inject port templates (autoInjectPortTemplates)
Phase 3b: Auto-inject mount templates (Phase 2 of this proposal)
Phase 4: Resolve all templates (resolveTemplates) ← mount.source resolved here
Phase 5: Resolve repo mounts (runResolveMounts)
Phase 6: Generate extended config (generateExtendedConfig)
Phase 7: devcontainer up
```

The `resolveTemplates()` function signature extends to accept an optional `MountPathResolver`:

```typescript
export async function resolveTemplates(
  config: Record<string, unknown>,
  portAllocator: PortAllocator,
  mountResolver?: MountPathResolver,
): Promise<TemplateResolutionResult>;
```

The parameter is optional so that existing callers and Phase 2 tests work without `up.ts` changes.
When `mountResolver` is `undefined`, any `${lace.mount.source()}` expression that passes the unknown-pattern guard is left as a literal string (no resolution, no error).
The resolver propagates through the internal call chain: `walkAndResolve()` and `resolveStringValue()` both gain the optional `mountResolver` parameter.

The `TemplateResolutionResult` gains a `mountAssignments` field alongside `allocations`.

## Important Design Decisions

### Decision: User-Authored Templates Have Implicit Consent

**Decision:** When a user writes `${lace.mount.source(project/foo)}` directly in their `devcontainer.json`, they have implicitly consented to whatever path lace resolves.
No additional consent mechanism is needed for project-level mounts.

**Why:** The user authored the template expression.
They chose to use lace mount resolution.
Adding a consent prompt on top of that would be redundant friction.
This parallels the port system: writing `${lace.port(wezterm-server/hostSshPort)}` does not require "do you consent to port allocation?"

The consent model from the RFP's Section 9 applies specifically to Phase 2 feature-declared mounts, where the feature (not the user) specifies what to mount.
This resolves the Section 3 vs. Section 9 contradiction identified in the review: Section 3's "default source" is an unconditional default for user-authored templates, while Section 9's consent applies to feature-declared mounts only.

### Decision: Feature Consent via Settings Configuration, Not Interactive Prompts

**Decision:** Feature-declared mounts (Phase 2) that reference non-managed host directories require explicit configuration in `settings.json`.
There are no interactive prompts during `lace up`.

**Why:** `lace up` is non-interactive: it generates config and runs `devcontainer up`.
Interactive consent prompts would break automation, CI, and unattended rebuilds.
Instead, features declare mount needs in `customizations.lace.mounts`, and lace resolves them to lace-managed default directories unless the user has explicitly configured an override in `settings.json`.
The override in `settings.json` is the consent signal: if the user configured `"claude-code/config": { "source": "~/.claude" }`, they have explicitly opted to expose that directory.

### Decision: Option B for Feature Mount Integration

**Decision:** Features declare mount metadata in `customizations.lace.mounts` (lace-specific metadata, not in the devcontainer spec's `mounts` array).
Lace generates actual mount entries in the top-level `mounts` array of `.lace/devcontainer.json`.

**Why:**
- Option A (template vars in feature options) couples mount path knowledge to feature install scripts, reducing lace's ability to manage mounts centrally.
- Option C (template vars in feature mount source fields) is non-viable: the devcontainer feature spec's `mounts` schema uses `additionalProperties: false`, and template variables in mount source fields would fail schema validation (per `cdocs/reports/2026-02-14-devcontainer-json-object-specifications.md`).
- Option B keeps mount orchestration in lace's resolution pipeline while features just declare "I need persistent storage at this container path."
The feature assumes the target path exists; lace ensures it does.

### Decision: `project/` Reserved Namespace

**Decision:** Project-level mounts (not associated with any feature) use the `project/` namespace prefix: `${lace.mount.source(project/bash-history)}`.

**Why:** This parallels the port system's `featureId/optionName` convention while providing a clear namespace for mounts that belong to the project config rather than a specific feature.
A bare label like `bash-history` would risk collisions with feature IDs.
Using the project name (e.g., `lace/bash-history`) conflates the project identifier with the namespace mechanism.
`project/` is unambiguous and self-documenting.

### Decision: Project ID from `deriveProjectId()`

**Decision:** The `<projectId>` segment in default mount paths uses `deriveProjectId()` from `repo-clones.ts` (line 28): workspace folder basename, lowercased, non-alphanumeric replaced with `-`.

**Why:** This function already exists and is used by the repoMounts system for clone paths (`~/.config/lace/<project>/repos/<name>`).
Using the same derivation ensures consistency: mount paths at `~/.config/lace/<project>/mounts/` live alongside repo clone paths at `~/.config/lace/<project>/repos/`.
The basename approach does risk collisions for projects with the same name in different directories, but the repoMounts system has the same limitation and it has not been a practical problem.

### Decision: Never Auto-Delete Mount Directories

**Decision:** When a mount template variable is removed from a devcontainer.json, lace does not delete the corresponding host directory.
Stale directories are left in place.

**Why:** Mount directories contain user data (bash history, config files, credentials).
Auto-deletion risks data loss.
The port system never reclaims freed ports; the same conservative approach applies to mounts.
A future `lace clean` command can list and optionally remove stale mount directories, but that is out of scope for this proposal.

### Decision: String-Format Output for All Resolved Mounts

**Decision:** Mount template variables produce string-format mount specs in the output `mounts` array, not JSON objects.

**Why:** The devcontainer Mount JSON schema (`additionalProperties: false`) only permits `{type, source, target}`.
Mounts with `readonly` cannot be expressed as objects.
String format supports all mount properties.
Since lace fully controls the resolved output, it can always produce well-formed strings.
This avoids the need for a `DevcontainerMount` intermediate representation (the structured output proposal that would have provided one is `status: rejected`).

## Stories

### Story 1: New Contributor Onboards

A new contributor clones the lace repo and runs `lace up`.
The devcontainer.json contains `${lace.mount.source(project/bash-history)}`.
The contributor has no `settings.json` mount overrides.
Lace resolves the mount source to `~/.config/lace/lace/mounts/project/bash-history`, auto-creates the directory, and generates a concrete mount string.
The container starts with an empty bash history directory.
The contributor can later configure a custom path in settings.json if they want to share history across projects.

### Story 2: Existing User Migrates

The original author already has bash history at `~/code/dev_records/weft/bash/history`.
They add a settings.json override:

```jsonc
{
  "mounts": {
    "project/bash-history": { "source": "~/code/dev_records/weft/bash/history" }
  }
}
```

The next `lace up` resolves the template to their existing directory.
No data migration needed.

### Story 3: Feature Declares a Mount (Phase 2)

A `claude-tools` feature's `devcontainer-feature.json` includes:

```jsonc
{
  "customizations": {
    "lace": {
      "mounts": {
        "config": {
          "target": "/home/${_REMOTE_USER}/.claude",
          "description": "Claude Code configuration and credentials"
        }
      }
    }
  }
}
```

During `lace up`, lace reads this declaration and auto-injects a mount entry:
`source=<resolved>,target=/home/node/.claude,type=bind`.
The `<resolved>` source comes from settings.json if configured, otherwise from the lace-managed default path `~/.config/lace/<project>/mounts/claude-tools/config`.

A user who wants their real `~/.claude` mounted adds to settings.json:

```jsonc
{
  "mounts": {
    "claude-tools/config": { "source": "~/.claude" }
  }
}
```

This settings entry is the consent signal: the user explicitly chose to expose `~/.claude`.

### Story 4: Cross-Feature Reference (Phase 3)

A `dotfiles` feature needs to know where claude config is mounted to symlink into it.
Instead of hardcoding `/home/node/.claude`, it references:

```jsonc
"CLAUDE_DIR": "${lace.mount.target(claude-tools/config)}"
```

Lace resolves this to the target path declared by the claude-tools feature.
If claude-tools changes its target path, dotfiles automatically follows.

## Edge Cases

### Missing Settings Override for Non-Managed Path

A mount template `${lace.mount.source(project/claude-config)}` resolves to a lace-managed default directory.
If the user expects `~/.claude` to be mounted but has not configured an override, they get an empty directory.
**Handling:** this is correct behavior.
Lace-managed defaults are intentionally empty.
Documentation and `lace status` output should make clear when mount sources are using defaults vs. overrides.

### Duplicate Mount Labels

Two mount entries reference `${lace.mount.source(project/bash-history)}` with different targets.
**Handling:** both resolve to the same host path.
This is valid: the same directory can be mounted at multiple container paths.
The resolver returns the same path for the same label deterministically.

### Override Path Does Not Exist

A settings override points to `~/nonexistent/path`.
**Handling:** lace does not auto-create override paths (the user specified them, so they should exist).
If the path does not exist, lace throws a hard error, consistent with the repoMounts system where `resolveOverrideRepoMount()` in `mounts.ts` throws `MountsError` for missing override sources.
The rationale for a hard error over a warning: the user explicitly configured this path, so a missing path is almost certainly a misconfiguration.
Silently proceeding would cause Docker to create a root-owned directory, which is a worse failure mode than stopping early with a clear message.

### Label Contains Invalid Characters

A label like `project/my mount` contains a space.
**Handling:** the label is used as a filesystem path segment in the default path derivation.
Labels must be validated: alphanumeric, hyphens, underscores, forward slashes (for namespace separator).
Invalid labels produce a hard error during template resolution.

```typescript
const MOUNT_LABEL_PATTERN = /^[a-z0-9_-]+\/[a-z0-9_-]+$/;
```

### Worktree Path Derivation

The lace devcontainer uses `workspaceMount` to mount the parent of the worktree.
`deriveProjectId()` uses the workspace folder basename.
If the workspace folder is `/workspace/main` (a worktree), the project ID is `main`, not `lace`.
**Handling:** `deriveProjectId()` operates on the host-side workspace folder (the path passed to `lace up`), not the container-side path.
The host-side path is `/var/home/mjr/code/weft/lace`, yielding project ID `lace`.
This is consistent with how repoMounts already derive project IDs.

### Interaction with `${localEnv:HOME}`

A mount string like `source=${lace.mount.source(project/foo)},target=${localEnv:HOME}/data` mixes lace templates with devcontainer variables.
**Handling:** lace resolves `${lace.mount.source()}` first (producing an absolute path), then passes the result to the devcontainer CLI, which resolves `${localEnv:HOME}`.
The two substitution passes do not interfere because lace resolves to absolute paths (no devcontainer variable references in the output).

## Test Plan

### Unit Tests: MountPathResolver

**File:** `packages/lace/src/lib/__tests__/mount-resolver.test.ts`

Following the pattern in `template-resolver.test.ts`:

1. **Default path derivation**: resolver with no settings returns `~/.config/lace/<projectId>/mounts/namespace/label` for a given label.
2. **Settings override**: resolver with `settings.mounts["project/foo"].source = "~/custom"` returns the expanded custom path.
3. **Auto-create default directory**: resolver creates the directory on the filesystem (verify with `existsSync`).
4. **No auto-create for overrides**: resolver with a settings override does not call `mkdirSync` for the override path.
5. **Override path missing**: resolver throws a hard error when override path does not exist (consistent with repoMounts).
6. **Persistence**: resolver saves assignments to `.lace/mount-assignments.json`, and a new resolver instance loads them.
7. **Label validation**: invalid labels (spaces, uppercase, missing namespace) throw descriptive errors.
8. **Project ID derivation**: verify `deriveProjectId()` is called with the workspace folder.
9. **Multiple resolves same label**: calling resolve twice with the same label returns the same path.

### Unit Tests: Template Resolution

**File:** extend `packages/lace/src/lib/__tests__/template-resolver.test.ts`

1. **LACE_UNKNOWN_PATTERN relaxation**: `${lace.mount.source(foo/bar)}` does not trigger the unknown pattern guard; `${lace.nonsense(foo)}` still does.
2. **Mount source resolution in string**: `"source=${lace.mount.source(project/history)},target=/history,type=bind"` resolves to `"source=/resolved/path,target=/history,type=bind"`.
3. **Mount source standalone**: `"${lace.mount.source(project/history)}"` resolves to the path string (not integer coercion).
4. **Mixed port and mount**: `"${lace.port(wezterm-server/hostSshPort)}:${lace.mount.source(project/foo)}"` resolves both.
5. **Mount source in nested config**: template expression inside `customizations.vscode.settings` or `containerEnv` resolves correctly.
6. **Mount source in mounts array**: template expression inside a mount string in the `mounts` array resolves correctly.
7. **No mount templates**: config with no `${lace.mount.*}` expressions passes through unchanged.
8. **Invalid mount label format**: `${lace.mount.source(noslash)}` throws with descriptive error.
9. **Unresolved target expression**: `${lace.mount.target(foo/bar)}` with no mount resolver (or no target resolver in Phases 2-4) passes through the unknown-pattern guard but is left as a literal string in the output.
This verifies the guard relaxation does not accidentally swallow target expressions before the target resolver exists.

### Unit Tests: Settings Extension

**File:** extend `packages/lace/src/lib/__tests__/settings.test.ts`

1. **Read mount overrides**: settings with `mounts` key parses correctly.
2. **Expand tilde in mount source**: `"~/custom"` expands to `$HOME/custom`.
3. **Empty mounts section**: `{ "mounts": {} }` is valid.
4. **Missing mounts section**: settings with only `repoMounts` has `mounts` as undefined.

### Integration Tests

**File:** `packages/lace/src/lib/__tests__/up.integration.test.ts` (extend existing)

1. **End-to-end mount source resolution**: devcontainer.json with `${lace.mount.source(project/data)}` mount, no settings: output `.lace/devcontainer.json` has concrete path, directory exists on disk, `.lace/mount-assignments.json` records the assignment.
2. **Settings override integration**: devcontainer.json + settings with mount override: output uses override path, no directory creation.
3. **Port + mount mixed config**: config with both `${lace.port()}` and `${lace.mount.source()}`: both resolve correctly, no interference.
4. **Mount resolution failure**: invalid mount label in config produces a clear error, non-zero exit code from `runUp()`.

### Test Fixtures

```jsonc
// fixtures/mount-basic/devcontainer.json
{
  "name": "Mount Test",
  "mounts": [
    "source=${lace.mount.source(project/data)},target=/data,type=bind"
  ]
}

// fixtures/mount-with-override/devcontainer.json
{
  "name": "Mount Override Test",
  "mounts": [
    "source=${lace.mount.source(project/data)},target=/data,type=bind"
  ]
}

// fixtures/mount-with-override/settings.json
{
  "mounts": {
    "project/data": { "source": "/tmp/test-mount-data" }
  }
}

// fixtures/mount-mixed/devcontainer.json
{
  "name": "Mixed Test",
  "appPort": ["${lace.port(test-feature/port)}:8080"],
  "mounts": [
    "source=${lace.mount.source(project/history)},target=/history,type=bind"
  ],
  "features": {
    "./test-feature": {}
  }
}
```

## Implementation Phases

### Phase 1: MountPathResolver and Settings Extension

**Goal:** implement the core mount path resolution class and settings infrastructure, independent of template resolution.

**Files to create:**
- `packages/lace/src/lib/mount-resolver.ts`: `MountPathResolver` class, `MountAssignment` and `MountAssignmentsFile` types, label validation
- `packages/lace/src/lib/__tests__/mount-resolver.test.ts`: full unit test suite for the resolver

**Files to modify:**
- `packages/lace/src/lib/settings.ts`: add `MountOverrideSettings` interface, extend `LaceSettings` with `mounts` key, expand paths in mount overrides (parallel to repoMounts path expansion at lines 111-118)
- `packages/lace/src/lib/__tests__/settings.test.ts`: add tests for mount override parsing

**Success criteria:**
- `MountPathResolver.resolve("project/foo")` returns `~/.config/lace/<projectId>/mounts/project/foo` when no settings override exists
- `MountPathResolver.resolve("project/foo")` returns the expanded override path when `settings.mounts["project/foo"].source` is set
- Default directories are auto-created; override directories are not
- Assignments persist to `.lace/mount-assignments.json`
- Invalid labels are rejected with descriptive errors
- All tests pass: `npx vitest run packages/lace/src/lib/__tests__/mount-resolver.test.ts`

**Constraints:**
- Do not modify `template-resolver.ts` in this phase
- Do not modify `up.ts` in this phase
- The resolver is a standalone module with no dependencies on template resolution

### Phase 2: Template Resolution Integration

**Goal:** wire `MountPathResolver` into the template resolution pipeline so `${lace.mount.source()}` expressions resolve in devcontainer.json.

**Files to modify:**
- `packages/lace/src/lib/template-resolver.ts`:
  - Add `LACE_MOUNT_SOURCE_PATTERN` constant
  - Relax `LACE_UNKNOWN_PATTERN` with negative lookahead for `mount\.source\(` and `mount\.target\(`
  - Extend `resolveStringValue()` to handle mount source templates after port resolution
  - Update the error message in the unknown-pattern guard (line 304) from "The only supported template is `${lace.port(...)}`" to list all supported templates
  - Extend `resolveTemplates()` signature to accept optional `MountPathResolver` (Phase 2 tests create their own resolver instance and pass it directly; `up.ts` is not modified until Phase 3)
  - Extend `TemplateResolutionResult` with `mountAssignments: MountAssignment[]`
  - Extend `walkAndResolve()` and `resolveStringValue()` to propagate the optional resolver through their parameter lists
- `packages/lace/src/lib/__tests__/template-resolver.test.ts`: add mount source resolution tests (pattern matching, string resolution, mixed port+mount, error cases)

**Success criteria:**
- `LACE_UNKNOWN_PATTERN` passes `${lace.mount.source(project/foo)}` but rejects `${lace.nonsense()}`
- `resolveStringValue()` replaces `${lace.mount.source(project/foo)}` with the resolved path
- `resolveTemplates()` with a config containing mount templates returns resolved config with concrete paths
- Mixed configs with both port and mount templates resolve correctly
- All existing template-resolver tests continue to pass
- New mount template tests pass

**Constraints:**
- Do not modify `up.ts` in this phase (resolver wiring happens in Phase 3)
- Port resolution behavior must not change (all existing tests remain green)
- Mount templates always resolve to strings; no type coercion

### Phase 3: Pipeline Wiring in `up.ts`

**Goal:** create `MountPathResolver` in `runUp()` and pass it to `resolveTemplates()`, completing the end-to-end flow.

**Files to modify:**
- `packages/lace/src/lib/up.ts`:
  - Import `MountPathResolver` and `loadSettings`
  - Create `MountPathResolver` before template resolution (after settings load, before `resolveTemplates()`)
  - Pass resolver to `resolveTemplates()`
  - Call `mountResolver.save()` after resolution
  - Add phase reporting for mount assignments
- `packages/lace/src/lib/__tests__/up.integration.test.ts`: add end-to-end integration tests (mount resolution with/without settings, mixed port+mount, error propagation)

**Success criteria:**
- `lace up` with a devcontainer.json containing `${lace.mount.source(project/data)}` generates `.lace/devcontainer.json` with a concrete path
- `.lace/mount-assignments.json` is written with the assignment record
- The default mount directory exists on disk after `lace up`
- Settings overrides are respected
- All existing `up.integration.test.ts` tests pass
- New integration tests pass
- Full test suite green: `npx vitest run`

**Constraints:**
- Minimize changes to the `runUp()` function: add resolver creation and passing, do not restructure the pipeline
- Settings are loaded once and shared between mount resolution and repo mount resolution.
Currently `runResolveMounts()` loads settings internally via its own call to `loadSettings()`.
Phase 3 should hoist the `loadSettings()` call to `runUp()` level so the result can be passed to both `MountPathResolver` and `runResolveMounts()`.
This requires adding a `settings` parameter to `runResolveMounts()` (or its options interface) to avoid double-loading.

### Phase 4: Feature Mount Declarations (Phase 2 of Rollout)

**Goal:** enable features to declare mount needs via `customizations.lace.mounts` and have lace auto-inject mount entries.

**Files to modify:**
- `packages/lace/src/lib/feature-metadata.ts`:
  - Extend `LaceCustomizations` with `mounts?: Record<string, LaceMountDeclaration>`
  - Add `LaceMountDeclaration` interface: `{ target: string, description?: string, readonly?: boolean }`
  - Extend `extractLaceCustomizations()` to parse and validate mount declarations
- `packages/lace/src/lib/template-resolver.ts`:
  - Add `autoInjectMountTemplates()` function (analog to `autoInjectPortTemplates()`)
  - Feature mounts inject entries into the config's `mounts` array as template-bearing strings
- `packages/lace/src/lib/up.ts`: call `autoInjectMountTemplates()` before `resolveTemplates()`
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts`: mount declaration parsing tests
- `packages/lace/src/lib/__tests__/template-resolver.test.ts`: mount auto-injection tests

**Success criteria:**
- Feature metadata with `customizations.lace.mounts.config = { target: "/home/node/.claude" }` produces a mount entry in the output config
- Settings override for `featureId/mountName` replaces the auto-derived source
- Without settings override, mount source defaults to lace-managed path
- Mount declarations with invalid shapes are rejected with descriptive errors
- All tests pass

**Constraints:**
- Feature self-sufficiency: features assume the target path exists, they do not need conditional logic
- No interactive prompts: settings.json is the consent mechanism

### Phase 5: `${lace.mount.target()}` Resolution (Phase 3 of Rollout)

**Goal:** enable `${lace.mount.target(namespace/label)}` to resolve to the container target path declared by a feature's mount metadata.

**Files to modify:**
- `packages/lace/src/lib/template-resolver.ts`:
  - Relax `LACE_UNKNOWN_PATTERN` for `mount\.target\(`
  - Extend `resolveStringValue()` to handle `${lace.mount.target()}` expressions
  - Target resolution reads from a feature mount declaration map (built from metadata)
- `packages/lace/src/lib/__tests__/template-resolver.test.ts`: target resolution tests

**Success criteria:**
- `${lace.mount.target(claude-code/config)}` resolves to `/home/node/.claude` (the target declared by the claude-code feature)
- Referencing a non-existent mount label produces a descriptive error
- Target templates in `containerEnv`, lifecycle commands, and other config sections resolve correctly
- All tests pass

**Constraints:**
- Target resolution depends on feature metadata being available (fetched in Phase 2 of the pipeline)
- Target resolution is read-only: it does not create directories or modify mounts

### Phase 6: Migrate Lace Devcontainer

**Goal:** apply mount template variables to lace's own `.devcontainer/devcontainer.json`, replacing the hardcoded mounts.

**Files to modify:**
- `.devcontainer/devcontainer.json`: replace mounts[0] and mounts[1] with template variables
- Documentation: update `docs/` if any references to mount setup exist

**Success criteria:**
- Mounts[0] (bash history) uses `${lace.mount.source(project/bash-history)}`
- Mounts[1] (claude config) uses `${lace.mount.source(project/claude-config)}`
- Mounts[2] (SSH key) and mounts[3] (wezterm config) remain as-is (excluded from scope)
- `lace up` succeeds with the updated config
- Existing settings.json with overrides for the original paths continue to work

**Constraints:**
- This is a migration of the reference config, not a feature change
- Test by running `lace up` in the lace devcontainer itself

## Open Questions

1. **File mounts vs. directory mounts**: the current devcontainer.json has both file mounts (SSH key) and directory mounts (bash history).
Mount template variables target directory mounts with auto-creation semantics.
Should file mounts ever be supported, or are they permanently out of scope?
For now, file mounts are excluded; they can be revisited if a motivating use case emerges.

2. **Should mount template variables eventually subsume repoMounts?**
RepoMounts have clone/update lifecycle, conflict detection, and symlink generation that generic mounts do not.
The generalization is theoretically possible but premature.
For now, the two systems coexist independently with consistent settings patterns.

3. **Cleanup semantics**: stale mount directories are never auto-deleted (per design decision above).
A future `lace clean` command could list and optionally remove orphaned mount directories under `~/.config/lace/<project>/mounts/`.
This is out of scope for the current proposal.

4. **Multi-project mount sharing**: two projects both declaring `${lace.mount.source(project/bash-history)}` get isolated directories (different `<projectId>` segments).
Should there be a mechanism for sharing mount sources across projects?
This could be achieved via settings overrides pointing both projects to the same directory, but a first-class mechanism is not proposed here.
