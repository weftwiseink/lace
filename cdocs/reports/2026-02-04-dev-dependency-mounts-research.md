---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T14:00:00-08:00
task_list: lace/dotfiles-migration
type: report
state: live
status: wip
tags: [devcontainer, mounts, architecture, plugins, dependencies, analysis]
---

# Dev Dependency Mounts Architecture Research

> BLUF: A clean separation of concerns is achievable: projects declare dev dependencies by git repo identifier in `customizations.lace.devDependencies`, a user-level config (`~/.config/lace/repos.json`) maps repo identifiers to local paths, and lace opinionatedly mounts them at `/lace/deps/<repo-name>` inside containers. Claude plugins requiring identical host/container paths are a special case that demands a distinct mounting strategy -- either via a dedicated `mirrorMounts` configuration or by recommending users configure plugin paths to use the lace-controlled container path. This report analyzes existing patterns, proposes a declarative architecture, and identifies key edge cases and underspecifications requiring clarification.

## Context / Background

The lace devcontainer already uses bind mounts extensively for cross-cutting concerns: command history persistence, Claude config directories, and SSH public keys for WezTerm integration. As the dotfiles migration work progresses, a new requirement has emerged: mounting sibling projects as read-only "dev dependencies" inside devcontainers.

This applies to heterogeneous use cases:
- **Claude plugins**: A plugin developed in a sibling repo needs to be accessible in-container for testing, and some plugin hooks require the plugin path to be identical on host and in container.
- **Dotfiles**: Personal configurations (shell, editor, tmux) developed in a dotfiles repo should be applicable inside devcontainers.
- **Shared libraries**: Local development of a library that another project depends on, mounted for hot-reload iteration.

The user's stated architectural preferences:
1. The lace devcontainer customization should only reference git repos (by identifier, not path).
2. A separate user-level config should be responsible for mapping those repos to local paths.
3. Lace itself should be opinionated about the in-container mount point.

## Existing Lace Mount Patterns

The current `/var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json` demonstrates the established mounting conventions:

```jsonc
"mounts": [
  // Command history persistence - user-specific host path
  "source=${localEnv:HOME}/code/dev_records/weft/bash/history,target=/commandhistory,type=bind",

  // Claude config - user-specific host path
  "source=${localEnv:HOME}/code/dev_records/weft/claude,target=/home/node/.claude,type=bind",

  // SSH public key for WezTerm - read-only
  "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
],
"workspaceMount": "source=${localWorkspaceFolder}/..,target=/workspace,type=bind,consistency=delegated",
"workspaceFolder": "/workspace/main",
```

Key observations:
- Uses `${localEnv:HOME}` for user-specific paths that vary per machine.
- All current mounts hardcode paths, making them user-specific (cannot be committed as-is for other users).
- The `readonly` flag is used appropriately for credentials.
- The workspaceMount pattern mounts the parent directory to expose worktrees.

## Devcontainer Mount Specification

