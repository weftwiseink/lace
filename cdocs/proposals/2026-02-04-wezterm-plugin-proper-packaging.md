---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T18:00:00-05:00
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T18:45:00-05:00
  round: 2
type: proposal
state: live
status: deferred
tags: [wezterm, plugin, packaging, distribution, github, migration]
---

# WezTerm Plugin Proper Packaging and Distribution

> BLUF: Move the lace wezterm plugin from `config/wezterm/lace-plugin/` to a new GitHub repository `weftwiseink/lace.wezterm` to enable standard wezterm plugin distribution. This allows users to load the plugin with `wezterm.plugin.require('https://github.com/weftwiseink/lace.wezterm')` instead of fragile `file://` paths.

## Objective

Enable the lace wezterm plugin to be referenced as a proper, distributable wezterm plugin that:
1. Can be loaded with a standard GitHub URL
2. Works identically across all machines without path customization
3. Follows wezterm plugin naming conventions
4. Can be shared with other users

## Background

### Evolution from Prior Research

The earlier research document (`cdocs/reports/2026-02-04-wezterm-plugin-research.md`) recommended keeping the plugin within the lace repository using the `file://` protocol. That recommendation was appropriate for its stated goal: "clean separation of lace-specific WezTerm configuration" without "repository proliferation."

However, this proposal addresses a different requirement: making the plugin **distributable and shareable**. The `file://` approach works for a single developer on a single machine, but breaks down when:
- Multiple machines need the same configuration
- Other users want to use the plugin
- The dotfiles repo needs portability across environments

The constraints of WezTerm's plugin system (no subdirectory support, `plugin/init.lua` must be at repo root) mean that a separate repository is the only path to proper distribution.

### Current State

The lace wezterm plugin currently lives at `config/wezterm/lace-plugin/` within the lace monorepo. It must be loaded via the `file://` protocol:

```lua
-- Current usage (fragile, environment-specific)
local lace = wezterm.plugin.require("file://" .. wezterm.home_dir .. "/code/weft/lace/config/wezterm/lace-plugin")
```

This approach requires:
- Hardcoded user-specific paths
- Environment detection for host vs container
- No portability to other users or machines

### WezTerm Plugin System Constraints

WezTerm's plugin system has specific behaviors:
1. **URL schemes**: Only `https://` and `file://` are supported
2. **Repository structure**: When loading from GitHub, WezTerm clones the entire repository and looks for `plugin/init.lua` at the root
3. **No subdirectory support**: A URL like `https://github.com/user/repo/path/to/plugin` does NOT work
4. **Versioning**: No tag or branch pinning - always uses the default branch

### Why a Separate Repository is Required

Given the constraint that WezTerm requires `plugin/init.lua` at the repository root, there are only two options:

1. **Restructure lace repo**: Put `plugin/init.lua` at lace's root - this is unacceptable as it would conflict with lace's purpose as a devcontainer CLI
2. **Separate repository**: Create a dedicated plugin repository - this is the standard approach used by the wezterm plugin ecosystem

## Proposed Solution

### Repository Structure

Create a new repository: `github.com/weftwiseink/lace.wezterm`

```
lace.wezterm/
  plugin/
    init.lua          # Main plugin (copied from current lace-plugin)
  README.md           # User-facing documentation
  LICENSE             # Same license as lace
```

The `.wezterm` suffix follows the ecosystem naming convention (e.g., `smart_workspace_switcher.wezterm`, `resurrect.wezterm`).

### Plugin Loading

After migration, users load the plugin with:

```lua
-- New usage (portable, standard)
local lace = wezterm.plugin.require('https://github.com/weftwiseink/lace.wezterm')
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
})
```

### Migration Path for Dotfiles

The dotfiles project needs a simple update to its wezterm config:

**Before:**
```lua
local function get_lace_plugin_path()
  local is_container = os.getenv("REMOTE_CONTAINERS") ~= nil
  if is_container then
    return "file:///mnt/lace/plugins/lace/config/wezterm/lace-plugin"
  else
    return "file://" .. wezterm.home_dir .. "/code/weft/lace/config/wezterm/lace-plugin"
  end
end

local ok, lace_plugin = pcall(wezterm.plugin.require, get_lace_plugin_path())
```

**After:**
```lua
local ok, lace_plugin = pcall(
  wezterm.plugin.require,
  'https://github.com/weftwiseink/lace.wezterm'
)
```

### Local Development Override

For local plugin development, there are three approaches:

**Option A: Direct cache editing (quickest iteration)**
WezTerm caches plugins in `~/.local/share/wezterm/plugins/`. Edit the plugin directly there for immediate changes without needing `update_all()`.

