---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T20:00:00-08:00
task_list: lace/plugins-system
type: proposal
state: live
status: implementation_wip
tags: [devcontainer, mounts, plugins, lace-cli, architecture]
supersedes: cdocs/proposals/2026-02-04-dev-dependency-cross-project-mounts.md
last_reviewed:
  status: approved
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T21:45:00-08:00
  round: 2
revisions:
  - at: 2026-02-04T21:30:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Added Project Identifier ($project) derivation algorithm"
      - "Specified shallow clone mechanics: URL derivation, branch selection, update failure handling"
      - "Added Symlink Creation Mechanism section with postCreateCommand approach"
      - "Clarified LACE_SETTINGS environment variable as file path"
      - "Added symlink and $project derivation test tables"
---

# Lace Plugins System

> BLUF: Projects declare plugins by git repo identifier (e.g., `github.com/user/repo/subdir`) in `customizations.lace.plugins`, with an optional `alias` field for conflict resolution. Users configure plugin overrides in `~/.config/lace/settings.json` with a `plugins` field mapping repos to `{ overrideMount?: { source, readonly?, target? } }`. Missing plugins are errors on `lace up`. Non-overridden plugins are shallow-cloned to `~/.config/lace/$project/plugins/$plugin_name_or_alias`, updated by `lace resolve-mounts`, and mounted readonly at `/mnt/lace/plugins/$name_or_alias`. When a user specifies a custom `target`, lace symlinks the default lace target to that location. The `lace resolve-mounts` command replaces `lace resolve-deps` and fails on `$name_or_alias` conflicts.

## Objective

Establish a general-purpose plugin system for lace-managed devcontainers that:

1. **Project-level declaration**: Projects specify what plugins they need (portable, version-controlled) using git repo identifiers with subdirectory support.
2. **User-level configuration**: Users configure plugin mount overrides in a single settings file (personal, not committed).
3. **Lace-controlled defaults**: Lace prescribes sensible defaults for cloning, caching, and mounting (consistent, predictable).
4. **Error on missing**: Missing plugins fail `lace up` rather than proceeding with warnings, ensuring container consistency.

This supports use cases like:
- Claude plugins developed in sibling repos, accessible for testing in-container.
- Dotfiles repos applied inside devcontainers.
- Shared development utilities mounted across projects.
- WezTerm configuration plugins with host-side setup requirements.

## Background

### Evolution from Dev Dependencies

The [dev dependency cross-project mounts proposal](2026-02-04-dev-dependency-cross-project-mounts.md) established the foundational architecture for mounting sibling repos. This proposal evolves that design into a full-fledged plugin system with:

- Renamed terminology (`devDependencies` -> `plugins`)
- Subdirectory support in repo identifiers
- Explicit alias field for conflict resolution
- Consolidated user config (`repos.json` -> `settings.json`)
- Missing plugins as errors, not warnings
- Automatic shallow cloning for non-overridden plugins
- Target override with symlink bridging

### Current Lace Architecture

The lace CLI preprocesses devcontainer.json before invoking the devcontainer CLI:

- `customizations.lace.*` namespace for lace-specific configuration
- `.lace/` directory for generated/cached artifacts (gitignored)
- `lace prebuild` processes `prebuildFeatures` and rewrites Dockerfile FROM lines
- `lace up` orchestrates prebuild -> resolve -> devcontainer up

### Motivating Use Cases

1. **Claude Plugins**: A developer iterating on a Claude plugin in a sibling repo needs it accessible inside the devcontainer.

2. **Dotfiles**: Personal shell, editor, and tool configurations developed in a separate dotfiles repo should be applicable inside devcontainers.

3. **Shared Libraries**: Local development of a library that another project imports, mounted for hot-reload iteration.

4. **WezTerm Integration**: The lace project's WezTerm plugin requires host-side setup (SSH keys, mux server) and container-side configuration.

## Proposed Solution

### Layer 1: Project-Level Declaration (`customizations.lace.plugins`)

Projects declare plugins by git repo identifier with optional subdirectory. This configuration is version-controlled and portable.