Per the [Dev Container JSON Reference](https://containers.dev/implementors/json_reference/), mounts accept:
- String format: `"source=...,target=...,type=bind,readonly,consistency=cached"`
- Object format: `{ "source": "...", "target": "...", "type": "bind", "readonly": true }`

Supported variable substitutions:
- `${localEnv:VAR_NAME}` - Host environment variable
- `${localEnv:VAR_NAME:default}` - With default value
- `${localWorkspaceFolder}` - Host path to the workspace folder
- `${containerWorkspaceFolder}` - Container path to the workspace folder

**Limitation**: There is no native devcontainer mechanism for "look up this path from user config." The mount source must be resolvable at container creation time from environment variables or the workspace path.

## Proposed Architecture

### Layer 1: Project-Level Declaration (`customizations.lace.devDependencies`)

Projects declare dependencies by git repo identifier (not path). This configuration is version-controlled and portable across machines.

```jsonc
// .devcontainer/devcontainer.json
{
  "customizations": {
    "lace": {
      "devDependencies": {
        // Simple form: just declare the dependency
        "github.com/user/dotfiles": {},

        // With options
        "github.com/user/claude-plugins": {
          "readonly": true,          // Default: true
          "required": false,         // Default: false (container starts even if not mapped)
          "subdirectory": "plugins"  // Mount only a subdirectory
        },

        // Short form for common cases
        "github.com/user/shared-lib": "readonly"
      }
    }
  }
}
```

**Repo identifier format**: The identifier should be a normalized git remote URL without protocol (e.g., `github.com/user/repo`). This matches how developers think about repos and is unambiguous.

Alternative considered: Using a short name like `dotfiles` or `shared-lib`. Rejected because it requires a separate naming registry and creates ambiguity across users. The full repo identifier is self-documenting and unique.

### Layer 2: User-Level Mapping (`~/.config/lace/repos.json`)

Users map repo identifiers to their local checkout paths. This file is user-specific and not committed to any project.

```jsonc
// ~/.config/lace/repos.json
{
  "repos": {
    "github.com/user/dotfiles": "~/code/personal/dotfiles",
    "github.com/user/claude-plugins": "~/code/weft/claude-plugins",
    "github.com/user/shared-lib": {
      "path": "~/code/libs/shared-lib",
      "branch": "dev"  // Optional: track a specific branch for staleness warnings
    }
  }
}
```

**Why user-level and not project-level?**
- Different users have different directory structures (`~/code/` vs `~/projects/` vs `~/src/`).
- Users may have the same repo checked out in multiple locations (different branches, worktrees).
- A team project should not dictate where individual developers keep their code.

**Discovery order** (for `lace` CLI to resolve paths):
1. `~/.config/lace/repos.json` (XDG-compliant primary location)
2. `~/.lace/repos.json` (legacy/simple location)
3. Environment variable `LACE_REPOS_CONFIG` (for CI/advanced use cases)

### Layer 3: Container Mount Point (Lace-Controlled)

Lace prescribes the in-container mount point. This is not user-configurable.

```
/lace/deps/<repo-name>/
```

Example: `github.com/user/dotfiles` mounts at `/lace/deps/dotfiles/`

**Rationale for opinionated paths:**
- Eliminates configuration complexity in-container (scripts, tools, CLAUDE.md can reference stable paths).
- Prevents collisions between projects that might use the same short name for different repos.
- The repo-name (last segment of the identifier) is used for brevity; collisions are handled by appending the org/user (`/lace/deps/dotfiles/` vs `/lace/deps/otheruser-dotfiles/`).

### Implementation: How Lace Processes This

The `lace` CLI (or a future `lace devcontainer` subcommand) processes the devcontainer.json before invoking the devcontainer CLI:

```
lace prebuild
     |
     v
lace resolve-deps  (new step)
     |
     +-- Read devcontainer.json customizations.lace.devDependencies
     +-- Read ~/.config/lace/repos.json
     +-- For each declared dependency:
     |       - Look up local path from user config
     |       - Validate path exists (warn or error based on `required`)
     |       - Generate mount spec: "source=<local-path>,target=/lace/deps/<name>,type=bind,readonly"
     +-- Write generated mounts to .lace/generated-mounts.json
     |
     v
devcontainer up --additional-mount-from .lace/generated-mounts.json
```

**Open question**: The devcontainer CLI does not have an `--additional-mount-from` flag. Options:
1. **Merge into devcontainer.json**: Write a `.lace/devcontainer.json` that extends the original with additional mounts, use `lace up` instead of `devcontainer up`.
2. **Use initializeCommand**: Generate a shell script that adds mounts to a config file read at startup.
3. **Docker Compose layer**: Generate a `docker-compose.lace.yml` with additional volumes, use compose override merging.

The first option (write extended devcontainer.json to `.lace/`) fits the existing lace prebuild pattern.

## The Claude Plugin Path Problem

Claude Code plugins have a specific constraint: **hooks and MCP servers that reference local paths may require the path to be identical on host and in container.**

From the [Plugins Reference](https://code.claude.com/docs/en/plugins-reference):
- Plugins use `${CLAUDE_PLUGIN_ROOT}` for paths relative to the plugin directory.
- When plugins are installed, they are **copied to a cache directory**, not used in-place.
- The cache location is determined by Claude Code, not user-configurable.

**The problem**: If a developer is iterating on a plugin in `/home/user/code/plugins/my-plugin/` on the host, and the devcontainer mounts it at `/lace/deps/my-plugin/`, the paths don't match. Any absolute paths in plugin configuration (MCP server commands, hook scripts) that worked on the host will fail in the container.

### Analysis of Path-Sensitive Plugin Components

| Component | Path Handling | Sensitivity |
|-----------|---------------|-------------|
| Skills (`SKILL.md`) | Relative to plugin root | Not sensitive |
| Agents (`.md` files) | Relative to plugin root | Not sensitive |
| Hooks (`hooks.json`) | `${CLAUDE_PLUGIN_ROOT}` variable | Managed by variable |
| MCP servers (`.mcp.json`) | `${CLAUDE_PLUGIN_ROOT}` variable | Managed by variable |
| LSP servers (`.lsp.json`) | Commands must be in PATH | Not path-sensitive |

**Finding**: Properly authored plugins using `${CLAUDE_PLUGIN_ROOT}` consistently should work regardless of mount path. The path sensitivity arises when:
1. A plugin hardcodes absolute paths instead of using the variable.
2. A user's Claude config references the plugin by absolute path and that path differs in-container.
3. External tooling (not part of Claude Code) needs to locate the plugin.

### Proposed Solutions for Path-Sensitive Cases

**Option A: Mirror Mounts (user declares path matching requirement)**

A separate configuration for mounts that must preserve host paths:

```jsonc
// customizations.lace
{
  "devDependencies": {
    "github.com/user/claude-plugins": {
      "mirrorPath": true  // Mount at same path as host
    }
  }
}
```

With `mirrorPath: true`, lace mounts at the literal host path:
- Host: `/home/user/code/plugins/`
- Container: `/home/user/code/plugins/`

**Trade-offs**:
- Requires the container filesystem to support the host path (may need to create parent directories).
- Creates non-portable container paths (container behavior depends on host user's directory structure).
- May conflict with container's own `/home/` structure if the user runs as a different UID.

**Option B: Use lace path as canonical (recommend plugin authors design for this)**

Instead of matching host paths, design the workflow so the lace-controlled path is the source of truth:
1. Plugin installed at `/lace/deps/my-plugin/` in container.
2. Container's `~/.claude/settings.json` points to `/lace/deps/my-plugin/`.
3. Plugin development happens in-container; the bind mount syncs changes to host.

**Trade-offs**:
- Requires container-first workflow (some developers prefer host-first).
- The host Claude Code installation cannot use the same plugin path (different paths on host vs container).

**Option C: Symlink bridge**

Create a symlink on the host at a known location that lace controls:
- Host: `~/.lace/plugins/my-plugin/` -> `/home/user/code/plugins/my-plugin/`
- Container: `~/.lace/plugins/my-plugin/` (mounted)

Both host and container can reference `~/.lace/plugins/my-plugin/` consistently.

**Trade-offs**:
- Requires lace to manage symlinks on the host.
- `~` expands differently for different users, so still not fully portable.
- Symlink management adds complexity to lace.

**Recommendation**: Start with Option B (recommend plugins use `${CLAUDE_PLUGIN_ROOT}` and configure Claude settings to point to `/lace/deps/<name>/` in-container). Document Option A (`mirrorPath`) as an escape hatch for legacy plugins that hardcode paths. Option C adds too much complexity for the benefit.

## Dotfiles Application Pattern

Dotfiles are a special case of dev dependency with additional semantics:
- They need to be applied (symlinked, copied, or sourced), not just present.
- Application may happen at container creation time (Dockerfile, postCreateCommand) or interactively.
- Chezmoi (the planned dotfile manager) has its own source/target model.

**Proposed pattern**:

```jsonc
// customizations.lace
{
  "devDependencies": {
    "github.com/user/dotfiles": {
      "type": "dotfiles",  // Signals special handling
      "apply": "postCreate"  // When to apply: "postCreate" | "postStart" | "manual"
    }
  }
}
```

With `type: dotfiles`:
1. Lace mounts at `/lace/deps/dotfiles/` (standard behavior).
2. If `apply: postCreate`, lace adds a postCreateCommand step that invokes the dotfiles' setup mechanism:
   - Detects chezmoi: `chezmoi apply --source /lace/deps/dotfiles/`
   - Detects setup.sh: `/lace/deps/dotfiles/setup.sh`
   - Otherwise: warns that manual application is needed.

**Open question**: Should lace handle multiple dotfile repos? A user might have:
- Base dotfiles (shell config)
- Work-specific dotfiles (org-specific tooling)
- Project-specific dotfiles (this project's wezterm plugin, once extracted)

Supporting multiple dotfile repos with merge semantics is complex. Initial recommendation: support one `type: dotfiles` dependency per project; multiple dotfiles can be composed in the dotfiles repo itself.

## Edge Cases and Challenges

### 1. Dependency Not Mapped

A project declares a dev dependency, but the user's `repos.json` doesn't have a mapping.

**Behavior**:
- If `required: false` (default): warn at `lace up` time, proceed without the mount.
- If `required: true`: error and abort.

The warning message should include instructions for adding the mapping.

### 2. Mapped Path Doesn't Exist

User's `repos.json` has a mapping, but the path doesn't exist (repo not cloned, wrong path).

**Behavior**: Same as "not mapped" -- warn or error based on `required`.

### 3. Circular Dependencies

Project A depends on Project B, which depends on Project A.

**Analysis**: Not actually a problem. Each project declares what it needs mounted. When developing A, B is mounted read-only. When developing B, A is mounted read-only. They don't recursively include each other's devcontainers.

### 4. Version/Branch Mismatch

Project A's devcontainer expects a specific version of dependency B, but the user has a different branch checked out.

**Behavior**: Out of scope for initial implementation. Future enhancement could:
- Allow declaring expected branch/tag in devDependencies.
- Compare against actual branch at the mapped path.
- Warn if mismatched.

### 5. Large Dependencies

A dependency is large (e.g., monorepo with gigabytes of data) and mounting it slows container performance.

**Mitigation options** (future work):
- `subdirectory` option to mount only part of the repo.
- `sparse` option that does a sparse checkout in-container instead of bind mount.

### 6. Windows Host Path Incompatibility

Windows paths (`C:\Users\...`) cannot be directly mirrored in a Linux container.

**Behavior**: `mirrorPath: true` is invalid on Windows hosts. Lace should detect and error with guidance.

## Underspecifications Requiring Clarification

1. **Repo identifier format**: Is `github.com/user/repo` the right format? Alternatives:
   - Git SSH URL: `git@github.com:user/repo.git`
   - HTTPS URL: `https://github.com/user/repo`
   - Short name: `user/repo` (assumes GitHub)

   Recommendation: Use the "clone URL without protocol" form (`github.com/user/repo`) as it's unambiguous across hosts (GitHub, GitLab, Bitbucket, self-hosted).

2. **Mount timing**: Should lace generate mounts at prebuild time or at `devcontainer up` time?
   - Prebuild time: Baked into the generated devcontainer config; user can inspect before launching.
   - Up time: More dynamic, can react to current state of repos.json.

   Recommendation: Generate at a new `lace prepare` or `lace resolve` step, run before `devcontainer up`. Not at prebuild (prebuild is about image layers, not runtime config).

3. **Lace CLI extension vs devcontainer lifecycle hooks**: Should this be implemented as:
   - lace CLI commands that wrap devcontainer CLI?
   - A devcontainer feature that runs at container creation?
   - An initializeCommand that runs on the host before container creation?

   Recommendation: lace CLI wrapper. Features run in-container (too late to add mounts). initializeCommand could work but pushes logic into shell scripts.

4. **Configuration schema versioning**: If the `devDependencies` schema evolves, how to handle old configs?

   Recommendation: Include a schema version field, or use the existing lace CLI version as the implicit schema version with documented compatibility guarantees.

5. **Multiple users on same machine**: If two users share a machine and have different `repos.json`, each user's lace invocations should use their own config.

   Current design handles this via XDG paths (`~/.config/lace/`), which expand per-user.

## Recommendations

1. **Start with the minimal viable feature set**:
   - `customizations.lace.devDependencies` with repo identifier and `readonly`/`required` flags.
   - `~/.config/lace/repos.json` for user mappings.
   - `/lace/deps/<name>/` as the opinionated mount point.
   - `lace resolve-deps` command that validates and generates mount config.

2. **Defer path-mirroring (`mirrorPath`) to a later iteration** unless there's immediate demand. Recommend plugin authors use `${CLAUDE_PLUGIN_ROOT}` properly.

3. **Defer dotfiles-specific handling (`type: dotfiles`)** to the dotfiles migration proposal. The general dev dependency mechanism supports dotfiles as a degenerate case (just a mounted directory).

4. **Document the architecture** in a proposal document before implementation, allowing for review of the schema and behavior.

## Related Documents

- [Dotfiles Migration Proposal Planning](../devlogs/2026-02-04-dotfiles-migration-proposal-planning.md) - Context for this research
- [packages/lace: Devcontainer Wrapper](../proposals/2026-01-30-packages-lace-devcontainer-wrapper.md) - Existing lace CLI architecture
- [Dev Container JSON Reference](https://containers.dev/implementors/json_reference/) - Mount specification
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) - Plugin path handling

## Sources

- [Dev Container Specification](https://containers.dev/implementors/spec/)
- [Dev Container JSON Reference](https://containers.dev/implementors/json_reference/)
- [Change the default source code mount - VS Code](https://code.visualstudio.com/remote/advancedcontainers/change-default-source-mount)
- [Add another local file mount - VS Code](https://code.visualstudio.com/remote/advancedcontainers/add-local-file-mount)
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference)