**Option B: Plugin update mechanism**
1. Clone `lace.wezterm` locally and make changes
2. Run `wezterm.plugin.update_all()` via Debug Overlay to sync changes from your local clone to WezTerm's cache

**Option C: Environment variable override**
Temporarily switch to `file://` protocol for development:

```lua
-- For local development only
local plugin_url = os.getenv("LACE_WEZTERM_DEV")
  and ("file://" .. os.getenv("LACE_WEZTERM_DEV"))
  or "https://github.com/weftwiseink/lace.wezterm"
```

## Alternatives Considered

### Keep as Local Plugin (`file://`)
The current approach. Works for single-developer use but requires environment-specific path detection and cannot be shared. Rejected for distribution goals.

### Git Submodule
Embed the plugin repo as a submodule within lace. This still requires the plugin to be a separate repo (submodules are just references), so it offers no advantage over the proposed solution while adding submodule complexity.

### Symlink from XDG Location
Symlink `~/.local/share/wezterm/plugins/lace.wezterm` to the local checkout. This works for one machine but doesn't help with distribution or portability across machines.

### Restructure Lace Monorepo
Put `plugin/init.lua` at lace's root. Rejected because lace is a devcontainer CLI tool, not a wezterm plugin. The repo structure should reflect its primary purpose.

### npm/luarocks Packaging
WezTerm's plugin system only supports `https://` and `file://` URLs. Package managers like npm or luarocks are not supported for plugin distribution.

## Design Decisions

### Repository Name: `lace.wezterm`

The name follows the `<project>.wezterm` convention established by the community. Alternatives considered:
- `wezterm-lace-plugin` - doesn't follow convention
- `lace-wezterm` - could be confused with a wezterm build/fork
- `lace.wezterm` - matches `resurrect.wezterm`, `smart_workspace_switcher.wezterm`

### Single File vs Multi-File Plugin

The current plugin is a single `init.lua` file (243 lines). This is appropriate for the current scope. If the plugin grows significantly, it can be split into modules later without changing the public API.

### Keep Original in Lace Repo?

**Recommendation: Remove from lace repo after migration.**

Keeping both locations creates:
- Maintenance burden (two copies to update)
- Confusion about which is canonical
- Risk of divergence

The plugin should be fully migrated to the new repository.

### Interaction with Lace Plugins System

The lace plugins system (`customizations.lace.plugins`) mounts external lace repos into devcontainers. This is orthogonal to wezterm plugin packaging:

- The wezterm plugin runs on the **host**, not in the container
- The lace plugins system handles **devcontainer mounts**
- These solve different problems and don't conflict

## Edge Cases

### Offline Development

If wezterm cannot reach GitHub, the plugin won't load on first use. However:
- WezTerm caches plugins locally after first clone
- Subsequent loads work offline
- Graceful fallback (pcall wrapper) prevents config errors

### Plugin Updates

Users must explicitly call `wezterm.plugin.update_all()` to fetch upstream changes. This is wezterm's design, not a limitation of this proposal.

### Container Environment

The wezterm plugin is for the **host** wezterm config, not for use inside containers. The container's wezterm-mux-server doesn't need this plugin - it's the connection target, not the initiator.

## Implementation Phases

### Phase 1: Create New Repository

1. Create `github.com/weftwiseink/lace.wezterm`
2. Copy `plugin/init.lua` from current location
3. Create README with installation and usage instructions
4. Add LICENSE file

### Phase 2: Update Dotfiles

1. Update `dotfiles/dot_config/wezterm/wezterm.lua` to use GitHub URL
2. Remove environment detection and path gymnastics
3. Test plugin loads correctly

### Phase 3: Clean Up Lace Repo

1. Remove `config/wezterm/lace-plugin/` directory
2. Update any documentation referencing the old location
3. Update `config/wezterm/wezterm.lua` to reference the GitHub URL as a working example, or remove it if the dotfiles config is now the canonical reference

### Phase 4: Documentation

1. Update lace README to reference the published plugin
2. Document the plugin in the new repository's README
3. Optionally submit to wezterm plugin directories/lists

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Repository proliferation | Single, focused repository with clear purpose |
| Maintenance burden | Plugin is stable; minimal ongoing changes expected |
| Breaking existing users | Deprecation period with clear migration instructions |
| Version coordination | Plugin is independent; lace version doesn't affect plugin |

## Success Criteria

1. Plugin loads successfully from GitHub URL
2. Dotfiles project migrated and working
3. Old location removed from lace repo
4. Documentation updated in both repositories