```jsonc
// .devcontainer/devcontainer.json
{
  "customizations": {
    "lace": {
      "plugins": {
        // Standard form: github.com/user/repo
        // Mounts at /mnt/lace/plugins/dotfiles
        "github.com/user/dotfiles": {},

        // With subdirectory: github.com/user/repo/subdir
        // The subdir path is part of the identifier
        "github.com/user/claude-plugins/plugins/my-plugin": {},

        // With explicit alias (for conflict resolution)
        "github.com/user/utils": {
          "alias": "user-utils"  // Mounts at /mnt/lace/plugins/user-utils
        },

        // Another utils repo with different alias
        "github.com/other/utils": {
          "alias": "other-utils"
        }
      }
    }
  }
}
```

**Repo identifier format**: `github.com/user/repo[/subdir/path]`
- Uses normalized git remote URL without protocol
- Subdirectories are appended with `/` (not a separate field)
- Default mount name is derived from the last path segment (repo name or final subdirectory)
- Use `alias` when multiple plugins would have the same derived name

### Layer 2: User-Level Configuration (`~/.config/lace/settings.json`)

Users configure plugin overrides in a consolidated settings file. This replaces the separate `repos.json` from the previous proposal.

```jsonc
// ~/.config/lace/settings.json
{
  "plugins": {
    // Override mount: use local checkout instead of shallow clone
    "github.com/user/dotfiles": {
      "overrideMount": {
        "source": "~/code/personal/dotfiles"
        // readonly defaults to true
        // target uses default /mnt/lace/plugins/dotfiles
      }
    },

    // Override with custom target (symlink created at default location)
    "github.com/user/claude-plugins/plugins/my-plugin": {
      "overrideMount": {
        "source": "~/code/weft/claude-plugins/plugins/my-plugin",
        "target": "/home/mjr/code/weft/claude-plugins/plugins/my-plugin",
        "readonly": false  // Allow writes for active development
      }
    },

    // Minimal override: just specify source
    "github.com/other/utils": {
      "overrideMount": {
        "source": "~/code/forks/utils"
      }
    }
  }
}
```

**Override mount behavior**:
- `source` (required): Local path to mount instead of shallow clone
- `readonly` (optional, default: `true`): Whether to mount read-only
- `target` (optional): Custom container mount target; if specified, lace creates a symlink from the default target (`/mnt/lace/plugins/$name`) to this location

**Discovery order** (for `lace` CLI to find the config):
1. `~/.config/lace/settings.json` (XDG-compliant primary location)
2. `~/.lace/settings.json` (legacy/simple location)
3. Environment variable `LACE_SETTINGS` pointing to a file path (for CI/advanced use cases)
   - Example: `LACE_SETTINGS=/tmp/ci-lace-settings.json lace up`

### Layer 3: Plugin Resolution and Mounting

#### Project Identifier ($project)

The `$project` identifier is used to scope plugin clones per-project, preventing conflicts when different projects need different plugin versions.

**Derivation algorithm**:
1. Take the `--workspace-folder` argument (or auto-detected devcontainer workspace folder)
2. Extract the basename (final directory name)
3. Sanitize: lowercase, replace non-alphanumeric characters with `-`, collapse consecutive `-`

**Examples**:
- `/home/user/code/weft/lace` -> `lace`
- `/home/user/code/My Project!` -> `my-project-`
- `/home/user/code/foo/bar` -> `bar`

**Collision note**: If two projects have the same basename (e.g., `~/code/org1/utils` and `~/code/org2/utils`), they share the same `$project` identifier (`utils`) and thus share plugin clones. This is intentional -- same-named projects at the same plugin version share clones efficiently. If isolation is needed, projects can be renamed or placed in distinctly-named directories.

#### Default Behavior (No Override)

When a plugin has no override in `settings.json`:

1. **Shallow clone**: Lace clones the repo to `~/.config/lace/$project/plugins/$name_or_alias`
   - Uses `git clone --depth 1` for efficiency
   - `$name_or_alias` is the alias if specified, otherwise the derived name (last path segment of repoId)

2. **Clone URL derivation**: From repo identifier to clone URL:
   - `github.com/user/repo[/subdir]` -> `https://github.com/user/repo.git`
   - The subdirectory path is stripped for cloning; the full repo is cloned
   - HTTPS is always used (SSH would require user key configuration)

