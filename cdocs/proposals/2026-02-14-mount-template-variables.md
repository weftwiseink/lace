---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T22:00:00-08:00
task_list: lace/template-variables
type: proposal
state: live
status: request_for_proposal
tags: [mounts, template-variables, features, devcontainer, lace-cli, host-paths, extensibility]
related_to:
  - cdocs/proposals/2026-02-14-structured-devcontainer-output.md
  - cdocs/reports/2026-02-14-devcontainer-json-object-specifications.md
  - cdocs/proposals/2026-02-06-rfp-claude-tools-lace-feature.md
---

# RFP: Mount Template Variables

> BLUF: Introduce a `${lace.mount.source(...)}` and `${lace.mount.target(...)}` template variable system -- analogous to the existing `${lace.port()}` system -- that lets features and devcontainer configs declare mount points with lace-managed host path resolution, default directory creation, and user overrides via `settings.json`. This decouples mount path knowledge from individual devcontainer configs and enables features to declare "I need persistent storage at X" without hardcoding host filesystem layout.
>
> - **Motivated by:** The hardcoded mount paths in `.devcontainer/devcontainer.json` (bash history, claude config, SSH keys, wezterm config) that use `${localEnv:HOME}/...` with project-specific subpaths. These are fragile, non-portable, and cannot be overridden per-user without forking the devcontainer config. The port template variable system (`${lace.port()}` in `template-resolver.ts`) already solves the analogous problem for ports -- mount paths need the same treatment.

## Objective

Enable devcontainer configs and features to declare mount points using template variables that lace resolves to concrete host and container paths, with sensible defaults and user-overridable configuration. The system should:

1. **Eliminate hardcoded host paths** from devcontainer.json files. A mount like `source=${localEnv:HOME}/code/dev_records/weft/bash/history,target=/commandhistory` should become `source=${lace.mount.source(project/bash-history)},target=${lace.mount.target(project/bash-history)}`.

2. **Enable features to declare mount needs.** A feature like claude-code could declare "I need `~/.claude` mounted into the container" via its `devcontainer-feature.json` metadata, and lace would handle the host path resolution and mount generation -- similar to how features declare port needs via `customizations.lace.ports` today.

3. **Support per-user overrides.** Users with non-standard directory layouts (e.g., XDG-compliant paths, shared NAS mounts, symlinked home directories) can override mount sources in `~/.config/lace/settings.json` without modifying project configs.

4. **Auto-create host directories.** When a mount source resolves to `~/.config/lace/<project>/mounts/<namespace>/<var>` and that directory does not exist, lace should create it during `lace up` -- preventing the common failure mode where Docker creates a root-owned directory because the bind mount source was missing.

## Scope

The full proposal should explore:

### 1. Symmetry with the Port System

The port template variable system (`${lace.port(featureId/optionName)}`) has these components:
- **Pattern matching**: regex `\$\{lace\.port\(([^)]+)\)\}` in `template-resolver.ts`
- **Label format**: `featureId/optionName` (e.g., `wezterm-server/hostSshPort`)
- **Allocation**: `PortAllocator` assigns from a range (22425-22499), persists in `.lace/port-assignments.json`
- **Auto-injection**: `autoInjectPortTemplates()` reads `customizations.lace.ports` from feature metadata and injects templates for options the user hasn't explicitly set
- **Type coercion**: standalone `${lace.port()}` resolves to an integer; embedded in a string resolves to string
- **Feature validation**: port declaration keys must match option names in the feature schema
- **Persistence**: `.lace/port-assignments.json` stores label-to-port mappings for stability across rebuilds

Which of these concepts translate to mounts?

- **Allocation**: Ports allocate from a numeric range. Mounts allocate from a filesystem namespace. The analog to "pick an unused port" is "derive a unique host directory path." There is no contention problem (unlike ports, two mounts can coexist at arbitrary paths), so allocation is simpler -- it is really just path derivation with a convention.
- **Auto-injection**: Should lace auto-inject mount template variables for features that declare mount needs? The port system does this. But mounts are more complex than ports -- they have source, target, type, and readonly properties, not just a single number.
- **Persistence**: Ports persist assignments for stability. Mounts probably need a similar mechanism -- `~/.config/lace/<project>/mount-assignments.json` or similar -- to track which host directories were created and enable cleanup.
- **Type coercion**: Ports coerce to integer when standalone. Mounts always resolve to strings (paths). No type coercion needed.
- **Prebuild features**: The port system has asymmetric handling for prebuild features (inject into `appPort` rather than feature options). Do mount template variables need equivalent prebuild handling? Prebuild features are baked into the image layer and cannot have runtime mounts, so the answer may be "mounts are runtime-only, no prebuild analog."

