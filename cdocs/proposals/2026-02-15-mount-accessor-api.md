---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T12:00:00-08:00
task_list: lace/template-variables
type: proposal
state: live
status: review_ready
tags: [mount-resolver, template-variables, settings, api-design, auto-injection, validation]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-15T18:30:00-08:00
  round: 3
related_to:
  - cdocs/proposals/2026-02-14-mount-template-variables.md
  - cdocs/reports/2026-02-15-mount-api-design-rationale.md
  - cdocs/devlogs/2026-02-15-mount-api-evolution.md
  - cdocs/reports/2026-02-14-devcontainer-json-object-specifications.md
---

# Mount Accessor API (v2)

> BLUF: Rework the mount template system from separate `${lace.mount.source()}` / `${lace.mount.target()}` functions to a unified `${lace.mount(ns/label)}` with `.source` and `.target` property accessors. Mount declarations move into `customizations.lace.mounts` metadata (both feature-level and project-level), mirroring the port system's auto-injection model. The `MountPathResolver` evolves to accept declarations and produce complete mount spec strings. Namespace validation, target conflict detection, and guided configuration with `recommendedSource` fields improve safety and onboarding UX. This reworks the existing v1 implementation on the `mountvars` branch before merging to main.
>
> - **Evolves:** `cdocs/proposals/2026-02-14-mount-template-variables.md` (v1, `status: evolved`)
> - **Design rationale:** `cdocs/reports/2026-02-15-mount-api-design-rationale.md`
> - **Key source files:** `template-resolver.ts`, `mount-resolver.ts`, `feature-metadata.ts`, `settings.ts`, `up.ts`

## Objective

Enable devcontainer configs and features to declare mount points using template variables that lace resolves to concrete host and container paths, with sensible defaults, user-overridable source configuration, and validation. The v2 API addresses shortcomings identified in the v1 implementation:

1. **Single entrypoint**: One template function (`lace.mount()`) with property accessors, not separate `mount.source()` and `mount.target()` functions.
2. **Mount declarations as metadata**: Features and the devcontainer itself declare mount needs in `customizations.lace.mounts`. Lace composes declarations + user settings into complete mount specs.
3. **Validation**: Namespace must be `project` or a known feature ID. No two declarations may share a container target. Missing declarations fail loudly.
4. **Guided configuration**: When mounts use default paths, emit actionable guidance including `recommendedSource` suggestions.

## Background

### v1 Implementation (on `mountvars`, not merged)

The v1 system introduced `${lace.mount.source(ns/label)}` and `${lace.mount.target(ns/label)}` with a `MountPathResolver` class and feature mount declarations in `customizations.lace.mounts`. Key artifacts: `mount-resolver.ts`, extensions to `template-resolver.ts`, `feature-metadata.ts`, `settings.ts`, and `up.ts`. 555 tests passing. See `cdocs/proposals/2026-02-14-mount-template-variables.md` for the full v1 design.

### What Changes

The v1 infrastructure is solid but the API surface and mount construction model change:

| Aspect | v1 | v2 |
|--------|----|----|
| Template syntax | `${lace.mount.source(ns/label)}` | `${lace.mount(ns/label).source}` |
| Mount construction | User assembles `source=X,target=Y,type=bind` | Lace produces complete spec from declaration |
| Project-level declarations | Implicit (any `project/` label) | Explicit in `customizations.lace.mounts` |
| Namespace validation | Label format only | Must be `project` or known feature ID |
| Target conflict detection | None | Cross-declaration target uniqueness check |
| Guided configuration | None | `recommendedSource` + actionable settings.json snippet |
| `LACE_UNKNOWN_PATTERN` | `mount\.source\(` + `mount\.target\(` lookaheads | Single `mount\(` lookahead |

## Proposed Solution

### API Design

Three accessor forms, one entrypoint:

| Form | Resolves to | Primary use case |
|------|-------------|------------------|
| `${lace.mount(ns/label)}` | Full mount spec string | `mounts` array entries |
| `${lace.mount(ns/label).source}` | Absolute host path | Debugging, rare manual construction |
| `${lace.mount(ns/label).target}` | Container target path | `containerEnv`, lifecycle commands, cross-feature refs |

Regex patterns in `template-resolver.ts`:

```typescript
// Match order: more specific patterns first
const LACE_MOUNT_TARGET_PATTERN = /\$\{lace\.mount\(([^)]+)\)\.target\}/g;
const LACE_MOUNT_SOURCE_PATTERN = /\$\{lace\.mount\(([^)]+)\)\.source\}/g;
const LACE_MOUNT_PATTERN = /\$\{lace\.mount\(([^)]+)\)\}/g;

// Guard: rejects any ${lace.*} that isn't port() or mount()
const LACE_UNKNOWN_PATTERN = /\$\{lace\.(?!port\(|mount\()([^}]+)\}/;
```