3. **Branch selection**: Clone the repository's default branch (whatever HEAD points to on the remote)
   - No branch specification in the clone command
   - `git clone --depth 1 <url>` fetches the default branch

4. **Update on resolve**: `lace resolve-mounts` updates existing clones:
   ```bash
   git fetch --depth 1 origin
   git reset --hard origin/HEAD
   ```
   - **On fetch failure (network, auth)**: Warn and continue with cached version
     ```
     Warning: Failed to update plugin 'github.com/user/repo'. Using cached version.
     ```
   - **On reset failure**: Error (indicates corrupted clone; suggest manual cleanup)

5. **Subdirectory handling**: After clone, verify the subdirectory exists if one was specified in the repoId
   - Mount source is `<clone_dir>/<subdirectory>` if subdirectory specified
   - Error if subdirectory doesn't exist in the cloned repo

6. **Mount readonly**: Plugin is mounted at `/mnt/lace/plugins/$name_or_alias` with `readonly` flag

#### Override Behavior

When a plugin has an override in `settings.json`:

1. **Source validation**: Lace validates the source path exists (after tilde expansion)

2. **Mount at target**:
   - If `target` not specified: Mount at `/mnt/lace/plugins/$name_or_alias`
   - If `target` specified: Mount at the custom `target` path

3. **Symlink bridge**: If `target` is specified, lace creates a symlink in the container:
   ```
   /mnt/lace/plugins/$name_or_alias -> $target
   ```
   This allows other code to reference the default path while honoring the custom target.

4. **Readonly**: Respects the `readonly` setting (default: `true`)

#### Symlink Creation Mechanism

When a plugin override specifies a custom `target`, lace needs to create a symlink from the default path to the actual mount location.

**Creation approach**: Inject a command into the extended devcontainer.json's `postCreateCommand` (or merge with existing):

```bash
# For each symlink needed:
mkdir -p "$(dirname '/mnt/lace/plugins/my-plugin')"
rm -f '/mnt/lace/plugins/my-plugin'
ln -s '/home/user/code/plugins/my-plugin' '/mnt/lace/plugins/my-plugin'
```

**Idempotency**: The `rm -f` ensures re-running doesn't fail on existing symlink.

**Parent directories**: The `mkdir -p` ensures the `/mnt/lace/plugins/` directory exists.

**Symlink vs mount directory conflict**: If `/mnt/lace/plugins/$name` already exists as a directory (e.g., from a previous non-override run), the `rm -f` won't remove it. The `ln -s` will fail. This is intentional -- it indicates a configuration change that requires container rebuild.

**Timing**: postCreateCommand runs after the container is created but before the user attaches. This ensures symlinks are in place for postStartCommand, postAttachCommand, and interactive use.

### Lace CLI Commands

#### Updated Command: `lace resolve-mounts`

Replaces `lace resolve-deps` from the previous proposal.

```bash
lace resolve-mounts [--workspace-folder <path>]
```

**Behavior**:

1. Read `devcontainer.json`, extract `customizations.lace.plugins`
2. Read user's `~/.config/lace/settings.json`
3. **Validate no name/alias conflicts**: Error if two plugins would resolve to the same `$name_or_alias`
4. For each declared plugin:
   - If override exists:
     - Validate source path exists
     - Generate mount spec with user's source and optional target
     - Generate symlink spec if target differs from default
   - If no override:
     - Shallow clone (or update) to `~/.config/lace/$project/plugins/$name_or_alias`
     - Generate mount spec with clone path as source
5. Write resolved configuration to `.lace/resolved-mounts.json`
6. Output summary to stdout

**Error conditions**:
- Plugin not in settings.json AND clone fails: Error (missing plugins are fatal)
- Override source path doesn't exist: Error
- Two plugins resolve to same name/alias: Error

**Output format** (`.lace/resolved-mounts.json`):