### 2. Namespace Semantics

The proposed template variable format is `${lace.mount.source(namespace/var)}`. What do `namespace` and `var` mean?

- **Is `namespace` the feature ID?** For feature-declared mounts, it makes sense: `${lace.mount.source(claude-code/config)}` where `claude-code` is the feature and `config` is the mount name. This parallels the port system's `featureId/optionName` pattern.
- **What about project-level mounts?** The current devcontainer.json has mounts for bash history and claude config that are not tied to any feature. These need a namespace too. Options:
  - A reserved namespace like `project/` (e.g., `${lace.mount.source(project/bash-history)}`)
  - The project name itself (e.g., `${lace.mount.source(lace/bash-history)}`)
  - A bare name with no namespace (e.g., `${lace.mount.source(bash-history)}`) -- but this risks collisions with feature names.
- **Can multiple features share a namespace?** The port system forbids feature ID collisions (`buildFeatureIdMap` throws on duplicate short IDs). Should mount namespaces have the same constraint?
- **Validation**: The port system validates that the `featureId` in a port label exists in the config's feature list. Should mount namespaces be validated the same way? What about the `project/` namespace -- it has no corresponding feature entry.

> NOTE: `lace.mount.target` is **feature-defined and user-referrable**. The `${lace.mount.target(namespace/var)}` variable is not just a fixed container path -- features declare it so that users (and other features) can reference container paths without implicit knowledge of where a feature places its files. This makes target paths overridable and discoverable: a feature declares the canonical target, and other config consumers reference it by label rather than hardcoding `/home/node/.claude` or similar. This is the key distinction between source and target template variables -- source vars handle host path resolution, while target vars provide feature-defined reference points that eliminate implicit path coupling across the config.

### 3. Default Host Paths

The proposed default host path convention is `~/.config/lace/<project>/mounts/<namespace>/<var>`. Several questions:

- **How is `<project>` determined?** Candidates:
  - The workspace folder basename (e.g., `lace` from `/var/home/mjr/code/weft/lace`)
  - A hash of the workspace folder path (avoids collisions for projects with the same name in different directories)
  - A user-configured project ID in `devcontainer.json` or `settings.json`
  - The `name` field from `devcontainer.json` (e.g., `"Lace Development (Worktrees)"` -- but this has spaces and is not filesystem-friendly)
  - Note: the port system uses `workspaceFolder` to derive the `.lace/` directory path but does not have a `<project>` segment in its state file path. Mount host paths need a project discriminator because they live in the user's home directory, not the workspace.
- **Worktree handling**: The lace devcontainer uses `workspaceMount` to mount the parent of the worktree. If `<project>` is derived from the workspace folder, which worktree path wins? The main worktree? The currently-checked-out one?
- **Should these directories be auto-created?** If yes, at what point in the pipeline? Docker's behavior when a bind mount source doesn't exist is to create it as root-owned, which causes permission issues. Lace should create mount source directories as the current user before generating the config. But what about mounts that point to existing directories (like `~/.claude/`)? Those should NOT be auto-created -- they are references to pre-existing state.
- **The distinction between "lace-managed storage" and "reference to existing directory"**: Some mount sources are directories that lace creates and manages (bash history, persistent state). Others are references to directories that already exist on the host (`~/.claude/`, `~/.ssh/`). The default path convention only applies to lace-managed storage. References to existing directories need explicit source paths (possibly via feature option defaults or user settings).

### 4. Mount Properties

A mount has more properties than a port: `type`, `source`, `target`, `readonly`, `consistency`. When a feature declares a mount need, who controls these properties?

- **Feature-declared defaults**: The feature's `devcontainer-feature.json` could declare `customizations.lace.mounts` with default properties:
  ```jsonc
  {
    "customizations": {
      "lace": {
        "mounts": {
          "config": {
            "defaultTarget": "/home/${_REMOTE_USER}/.claude",
            "readonly": false,
            "description": "Claude Code configuration and credentials"
          }
        }
      }
    }
  }
  ```
- **User overrides**: `settings.json` could override source, target, and readonly per mount label:
  ```jsonc
  {
    "mounts": {
      "claude-code/config": {
        "source": "~/my-custom-claude-dir",
        "readonly": true
      }
    }
  }
  ```