> NOTE: The v1 `${lace.mount.source()}` syntax starts with `mount.` (dot, not paren), so it fails the `mount\(` lookahead and is correctly rejected as unknown. Stale v1 references fail loudly.

Resolution semantics:

- **Bare form** (`${lace.mount(ns/label)}`): Produces `source=<host_path>,target=<container_path>,type=<type>[,readonly][,consistency=<val>]` from declaration metadata + settings/default source.
- **`.source`** (`${lace.mount(ns/label).source}`): Produces the resolved host path only (settings override → default derivation, same as v1 `MountPathResolver.resolve()`).
- **`.target`** (`${lace.mount(ns/label).target}`): Returns the `target` field from the declaration. No filesystem access.

### Mount Declaration Schema

```typescript
export interface LaceMountDeclaration {
  /** Container target path (required) */
  target: string;
  /** Suggested host source path, surfaced in config guidance (never used as actual source) */
  recommendedSource?: string;
  /** Human-readable description */
  description?: string;
  /** Whether the mount should be read-only (default: false) */
  readonly?: boolean;
  /** Docker mount type (default: "bind") */
  type?: string;
  /** Docker mount consistency hint (e.g., "delegated", "cached") */
  consistency?: string;
}
```

Declarations appear in two locations:

**Feature metadata** (`devcontainer-feature.json`):
```jsonc
{
  "customizations": {
    "lace": {
      "mounts": {
        "config": {
          "target": "/home/node/.claude",
          "recommendedSource": "~/.claude",
          "description": "Claude Code configuration and credentials"
        }
      }
    }
  }
}
```
Namespace for feature mounts: feature shortId (e.g., `claude-code/config`).

**Project config** (`devcontainer.json`):
```jsonc
{
  "customizations": {
    "lace": {
      "mounts": {
        "bash-history": {
          "target": "/commandhistory",
          "description": "Bash command history persistence"
        },
        "claude-config": {
          "target": "/home/node/.claude",
          "recommendedSource": "~/.claude",
          "description": "Claude Code configuration and credentials"
        }
      }
    }
  }
}
```
Namespace for project mounts: `project` (reserved).

### MountPathResolver Evolution

The resolver accepts the full declaration map and produces all three resolution forms:

```typescript
export class MountPathResolver {
  constructor(
    workspaceFolder: string,
    settings: LaceSettings,
    declarations: Record<string, LaceMountDeclaration>,
  )

  /** Resolve host source path (settings override → default derivation). */
  resolveSource(label: string): string

  /** Return container target path from declaration. */
  resolveTarget(label: string): string

  /** Produce complete mount spec string from declaration + resolved source. */
  resolveFullSpec(label: string): string

  /** Get all assignments for persistence/reporting. */
  getAssignments(): MountAssignment[]

  /** Persist assignments to .lace/mount-assignments.json. */
  save(): void
}
```

`resolveSource()` preserves the v1 two-tier lookup, with an added declaration check:
1. Validate label exists in declarations (hard error if not)
2. Check `settings.mounts[label].source` → expand tilde, verify exists (hard error if missing)
3. Derive default: `~/.config/lace/<projectId>/mounts/<ns>/<var>`, auto-create via `mkdirSync`

`resolveTarget()` returns `declarations[label].target`. Throws if label not in declarations.

Both `resolveSource()` and `resolveTarget()` check declaration existence before proceeding.

`resolveFullSpec()` builds:
```
source=<resolveSource()>,target=<resolveTarget()>,type=<decl.type ?? "bind">[,readonly][,consistency=<decl.consistency>]
```
The `readonly` flag is a standalone keyword (not `readonly=true`), matching Docker mount string format.

### Auto-Injection

Follows the port auto-injection pattern established in `autoInjectPortTemplates()`:

1. Collect all mount declarations:
   - Project-level: `extractProjectMountDeclarations(config)` → declarations from `customizations.lace.mounts` in the devcontainer config
   - Feature-level: `extractLaceCustomizations(metadata).mounts` for each feature → declarations prefixed with feature shortId
   - Prebuild feature-level: same extraction as regular features — mounts are runtime config (`docker run` flags), so there is no build/runtime lifecycle asymmetry as there is with ports