```jsonc
{
  "version": 2,
  "generatedAt": "2026-02-04T20:00:00Z",
  "plugins": [
    {
      "repoId": "github.com/user/dotfiles",
      "nameOrAlias": "dotfiles",
      "source": "/home/user/.config/lace/myproject/plugins/dotfiles",
      "target": "/mnt/lace/plugins/dotfiles",
      "readonly": true,
      "isOverride": false
    },
    {
      "repoId": "github.com/user/claude-plugins/plugins/my-plugin",
      "nameOrAlias": "my-plugin",
      "source": "/home/user/code/weft/claude-plugins/plugins/my-plugin",
      "target": "/home/user/code/weft/claude-plugins/plugins/my-plugin",
      "readonly": false,
      "isOverride": true,
      "symlink": {
        "from": "/mnt/lace/plugins/my-plugin",
        "to": "/home/user/code/weft/claude-plugins/plugins/my-plugin"
      }
    }
  ],
  "errors": []
}
```

#### Umbrella Command: `lace up`

```bash
lace up [--workspace-folder <path>] [devcontainer-args...]
```

Orchestrates the full workflow:

1. **Prebuild** (if `customizations.lace.prebuildFeatures` configured): Run `lace prebuild`
2. **Resolve mounts** (if `customizations.lace.plugins` declared): Run `lace resolve-mounts`
   - Errors here abort the process
3. **Generate extended config**: Merge resolved mounts and symlink creation into `.lace/devcontainer.json`
4. **Devcontainer up**: Invoke `devcontainer up --config .lace/devcontainer.json`

### Schema Definitions

#### `plugins` Schema (in devcontainer.json)

```typescript
interface PluginsConfig {
  [repoId: string]: PluginOptions;
}

interface PluginOptions {
  /**
   * Explicit name for this plugin, used in mount path.
   * Use when multiple plugins would have the same derived name.
   */
  alias?: string;
}

// repoId format: github.com/user/repo[/subdir/path]
// Derived name: last path segment of repoId
```

#### `settings.json` Schema (user config)

```typescript
interface LaceSettings {
  plugins?: {
    [repoId: string]: PluginSettings;
  };
}

interface PluginSettings {
  overrideMount?: {
    /** Local path to mount (required for override) */
    source: string;

    /** Mount as read-only (default: true) */
    readonly?: boolean;

    /**
     * Custom container mount target.
     * If specified, lace symlinks the default target to this path.
     */
    target?: string;
  };
}
```

## Design Decisions

### D1: Rename devDependencies to plugins

**Decision**: Use `plugins` instead of `devDependencies`.

**Rationale**: "Plugin" better captures the intent -- these are extensions that augment the development environment. "devDependencies" suggests npm-style package dependencies which this is not. The plugin terminology also aligns with the Claude plugins use case.

### D2: Subdirectory in repo identifier

**Decision**: Include subdirectory as part of the repo identifier (`github.com/user/repo/subdir`), not as a separate field.

**Rationale**:
- Cleaner syntax: one string identifies exactly what to mount
- Avoids ambiguity about which part of a monorepo is meant
- The identifier is still unique and self-documenting

### D3: Explicit alias field for conflicts

**Decision**: Use `alias` field when two plugins would have the same derived name.

**Rationale**:
- More explicit than automatic disambiguation (e.g., prefixing with org)
- Developer chooses the name, making configuration more predictable
- Error on conflict rather than silent disambiguation ensures awareness

### D4: Consolidated settings.json

**Decision**: Use `~/.config/lace/settings.json` with a `plugins` field instead of separate `repos.json`.

**Rationale**:
- Single file for all user-level lace configuration
- Allows for future expansion (other settings, defaults, etc.)
- `overrideMount` structure makes the intent clear

### D5: Missing plugins are errors

**Decision**: If a plugin is declared but neither configured in settings.json nor successfully cloned, `lace up` fails.

**Rationale**:
- Ensures container consistency -- either all plugins are present or the container doesn't start
- Prevents subtle bugs from missing plugins
- The previous proposal's "warn and continue" approach leads to unpredictable environments

### D6: Target override with symlink bridge

**Decision**: When `target` is specified, lace mounts at that target and creates a symlink from the default path.

**Rationale**:
- Replaces `mirrorPath` with a more general mechanism
- Allows plugins to use absolute host paths while other code references the default path
- The symlink ensures both paths work in-container

### D7: Shallow clone for non-overridden plugins

**Decision**: Non-overridden plugins are shallow-cloned to `~/.config/lace/$project/plugins/`.