- **Override precedence**: User settings override feature defaults. But should the user be able to override `type`? Probably not -- changing a bind mount to a volume fundamentally changes semantics. What about `consistency`? On Linux it is a no-op, but macOS users may want `delegated` for performance.
- **Interaction with the structured output proposal**: The structured output proposal (`2026-02-14-structured-devcontainer-output.md`) introduces `DevcontainerMount` objects with serialization-time format selection. Mount template variables should produce `DevcontainerMount` objects, not raw strings, so they benefit from the structured validation pipeline.

### 5. Interaction with Existing Mount Systems

Lace already has two mount systems:

1. **repoMounts** (`customizations.lace.repoMounts` in devcontainer.json): Declares cross-repository mounts that lace clones and bind-mounts. Handled by `mounts.ts` and `resolve-mounts.ts`. Has its own override system in `settings.json` (source path, target, readonly).

2. **User-authored mounts** (top-level `mounts` array in devcontainer.json): Static mounts passed through to Docker. Currently string-format with `${localEnv:...}` variables.

How do mount template variables relate?

- **Are they a third system?** Template var mounts could be a new concept alongside repoMounts and user mounts, with their own resolution pipeline.
- **Or a generalization of repoMounts?** RepoMounts are essentially "mount this cloned repo at this path." Template var mounts generalize to "mount this resolved path at this path." RepoMounts could be reimplemented atop mount template variables (the repo clone step becomes a mount source resolver). But this generalization may be premature -- repoMounts have clone/update lifecycle that generic mounts do not.
- **Coexistence**: The generated `.lace/devcontainer.json` already merges repoMounts into the `mounts` array. Template var mounts would be resolved inline within the existing `mounts` array (and possibly in feature mount declarations), rather than being appended separately.

> NOTE: The `lace.mount.source` user override configuration should learn from and potentially share infrastructure with the existing repoMounts override system. The `settings.json` override system for repos already handles source path overrides, readonly toggles, and target customization -- the mount template variable system's user config needs the same capabilities and should be consistent in shape and semantics. There is meaningful overlap between the repoMounts override flow and the consent dialog flow described in Section 9 (Feature Consent and Trust Model): both involve the user specifying or accepting a host source path, with lace providing a managed fallback. A unified or at minimum consistent configuration format for both systems would reduce cognitive overhead and enable shared validation and resolution infrastructure.

### 6. Feature Mount Declarations

The devcontainer feature specification supports `mounts` in `devcontainer-feature.json`:
```json
{
  "mounts": [
    { "type": "bind", "source": "/host/path", "target": "/container/path" }
  ]
}
```

Feature mounts are object-only (no string format). The host source path is typically static, which makes them unsuitable for user-specific paths like `~/.claude/`. How does lace's template var system interact?