2. For each declaration label, scan the mounts array for any string containing `${lace.mount(<label>)}`, `${lace.mount(<label>).source}`, or `${lace.mount(<label>).target}`
3. If no reference found, append `${lace.mount(ns/label)}` to the mounts array
4. Template resolution expands all mount templates in the final pass

The function `autoInjectMountTemplates()` is reworked from v1 to:
- Accept both project and feature declarations
- Generate bare `${lace.mount()}` entries (not v1's manual `source=...,target=...,type=bind` strings)
- Check for existing references in any accessor form before injecting

### Validation

Performed in `up.ts` before template resolution:

1. **Namespace validation**: Each declaration's label prefix must be `project` (for project-level) or match a feature shortId in the config. Unknown namespaces produce a hard error listing available namespaces.

2. **Target conflict detection**: Build a `Map<targetPath, label>` from all declarations. If two labels declare the same container target, hard error: `"Mount target conflict: '/home/node/.claude' declared by both 'project/claude-config' and 'claude-code/config'"`.

3. **Declaration existence**: During template resolution, any `${lace.mount(label)}` where `label` is not in the declarations map produces a hard error listing available labels.

### Guided Configuration UX

When mounts resolve to default paths (no settings override), emit actionable guidance after resolution:

```
Mount configuration:
  project/claude-config: using default path ~/.config/lace/lace/mounts/project/claude-config
    → Recommended: configure source to ~/.claude in settings.json
  project/bash-history: using default path ~/.config/lace/lace/mounts/project/bash-history

To configure custom mount sources, add to ~/.config/lace/settings.json:
{
  "mounts": {
    "project/claude-config": { "source": "~/.claude" }
  }
}
```

Guidance is informational (`console.log`), not a warning or error. It appears only when:
- At least one mount resolved to a default path (not an override)
- The declaration has a `recommendedSource` field (for the specific recommendation line)

Mounts with settings overrides are reported normally: `project/claude-config: /home/user/.claude (override)`.

### Settings Schema

No changes to `LaceSettings` or `MountOverrideSettings` interfaces from v1. Settings shape:

```jsonc
// ~/.config/lace/settings.json
{
  "mounts": {
    "project/claude-config": { "source": "~/.claude" },
    "project/bash-history": { "source": "~/code/dev_records/weft/bash/history" }
  }
}
```

## Design Decisions

Brief summaries; detailed rationale in `cdocs/reports/2026-02-15-mount-api-design-rationale.md`.

### Accessor syntax over separate entrypoints

**Decision**: `${lace.mount(label).source}` not `${lace.mount.source(label)}`.
**Why**: One concept with properties, not three separate functions. Matches how developers think about mounts. Simplifies the unknown-pattern guard.

### `recommendedSource` as guidance, not default

**Decision**: Declarations suggest a source path; the actual source is always user-configured or lace-managed default.
**Why**: Features cannot opaquely mount host directories. The user must explicitly configure source paths in settings.json. See report for full security model.

### `project/` as reserved namespace

**Decision**: Project-level mounts use `project/` prefix, declared in the devcontainer's own `customizations.lace.mounts`.
**Why**: Unambiguous, self-documenting, no collision risk with feature IDs.

### Hard errors for validation failures

**Decision**: Unknown namespaces, target conflicts, and missing declarations produce hard errors, not warnings.
**Why**: These are config errors that cause subtle runtime failures (Docker mount conflicts, missing data). Failing fast with clear messages is better than debugging container issues.

### String-format output

**Decision**: Resolved mounts are always string-format (`source=X,target=Y,...`), never JSON objects.
**Why**: The devcontainer Mount JSON schema has `additionalProperties: false` and can't express `readonly`. String format supports all mount properties.

## Concrete Before/After

### devcontainer.json (source config)

**Before (v1 on `mountvars`):**
```jsonc
{
  "customizations": {
    "lace": {
      "prebuildFeatures": { /* ... */ }
    }
  },
  "mounts": [
    "source=${lace.mount.source(project/bash-history)},target=/commandhistory,type=bind",
    "source=${lace.mount.source(project/claude-config)},target=/home/node/.claude,type=bind",
    "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly",
    "source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly"
  ],
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "/home/node/.claude"
  }
}
```

**After (v2):**
```jsonc
{
  "customizations": {
    "lace": {
      "mounts": {
        "bash-history": {
          "target": "/commandhistory",
          "description": "Bash command history persistence"
        },
        "claude-config": {
          "target": "/home/node/.claude",
          "recommendedSource": "~/.claude",
          "description": "Claude Code configuration and credentials"
        }
      },
      "prebuildFeatures": { /* ... */ }
    }
  },
  "mounts": [
    // Static mounts not managed by lace:
    "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly",
    "source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly"
    // project/bash-history and project/claude-config are auto-injected from declarations above
  ],
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "${lace.mount(project/claude-config).target}"
  }
}
```

### Resolved .lace/devcontainer.json (output)

```jsonc
{
  "mounts": [
    "source=/home/mjr/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly",
    "source=/var/home/mjr/code/weft/lace/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly",
    "source=/home/mjr/.config/lace/lace/mounts/project/bash-history,target=/commandhistory,type=bind",
    "source=/home/mjr/.claude,target=/home/node/.claude,type=bind"
  ],
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "/home/node/.claude"
  }
}
```

(Assuming `settings.json` has `"project/claude-config": { "source": "~/.claude" }` but no override for `bash-history`.)

### Feature mount example (hypothetical claude-code feature)

```jsonc
// devcontainer-feature.json
{
  "id": "claude-code",
  "customizations": {
    "lace": {
      "mounts": {
        "config": {
          "target": "/home/node/.claude",
          "recommendedSource": "~/.claude",
          "description": "Claude Code configuration and credentials"
        }
      }
    }
  }
}
```

If this feature is in the devcontainer's `features` block, lace auto-injects `${lace.mount(claude-code/config)}` into the mounts array. The user configures:
```jsonc
// settings.json
{ "mounts": { "claude-code/config": { "source": "~/.claude" } } }
```

## Stories

### Story 1: New Contributor Onboards

A new contributor clones the repo and runs `lace up`. The devcontainer declares `project/bash-history` and `project/claude-config` mounts. The contributor has no `settings.json`. Lace resolves both to default paths under `~/.config/lace/<project>/mounts/`, auto-creates the directories, and emits guidance: "Recommended: configure source to ~/.claude in settings.json." The container starts with empty but functional mount directories.

### Story 2: Existing User Migrates from v1

The user already has v1 settings overrides. Since the `MountOverrideSettings` schema is unchanged (`{ source: string }`), existing settings.json entries continue to work. They update their devcontainer.json to v2 syntax (add `customizations.lace.mounts`, use auto-injection). Next `lace up` resolves correctly using their existing overrides.

### Story 3: Feature Declares a Mount

A `claude-code` feature declares `customizations.lace.mounts.config = { target: "/home/node/.claude", recommendedSource: "~/.claude" }`. During `lace up`, lace reads this declaration, auto-injects a mount entry, and resolves it. Without user settings, the mount source is a lace-managed default (empty). With settings, it's the user's configured path. The guided config message includes the `recommendedSource` suggestion.

### Story 4: Cross-Feature Target Reference

A dotfiles feature needs to know where claude config is mounted. Its lifecycle command uses `${lace.mount(claude-code/config).target}`, which resolves to `/home/node/.claude`. If the claude-code feature changes its target, the reference follows automatically.

### Story 5: containerEnv Stays in Sync

The devcontainer uses `"CLAUDE_CONFIG_DIR": "${lace.mount(project/claude-config).target}"`. The `.target` accessor resolves to the same path declared in `customizations.lace.mounts.claude-config.target`. If the declaration target changes, the env var follows automatically.

## Edge Cases

### Target conflict across declarations

Two declarations (e.g., `project/claude-config` and `claude-code/config`) both declare `target: "/home/node/.claude"`. **Handling**: Hard error at validation, before resolution. Lists both labels and the conflicting target.

### Override path does not exist

User configures `"project/foo": { "source": "~/nonexistent" }`. **Handling**: Hard error from `resolveSource()`, consistent with v1 and repoMounts. "Mount override source does not exist: ~/nonexistent. Create the directory or remove the override."

### Mount referenced in template but no declaration

Config contains `${lace.mount(project/unknown)}` but no declaration for `project/unknown`. **Handling**: Hard error during resolution. "Mount label 'project/unknown' not found in declarations. Available: project/bash-history, project/claude-config."

### Auto-injection + explicit override

Declaration exists for `project/foo`. User also writes `${lace.mount(project/foo)}` explicitly in the mounts array. **Handling**: Auto-injection detects the existing reference and skips injection. The user's explicit entry controls placement and ordering.

### `.source` accessor used outside mounts array

`"MY_VAR": "${lace.mount(project/foo).source}"` in `containerEnv`. **Handling**: Valid. Resolves to the host path. This is the intended use case for the `.source` accessor.

### Bare `${lace.mount()}` used outside mounts array

`"MY_VAR": "${lace.mount(project/foo)}"` in `containerEnv`. **Handling**: Valid but probably unintended — resolves to a full mount spec string (`source=X,target=Y,type=bind`). No error; the resolver doesn't know the JSON context. Documented as "bare form is intended for the mounts array."

### Prebuild features with mount declarations

A prebuild feature declares mounts. **Handling**: Prebuild feature mounts are auto-injected identically to regular feature mounts. Unlike ports — where prebuild features require asymmetric `appPort` injection because the port is baked into the image at build time — mounts are runtime config (`docker run` flags). A mount entry in the `mounts` array takes effect when the container starts, regardless of whether the feature was installed during prebuild or at runtime. Prebuild feature mount declarations are included in the unified declarations map and participate in auto-injection, validation, and resolution like any other mount.

### Invalid label format

`${lace.mount(Bad Label!)}` — contains spaces and uppercase. **Handling**: Label validation rejects it. Same `LABEL_PATTERN` as v1: `/^[a-z0-9_-]+\/[a-z0-9_-]+$/`.

### Mixed lace templates and devcontainer variables

`"source=${lace.mount(project/foo).source},target=${localEnv:HOME}/data"` — mixed substitution. **Handling**: Lace resolves its template first (absolute path output), then the devcontainer CLI resolves `${localEnv:HOME}`. No interference.

## Implementation Phases

### Phase 1: Declaration Schema + MountPathResolver Rework

**Goal**: Extend `LaceMountDeclaration` with new fields, add project-level declaration extraction, rework `MountPathResolver` to accept declarations and produce full mount specs.

**Files to modify:**

- `packages/lace/src/lib/feature-metadata.ts`:
  - Add `recommendedSource`, `type`, `consistency` to `LaceMountDeclaration` interface
  - Update `extractLaceCustomizations()` to parse new fields from mount entries

- `packages/lace/src/lib/mount-resolver.ts`:
  - Change constructor to accept `declarations: Record<string, LaceMountDeclaration>`
  - Add `resolveTarget(label)`: returns `declarations[label].target`
  - Add `resolveFullSpec(label)`: builds complete mount spec string
  - Rename `resolve(label)` to `resolveSource(label)` for clarity
  - Add `validateLabel()` check that label exists in declarations (in addition to format check)

- `packages/lace/src/lib/feature-metadata.ts`:
  - Extract a shared `parseMountDeclarationEntry(key, value)` helper from the mount-parsing loop in `extractLaceCustomizations()` (lines 610-626). This helper validates a single raw entry and returns `LaceMountDeclaration | null`. Both `extractLaceCustomizations()` and the new `extractProjectMountDeclarations()` call this shared helper, avoiding duplicated validation logic.

- `packages/lace/src/lib/template-resolver.ts`:
  - Add `extractProjectMountDeclarations(config)`: reads `customizations.lace.mounts` from the devcontainer config, delegates per-entry validation to the shared `parseMountDeclarationEntry()` from `feature-metadata.ts`, returns `Record<string, LaceMountDeclaration>`
  - This function is the project-level analog to feature-level `extractLaceCustomizations(metadata).mounts`

- `packages/lace/src/lib/__tests__/mount-resolver.test.ts` (rework):
  - Test `resolveSource()` with/without settings override (preserved from v1)
  - Test `resolveTarget()` returns declaration target
  - Test `resolveFullSpec()` assembles correct mount string with all field combinations (`readonly`, `type`, `consistency`)
  - Test label-not-in-declarations error
  - Test persistence (unchanged from v1)

- `packages/lace/src/lib/__tests__/feature-metadata.test.ts` (extend):
  - Test `recommendedSource`, `type`, `consistency` parsing
  - Test invalid values ignored gracefully (non-string `recommendedSource`, etc.)

**Success criteria:**
- `resolveFullSpec("project/foo")` returns `source=<path>,target=/bar,type=bind` for declaration `{ target: "/bar" }`
- `resolveFullSpec("project/foo")` includes `,readonly` when declaration has `readonly: true`
- `resolveTarget("project/foo")` returns `/bar` for declaration `{ target: "/bar" }`
- Label not in declarations throws descriptive error
- All existing v1 tests reworked and passing: `npx vitest run packages/lace/src/lib/__tests__/mount-resolver.test.ts`

**Constraints:**
- Do not modify `up.ts` in this phase
- Template patterns not yet changed (that's Phase 2)
- Settings schema unchanged (`MountOverrideSettings` is fine as-is)

### Phase 2: Template Patterns + Resolution Rework

**Goal**: Replace v1 regex patterns with accessor-syntax patterns, rework `resolveStringValue()` for all three forms.

**Files to modify:**

- `packages/lace/src/lib/template-resolver.ts`:
  - Replace `LACE_MOUNT_SOURCE_PATTERN` with accessor form: `/\$\{lace\.mount\(([^)]+)\)\.source\}/g`
  - Replace `LACE_MOUNT_TARGET_PATTERN` with accessor form: `/\$\{lace\.mount\(([^)]+)\)\.target\}/g`
  - Add `LACE_MOUNT_PATTERN`: `/\$\{lace\.mount\(([^)]+)\)\}/g` (bare form)
  - Simplify `LACE_UNKNOWN_PATTERN` to `/\$\{lace\.(?!port\(|mount\()([^}]+)\}/`
  - Rework `resolveStringValue()`:
    1. Unknown pattern check (existing)
    2. Skip if no lace templates (check all 5 patterns)
    3. Port resolution (existing)
    4. Mount `.target` resolution (accessor form, via `resolver.resolveTarget()` if resolver has declarations, else fall back to `mountTargetMap`)
    5. Mount `.source` resolution (accessor form, via `resolver.resolveSource()`)
    6. Mount bare resolution (full spec, via `resolver.resolveFullSpec()`)
    - Match order matters: `.target` and `.source` before bare, to avoid bare matching a prefix of accessor forms
  - Keep `mountTargetMap` parameter in `resolveTemplates()` signature for now (Phase 4 removes it when `up.ts` is updated). Target resolution prefers `resolver.resolveTarget()` when the resolver has declarations, falls back to `mountTargetMap` for backwards compatibility during the phased rework.
  - `buildMountTargetMap()` is retained until Phase 4 removes it alongside the `mountTargetMap` parameter

- `packages/lace/src/lib/__tests__/template-resolver.test.ts` (rework mount tests):
  - `LACE_UNKNOWN_PATTERN`: passes `${lace.mount(foo/bar)}`, `${lace.mount(foo/bar).source}`, `${lace.mount(foo/bar).target}`; rejects `${lace.mount.source(foo/bar)}` (v1 syntax), `${lace.nonsense()}`
  - Bare form in mounts array: `"${lace.mount(project/data)}"` → `"source=/resolved,target=/data,type=bind"`
  - `.source` accessor: `"${lace.mount(project/data).source}"` → `"/resolved/path"`
  - `.target` accessor: `"${lace.mount(project/data).target}"` → `"/data"`
  - `.target` in `containerEnv`: `"MYDIR": "${lace.mount(project/data).target}"` → `"MYDIR": "/data"`
  - Mixed port + mount: both resolve correctly
  - Mount label not in declarations: descriptive error
  - No mount templates: config passes through unchanged
  - All existing port tests remain green

**Success criteria:**
- v1 syntax `${lace.mount.source(foo)}` is rejected by unknown pattern guard
- All three accessor forms resolve correctly
- Resolution order handles accessor/bare disambiguation
- Port resolution unaffected
- Full test suite green: `npx vitest run packages/lace/src/lib/__tests__/template-resolver.test.ts`

**Constraints:**
- Do not modify `up.ts` in this phase
- Port resolution behavior must not change
- The `resolveTemplates()` signature retains `mountTargetMap` for compilation compatibility; Phase 4 removes it when `up.ts` is updated
- Each phase must compile independently (`npx tsc --noEmit`)

### Phase 3: Auto-Injection Rework

**Goal**: Rework `autoInjectMountTemplates()` to handle both project-level and feature-level declarations, inject bare `${lace.mount()}` entries, and detect existing references in any accessor form.

**Files to modify:**

- `packages/lace/src/lib/template-resolver.ts`:
  - Rework `autoInjectMountTemplates()`:
    - Accept `projectDeclarations: Record<string, LaceMountDeclaration>` (from `extractProjectMountDeclarations()`)
    - Accept `metadataMap` (for feature declarations — both regular and prebuild features)
    - Build unified label → declaration map (project: `project/<key>`, feature: `<shortId>/<key>`, prebuild feature: `<shortId>/<key>`)
    - Process both `config.features` and prebuild features from `extractPrebuildFeaturesRaw(config)` for injection. Mounts are runtime config (`docker run` flags), so there is no build/runtime asymmetry — prebuild feature mounts are injected identically to regular feature mounts.
    - For each declaration, scan mounts array for any reference to the label in any form (`${lace.mount(label)}`, `.source`, `.target`)
    - If no reference found, append `${lace.mount(ns/label)}` to mounts array
    - Return type: `{ injected: string[], declarations: Record<string, LaceMountDeclaration> }` — the unified declarations map is consumed by Phase 4 for `MountPathResolver` construction
  - Add `buildMountDeclarationsMap()`: combines project + feature + prebuild feature declarations into a single `Record<string, LaceMountDeclaration>`. Prebuild feature mounts are included in both the declarations map and auto-injection (mounts are runtime config, no build/runtime asymmetry)

- `packages/lace/src/lib/__tests__/template-resolver.test.ts` (rework auto-injection tests):
  - Project declarations auto-inject: config with `customizations.lace.mounts.foo = { target: "/bar" }` gains `${lace.mount(project/foo)}` in mounts array
  - Feature declarations auto-inject: feature metadata with mounts gains `${lace.mount(shortId/name)}` in mounts array
  - Suppression: existing `${lace.mount(project/foo)}` in mounts array prevents auto-injection
  - Suppression: existing `${lace.mount(project/foo).source}` in a mount string also prevents auto-injection
  - Mixed project + feature declarations: both auto-inject
  - Prebuild feature declarations auto-inject: prebuild feature metadata with mounts gains `${lace.mount(shortId/name)}` in mounts array, same as regular features
  - Mixed regular + prebuild feature declarations: both auto-inject identically
  - Empty declarations: no injection

**Success criteria:**
- Project-level declarations produce `${lace.mount(project/<key>)}` entries
- Feature-level declarations produce `${lace.mount(<shortId>/<key>)}` entries
- Prebuild feature declarations produce `${lace.mount(<shortId>/<key>)}` entries (identical to regular features)
- Existing references in any accessor form suppress injection
- Auto-injection tests pass

**Constraints:**
- Do not modify `up.ts` in this phase (wiring happens in Phase 4)
- `autoInjectMountTemplates()` is a pure config transformation; it does not do resolution

### Phase 4: Pipeline Wiring + Validation + Guided Config

**Goal**: Wire the v2 system into `runUp()`: build declarations map, validate namespaces/targets, create resolver with declarations, emit guided config.

**Files to modify:**

- `packages/lace/src/lib/up.ts`:
  - After metadata fetch and before auto-injection:
    1. Extract project mount declarations: `extractProjectMountDeclarations(configForResolution)`
    2. Build unified declarations map: `buildMountDeclarationsMap(projectDecls, metadataMap)`
    3. Validate namespaces: each label's namespace must be `project` or in the feature ID map
    4. Validate target conflicts: no duplicate `target` values across declarations
  - Rework mount auto-injection call: pass project declarations + metadata map
  - Create `MountPathResolver` with declarations parameter: `new MountPathResolver(workspaceFolder, settings, declarations)`
  - Pass resolver to `resolveTemplates()` and remove `mountTargetMap` parameter from the signature (resolver now handles target resolution via declarations). Also remove `buildMountTargetMap()` function from `template-resolver.ts` — its functionality is subsumed by `resolver.resolveTarget()`
  - After resolution, emit guided config messages for default-path mounts

- `packages/lace/src/lib/__tests__/up-mount.integration.test.ts` (rework):
  - End-to-end with project declarations: devcontainer.json with `customizations.lace.mounts` + auto-injection → resolved output with concrete paths
  - End-to-end with feature declarations: feature metadata with mounts → auto-injected and resolved
  - End-to-end with prebuild feature declarations: prebuild feature metadata with mounts → auto-injected and resolved (same as regular features)
  - Settings override: override source used, no default dir creation
  - Namespace validation error: unknown namespace produces clear error
  - Target conflict error: duplicate targets produce clear error
  - Missing declaration error: `${lace.mount(project/unknown)}` fails with label list
  - Mixed port + mount: both resolve, no interference
  - Guided config output: verify console output includes recommendation for default-path mounts
  - Guided config suppression: no guidance emitted when ALL mounts have settings overrides
  - Guided config `recommendedSource`: recommendation line appears only for declarations with `recommendedSource` field
  - `.target` in containerEnv: resolves to declaration target

**Success criteria:**
- Full pipeline: declarations → auto-injection → resolution → output
- Validation catches namespace errors and target conflicts
- Guided config emitted for default-path mounts with `recommendedSource`
- Settings overrides work as before
- All existing port integration tests unaffected
- Full test suite green: `npx vitest run`

**Constraints:**
- `runUp()` structure changes should be minimal — add validation and declaration steps, adjust existing wiring
- Settings loaded once and shared (carry forward from v1 Phase 3 optimization)
- No interactive prompts — all guidance is console output

### Phase 5: Migrate Lace Devcontainer

**Goal**: Apply v2 mount templates to lace's own `.devcontainer/devcontainer.json`.

**Files to modify:**

- `.devcontainer/devcontainer.json`:
  - Add `customizations.lace.mounts` section with `bash-history` and `claude-config` declarations
  - Remove v1 mount template entries from `mounts` array (auto-injection handles them)
  - Keep static mounts (SSH key, wezterm config) as-is
  - Update `containerEnv.CLAUDE_CONFIG_DIR` to `${lace.mount(project/claude-config).target}`
  - Update comments to reflect v2 design

**After migration:**
```jsonc
{
  "customizations": {
    "lace": {
      "mounts": {
        "bash-history": {
          "target": "/commandhistory",
          "description": "Bash command history persistence"
        },
        "claude-config": {
          "target": "/home/node/.claude",
          "recommendedSource": "~/.claude",
          "description": "Claude Code configuration and credentials"
        }
      },
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {},
        "ghcr.io/devcontainers/features/sshd:1": {}
      }
    }
  },
  "mounts": [
    "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly",
    "source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly"
  ],
  "containerEnv": {
    "NODE_OPTIONS": "--max-old-space-size=4096",
    "CLAUDE_CONFIG_DIR": "${lace.mount(project/claude-config).target}"
  }
}
```

**Success criteria:**
- `mounts` array has only the two static mounts
- `customizations.lace.mounts` has both declarations
- `containerEnv.CLAUDE_CONFIG_DIR` uses `.target` accessor
- `build.args.COMMAND_HISTORY_PATH` and `build.args.USERNAME` unchanged (build-time values, can't use lace templates)

**Constraints:**
- This is a config migration, not a code change
- The two static mounts (SSH key, wezterm config) are NOT converted to lace templates — they are workspace-relative or single-file mounts, out of scope

### Phase 6: Smoke Test

**Goal**: Verify the full pipeline works against the real lace devcontainer config. This is an explicit verification step, not left to chance.

**Steps:**
1. Run `npx vitest run` — full test suite must be green
2. Run `npx tsx packages/lace/src/cli.ts up --skip-devcontainer-up` against the real workspace
3. Verify `.lace/devcontainer.json`:
   - `mounts` array has 4 entries (2 static + 2 auto-injected from declarations)
   - Auto-injected entries have concrete `source=` paths and correct `target=` from declarations
   - `containerEnv.CLAUDE_CONFIG_DIR` resolved to `/home/node/.claude`
   - Port resolution still works (`appPort`, `forwardPorts`, `portsAttributes` for wezterm-server)
4. Verify `.lace/mount-assignments.json`:
   - Two entries: `project/bash-history` and `project/claude-config`
   - `resolvedSource` paths are correct (default or override, depending on settings)
5. Verify auto-created directories exist on disk (for default-path mounts)
6. Verify guided config output includes `recommendedSource` for `claude-config`
7. If settings overrides exist: verify override paths used, no default dir creation for overridden mounts

**Success criteria:**
- All verifications pass
- Resolved `.lace/devcontainer.json` is valid for `devcontainer up`
- No regressions in port pipeline

**Constraints:**
- Do not actually run `devcontainer up` (destructive to existing container)
- Verify against `--skip-devcontainer-up` output only
- Clean up any test artifacts (temp dirs, etc.)

## Open Questions

1. **Prebuild feature mount declarations**: Resolved — prebuild feature mounts are auto-injected identically to regular feature mounts. Mounts are runtime config (`docker run` flags), so unlike ports (which require asymmetric `appPort` handling for prebuild features), mounts have no build/runtime lifecycle distinction. The unified declarations map includes prebuild feature declarations, and auto-injection processes them the same as regular features.

2. **`lace configure` command**: The guided config UX outputs text. A future `lace configure` or `lace init` command could interactively walk the user through mount setup. Out of scope for this proposal.

3. **File mounts vs. directory mounts**: Mount declarations target directory mounts with auto-creation. File mounts (like the SSH key) are excluded. If a motivating use case for template-resolved file mounts emerges, the system can be extended.

4. **Multi-project mount sharing**: Two projects declaring `project/bash-history` get isolated directories (different `<projectId>`). Sharing requires pointing both to the same directory via settings overrides. No first-class sharing mechanism is proposed.

5. **Mount ordering guarantees**: Auto-injected mounts are appended after user-defined mounts. If ordering matters (e.g., overlapping mount paths), the user can write explicit `${lace.mount()}` entries to control placement, which suppresses auto-injection. Lace does not currently detect overlapping mount paths (e.g., `/home/node` and `/home/node/.claude`) — this could be a useful future validation.