**Rationale**:
- Users don't need full history for plugins they're just consuming
- Saves disk space and clone time
- `resolve-mounts` updates to latest HEAD
- Project-specific caching avoids conflicts between projects needing different versions

### D8: resolve-mounts fails on name conflicts

**Decision**: If two plugins resolve to the same `$name_or_alias`, `lace resolve-mounts` fails with an error.

**Rationale**:
- Silent disambiguation was a complexity source in the previous proposal
- Explicit aliases are clearer and more predictable
- Error messages guide developers to add aliases

## Edge Cases / Challenging Scenarios

### E1: Plugin not in settings.json, clone fails

**Trigger**: Project declares `github.com/user/private-plugin`, user has no override, git clone fails (network, auth).

**Behavior**: Error and abort. Message includes:
```
Error: Failed to clone plugin 'github.com/user/private-plugin'.
Either add an override in ~/.config/lace/settings.json or ensure network/auth is available.

To add an override:
  "github.com/user/private-plugin": {
    "overrideMount": { "source": "/path/to/local/checkout" }
  }
```

### E2: Override source path doesn't exist

**Trigger**: settings.json specifies `"source": "~/code/foo"` but that path doesn't exist.

**Behavior**: Error and abort with clear message:
```
Error: Plugin 'github.com/user/foo' override source does not exist: /home/user/code/foo
```

### E3: Name/alias conflict

**Trigger**: Two plugins resolve to the same name without explicit aliases.
```jsonc
{
  "plugins": {
    "github.com/alice/utils": {},
    "github.com/bob/utils": {}
  }
}
```

**Behavior**: Error with guidance:
```
Error: Plugin name conflict: both 'github.com/alice/utils' and 'github.com/bob/utils'
resolve to name 'utils'. Add explicit aliases:

  "github.com/alice/utils": { "alias": "alice-utils" },
  "github.com/bob/utils": { "alias": "bob-utils" }
```

### E4: Subdirectory doesn't exist

**Trigger**: `github.com/user/repo/nonexistent/subdir` - repo exists but subdirectory doesn't.

**Behavior**: Error after clone:
```
Error: Plugin 'github.com/user/repo/nonexistent/subdir' subdirectory does not exist.
Check the path or remove the plugin declaration.
```

### E5: settings.json doesn't exist

**Trigger**: User runs `lace up` on a project with plugins but no settings.json.

**Behavior**: Proceed with shallow clones for all plugins. If any clone fails, error with setup guidance:
```
Info: No ~/.config/lace/settings.json found. Using automatic cloning for all plugins.

Error: Failed to clone plugin 'github.com/user/private-plugin'.
Create ~/.config/lace/settings.json with overrides for plugins requiring local checkouts.
```

### E6: Symlink target parent doesn't exist

**Trigger**: Override specifies `target: "/home/alice/code/plugins/foo"` but `/home/alice/code/plugins/` doesn't exist in container.

**Behavior**: Lace creates parent directories before creating symlink. Info notice:
```
Info: Creating container directory /home/alice/code/plugins for symlink target
```

### E7: Windows host with Linux container

**Trigger**: Any plugin configuration on Windows host with Linux container.

**Behavior**: Standard mounts work via Docker's path translation. Override targets that mirror Windows paths are not supported:
```
Error: Override target '/c/Users/...' appears to be a Windows-style path.
Custom targets must be valid Linux paths.
```

### E8: Circular clone/update scenarios

**Trigger**: Two projects both declare each other as plugins.

**Non-issue**: Each project's devcontainer resolves independently. When developing A, B is cloned/mounted. When developing B, A is cloned/mounted. No recursive resolution.

### E9: Large repo as plugin

**Trigger**: Plugin repo is very large (monorepo), slowing clone and mount.

**Mitigations**:
- Subdirectory support: `github.com/org/monorepo/packages/just-what-i-need`
- Shallow clone: Only one commit is fetched
- Future: Sparse checkout support (see Open Questions)

## Test Plan

### Unit Tests: settings.json parsing (`src/lib/__tests__/settings.test.ts`)