- **Option A: Template vars in feature options, not feature mounts.** The feature declares mount-related options (like `hostClaudeDir`) and lace injects template-resolved values. The feature's `install.sh` or lifecycle hooks use the option values to create mounts or symlinks. This is the approach sketched in the claude-tools RFP (`2026-02-06-rfp-claude-tools-lace-feature.md`).
- **Option B: Lace generates mounts outside the feature spec.** The feature declares mount needs in `customizations.lace.mounts` (metadata only, not in the spec's `mounts` array), and lace generates the actual mount entries in the top-level `mounts` array of `.lace/devcontainer.json`. The feature never sees the mount directly -- it just assumes the target path exists.
- **Option C: Template vars in feature mount source fields.** The feature declares `"source": "${lace.mount.source(claude-code/config)}"` in its `mounts` array. But the feature spec's `mounts` are object-only with `additionalProperties: false`, and template variables in mount source fields may not survive the devcontainer CLI's processing pipeline.

Which approach best preserves feature self-sufficiency (usable without lace) while enabling lace orchestration?

### 7. The Generated Output

When mount template variables are resolved, the resulting mounts appear in `.lace/devcontainer.json`. Output format considerations:

- **String vs. object format**: The structured output proposal establishes that mounts with `readonly` must be strings (the Mount JSON schema has `additionalProperties: false`). Mount template variables that resolve to readonly mounts must produce strings. Non-readonly mounts can be objects.
- **Template var mounts are lace-controlled**: Unlike user-authored mounts (which might have any format), template var mounts are fully controlled by lace's resolution pipeline. This means lace can always produce well-formed output -- making mount template variables the ideal use case for the structured `DevcontainerMount` intermediate representation.
- **Mixed arrays**: The output `mounts` array will contain user-authored mounts (string or object, passed through), repoMounts (generated by `generateMountSpec`), and template var mounts (newly generated). All three types coexist in the same array.

### 8. Directory Lifecycle

Mount source directories that lace manages have a lifecycle:

- **Creation**: When should `~/.config/lace/<project>/mounts/` be created? On `lace up` is the natural point -- it is when the config is generated and mounts are resolved. Creating directories lazily (only when referenced) avoids cluttering the filesystem for unused mounts.
- **Permissions**: Directories should be created as the current user (not root). This is naturally handled if creation happens in the Node.js process running `lace up`, which runs as the current user.
- **Cleanup**: When a project is removed or a mount is no longer declared, should lace clean up the host directories? Aggressive cleanup risks data loss. Conservative cleanup (never auto-delete) risks clutter. Options:
  - `lace clean` command that lists and optionally removes stale mount directories
  - Garbage collection based on last-accessed time
  - Never auto-delete; document manual cleanup
- **Portability**: If a user moves their workspace to a different machine, the mount source directories won't exist. Lace should handle this gracefully -- create missing directories, warn about potentially missing data, offer to restore from backups.
- **Gitignore**: The `.lace/` directory is already gitignored. Mount assignment state files should also live there or in `~/.config/lace/`.

### 9. Feature Consent and Trust Model

> NOTE: Features should be able to recommend mounting a specific host directory (like `~/.claude`), but should NOT be able to opaquely bind to arbitrary host directories without explicit user consent. This is an intentional design constraint -- features can recommend without taking overly much control of binding outside lace-managed directories.

The consent flow works as follows:

1. **Feature declares a recommended source.** A feature's `customizations.lace.mounts` metadata includes a `recommendedSource` (e.g., `~/.claude`) alongside the mount name and default target.

2. **Lace checks whether the user has explicitly accepted this source.** Acceptance could be tracked in `~/.config/lace/settings.json` or a per-project trust store. If the user has previously accepted this source for this feature, proceed without interruption.

3. **If not accepted, lace prompts with a consent warning:**
   > "Feature X wants to mount `~/.claude` into the container. Accept this, or lace will create a new auto-managed source directory at `~/.config/lace/<project>/mounts/X/config` instead. Are you sure?"

4. **The user chooses:**
   - **Accept**: Lace records the acceptance and uses the feature's recommended source. Subsequent runs warn but do not interrupt.
   - **Decline**: Lace creates a lace-managed directory as the source instead. The feature still gets a mount at the declared target, but the source is sandboxed under lace's managed storage rather than pointing at the user's real host directory.

This model maintains two important properties:

- **Features remain self-sufficient.** A feature always gets a mount at its declared target path -- the consent model only affects which host directory backs it. This means features do not need conditional logic for "mount available vs. not available."
- **Users retain control over host filesystem exposure.** No feature can silently bind-mount `~/` or `~/.ssh/` or any other sensitive host directory into a container without the user explicitly agreeing. The fallback to lace-managed storage means declining consent is never a hard failure.

The consent state should be persistent across rebuilds (stored in `settings.json` or a dedicated trust file) and inspectable via `lace status` or similar. A `lace trust` subcommand could manage accepted sources explicitly.

## Known Requirements

These concrete scenarios motivate the design:

1. **Bash history persistence**: Currently `source=${localEnv:HOME}/code/dev_records/weft/bash/history,target=/commandhistory`. Should become a lace-managed mount with a default source under `~/.config/lace/<project>/mounts/project/bash-history` and the current path available as a user override.

2. **Claude config mounting**: Currently `source=${localEnv:HOME}/code/dev_records/weft/claude,target=/home/node/.claude`. This is a reference to an existing directory, not lace-managed storage. The default source should be `~/.claude` (the standard location), with the current custom path as a user override.

3. **SSH authorized keys**: Currently `source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly`. This is a file mount (not a directory), readonly, and references existing host state. It may be better handled by a feature option than a mount template variable.

4. **WezTerm container config**: Currently `source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly`. This is a workspace-relative file mount. It references a file in the project tree, not user state. It may not belong in the mount template variable system at all.

5. **Feature-declared mounts**: A future claude-code feature needs to mount `~/.claude/` with user-specific source resolution. The mount template variable system should enable this without hardcoding paths in the feature spec.

6. **Feature consent for non-managed sources**: When a feature recommends mounting a host directory outside of lace-managed storage (e.g., `~/.claude`), the user must explicitly consent before lace exposes that directory to the container. Without consent, lace falls back to creating a sandboxed lace-managed directory as the source. This prevents features from opaquely binding arbitrary host directories and ensures the user retains control over what host paths are exposed to containers.

## Prior Art

- **Port template variables**: `${lace.port(featureId/optionName)}` in `template-resolver.ts` -- the direct model for this proposal. Handles allocation, persistence, auto-injection, and feature metadata integration.
- **repoMounts**: `customizations.lace.repoMounts` in `devcontainer.ts` and `mounts.ts` -- lace's existing mount management system for cross-repo access. Has override semantics in `settings.json`.
- **Structured output proposal**: `cdocs/proposals/2026-02-14-structured-devcontainer-output.md` -- introduces `DevcontainerMount` typed representation and serialization-time format selection. Mount template variables should produce this type.
- **Claude tools RFP**: `cdocs/proposals/2026-02-06-rfp-claude-tools-lace-feature.md` -- proposes `${lace.local.home}` and `${lace.container.home}` template variables for feature mount resolution. This overlaps with mount template variables.
- **Devcontainer spec mount schema**: The Mount object schema supports only `{type, source, target}` with `additionalProperties: false`. See `cdocs/reports/2026-02-14-devcontainer-json-object-specifications.md`.
- **Docker `--mount` flag**: The string format supports `type`, `source`, `target`, `readonly`, `consistency`, `bind-propagation`, and other parameters. Lace's mount string generator (`generateMountSpec` in `mounts.ts`) currently produces this format.

## Open Questions

1. **Scope of the template variable namespace**: Should mount template variables share the `${lace.*}` namespace with ports (`${lace.port()}`, `${lace.mount.source()}`, `${lace.mount.target()}`), or should they use a distinct syntax? The current `LACE_UNKNOWN_PATTERN` regex in `template-resolver.ts` (`/\$\{lace\.(?!port\()([^}]+)\}/`) would reject any non-port lace template -- this guard must be relaxed before mount templates can coexist.

2. **Source vs. target template variables**: Do we need both `${lace.mount.source()}` and `${lace.mount.target()}`? The source is the host path (user-specific, needs resolution). The target is the container path (usually fixed per feature). If the target is always declared by the feature, maybe only `${lace.mount.source()}` is a template variable, and the target is a property of the mount declaration. **Partial answer (see Scope > 2):** Yes, both are needed -- target vars serve a different purpose than source vars. Target vars are feature-defined reference points that allow users and other features to refer to container paths by label without implicit path knowledge. Source vars handle host path resolution. The two serve complementary roles.

3. **File mounts vs. directory mounts**: The current devcontainer.json has both file mounts (SSH key, wezterm config) and directory mounts (bash history, claude config). Should mount template variables handle both? File mounts have different semantics -- the source must be an existing file, not a directory to be auto-created.

4. **Interaction with devcontainer variable substitution**: Devcontainer.json supports its own variable substitution (`${localEnv:HOME}`, `${localWorkspaceFolder}`, etc.). Lace's `${lace.mount.source()}` would be resolved before the devcontainer CLI sees the config. How do we handle cases where the resolved path itself needs devcontainer variable substitution? Should lace resolve to absolute paths (avoiding the issue) or to devcontainer variables (preserving portability)?

5. **MVP scope**: What is the minimum viable implementation? The port system evolved through multiple proposals and iterations. Should mount template variables start with just `${lace.mount.source()}` for project-level mounts (no feature integration, no auto-injection), and grow feature support later?

6. **Should this subsume repoMounts?** RepoMounts currently have their own resolution pipeline (`resolve-mounts.ts`). Mount template variables could theoretically replace repoMounts by treating "clone this repo and mount it" as a mount source resolver plugin. But repoMounts have clone/update lifecycle, conflict detection, and symlink generation that generic mounts do not. Is the generalization worth the complexity?

7. **Cleanup semantics**: When a mount template variable is removed from a devcontainer.json, what happens to the host directory? The port system does not reclaim freed ports (they just become available for reallocation). Mount directories contain user data -- the stakes are higher. What cleanup semantics are safe?

8. **Multi-project isolation**: If two projects both declare `${lace.mount.source(project/bash-history)}`, should they share the same host directory or have isolated directories? The `<project>` segment in the default path suggests isolation, but the project identifier derivation (question 3 in Scope) determines whether this actually works.