| Scenario | Expected |
|----------|----------|
| Valid JSON with string paths | Parsed correctly, paths expanded |
| Valid JSON with full plugin config | `overrideMount` fields extracted |
| Tilde expansion (`~/code/...`) | Expanded to absolute path |
| Missing file | Returns null (proceed with clones) |
| Invalid JSON | Error with parse position |
| Empty plugins object | Valid, no overrides |

### Unit Tests: plugins extraction (`src/lib/__tests__/devcontainer.test.ts`)

| Scenario | Expected |
|----------|----------|
| Standard `plugins` | Returns plugin map |
| `plugins` absent | Returns "absent" sentinel |
| `plugins: null` | Returns "null" sentinel |
| `plugins: {}` | Returns empty map |
| With alias | Alias preserved in options |
| With subdirectory in repoId | Subdirectory parsed correctly |

### Unit Tests: name derivation (`src/lib/__tests__/plugins.test.ts`)

| Scenario | Expected |
|----------|----------|
| `github.com/user/repo` | Derives "repo" |
| `github.com/user/repo/subdir` | Derives "subdir" |
| `github.com/user/repo/deep/path` | Derives "path" |
| With explicit alias | Uses alias, not derived name |

### Unit Tests: mount resolution (`src/lib/__tests__/mounts.test.ts`)

| Scenario | Expected |
|----------|----------|
| Single plugin, no override | Clone path as source, default target |
| Single plugin, with override | Override source, default target |
| Override with custom target | Custom target, symlink spec generated |
| Override with readonly: false | Mount spec has no readonly flag |
| Name conflict without aliases | Error thrown |
| Name conflict with aliases | Resolves successfully |

### Unit Tests: symlink generation (`src/lib/__tests__/symlinks.test.ts`)

| Scenario | Expected |
|----------|----------|
| Single symlink needed | Correct shell command generated |
| Multiple symlinks | Commands concatenated with `&&` |
| Path with spaces | Paths properly quoted |
| No symlinks needed | Empty/null command returned |
| Symlink parent creation | mkdir -p included |

### Unit Tests: $project derivation (`src/lib/__tests__/project.test.ts`)

| Scenario | Expected |
|----------|----------|
| Simple path `/home/user/code/lace` | Returns `lace` |
| Path with special chars `/home/user/My Project!` | Returns `my-project-` |
| Nested path `/a/b/c/d` | Returns `d` |
| Trailing slash `/home/user/code/lace/` | Returns `lace` |

### Integration Tests: resolve-mounts command (`src/commands/__tests__/resolve-mounts.integration.test.ts`)

| Scenario | Expected |
|----------|----------|
| Happy path (all overridden) | `.lace/resolved-mounts.json` written correctly |
| Happy path (shallow clones) | Clones created, mounts generated |
| No plugins declared | Info message, no file written |
| Clone failure | Exit non-zero with error |
| Override source missing | Exit non-zero with error |
| Name conflict | Exit non-zero with guidance |

### Integration Tests: lace up with plugins (`src/commands/__tests__/up.integration.test.ts`)

| Scenario | Expected |
|----------|----------|
| Plugins with all overridden | Extended config generated, devcontainer invoked |
| Plugins with clones | Clones created, extended config, devcontainer invoked |
| No plugins | Standard devcontainer up (no mount injection) |
| Resolution failures | Aborts before devcontainer up |

### Manual Verification

1. Create a test settings.json with real local paths
2. Run `lace resolve-mounts` and verify output
3. Run `lace up` and verify:
   - Mounts are present in container (`ls /mnt/lace/plugins/`)
   - Symlinks work when target override is used
   - Clone-based plugins are present and readonly
4. Test with a real Claude plugin that references paths

## Implementation Phases

### Phase 1: Settings File Support

Add `src/lib/settings.ts` module:
- `findSettingsConfig()`: Locate settings.json following discovery order
- `readSettingsConfig(path)`: Parse and validate the file
- `expandPath(path)`: Handle tilde expansion and resolve to absolute

Tests: `src/lib/__tests__/settings.test.ts`

**Success criteria**: Can parse settings.json from standard locations, expand paths correctly.

### Phase 2: Plugins Extraction

Extend `src/lib/devcontainer.ts`:
- `extractPlugins(raw)`: Extract plugins configuration
- Type definitions for `PluginOptions`
- Name derivation logic (from repoId or alias)

Tests: Add cases to `src/lib/__tests__/devcontainer.test.ts`

**Success criteria**: Can extract plugins with all option variations, derive names correctly.

### Phase 3: Plugin Clone Management

Add `src/lib/plugin-clones.ts` module:
- `clonePlugin(repoId, targetDir)`: Shallow clone a plugin repo
- `updatePlugin(cloneDir)`: Update existing clone to latest
- `getClonePath(project, nameOrAlias)`: Resolve clone location

Tests: `src/lib/__tests__/plugin-clones.test.ts`

**Success criteria**: Can clone, update, and locate plugin clones.

### Phase 4: Mount Resolution Logic

Add `src/lib/mounts.ts` module:
- `resolvePluginMounts(plugins, settings, project)`: Core resolution logic
- `validateNoConflicts(plugins)`: Check for name/alias conflicts
- `generateMountSpec(mount)`: Produce devcontainer mount string
- `generateSymlinkSpec(symlink)`: Produce symlink creation command

Tests: `src/lib/__tests__/mounts.test.ts`

**Success criteria**: Given plugins and settings, produces correct mount and symlink specifications.

### Phase 5: resolve-mounts Command

Add `src/commands/resolve-mounts.ts`:
- Wire up parsing, cloning, resolution, and output
- Write `.lace/resolved-mounts.json`
- Handle errors with clear messages

Tests: `src/commands/__tests__/resolve-mounts.integration.test.ts`

**Success criteria**: `lace resolve-mounts` works end-to-end with proper error handling.

### Phase 6: lace up Integration

Extend `src/commands/up.ts`:
- Run `lace resolve-mounts` as part of `lace up` workflow
- Generate extended devcontainer.json with mounts
- Add postCreateCommand entries for symlink creation
- Invoke `devcontainer up` with extended config

Tests: `src/commands/__tests__/up.integration.test.ts`

**Success criteria**: `lace up` transparently resolves and mounts plugins.

### Phase 7: Documentation and Polish

- Update lace CLI help text
- Add setup instructions to README or docs
- Handle edge cases discovered during testing
- Mark superseded proposal as such

## Future Work (RFPs)

### Conditional Plugin Loading (`when` field)

See: [RFP: Plugin Conditional Loading](2026-02-04-rfp-plugin-conditional-loading.md)

A `when` field for conditional plugin inclusion based on context (file presence, env vars, etc.), inspired by VS Code's when-clause expressions.

### Plugin Host Setup and Runtime Scripts

See: [RFP: Plugin Host Setup and Runtime Scripts](2026-02-04-rfp-plugin-host-setup.md)

Allow plugins to declare host-side setup requirements (SSH keys, daemon processes) and provide runtime scripts (environment initialization, post-attach hooks).

## Open Questions

1. **Sparse checkout for large repos**: Should lace support sparse checkout for subdirectory plugins in large monorepos? This would clone only the needed subdirectory. Complexity vs. benefit tradeoff.

2. **Plugin version pinning**: Should plugins support specifying a commit/tag/branch? Currently, non-overridden plugins track HEAD of the default branch. Version pinning adds complexity but improves reproducibility.

3. **Clone cache sharing**: Should clones be shared across projects? Currently, each project has its own clone directory (`~/.config/lace/$project/plugins/`). Sharing saves space but risks conflicts.

4. **Plugin discovery/marketplace**: Should lace support a plugin registry or discovery mechanism? Out of scope for initial implementation but worth considering for the ecosystem.

## Related Documents

- [Dev Dependency Cross-Project Mounts](2026-02-04-dev-dependency-cross-project-mounts.md) - Superseded proposal
- [Dev Dependency Mounts Research](../reports/2026-02-04-dev-dependency-mounts-research.md) - Background research
- [Lace Plugins System Design Decisions](../reports/2026-02-04-lace-plugins-design-decisions.md) - Detailed design rationale
- [packages/lace: Devcontainer Wrapper](2026-01-30-packages-lace-devcontainer-wrapper.md) - Lace CLI architecture
- [Dev Container JSON Reference](https://containers.dev/implementors/json_reference/) - Mount specification
