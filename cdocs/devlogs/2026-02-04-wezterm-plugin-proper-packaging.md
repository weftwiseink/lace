---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T20:30:00-08:00
type: devlog
state: live
status: review_ready
tags: [wezterm, plugin, packaging, distribution, github, migration]
implements: cdocs/proposals/2026-02-04-wezterm-plugin-proper-packaging.md
---

# WezTerm Plugin Proper Packaging Implementation

## Objective

Move the lace wezterm plugin from `config/wezterm/lace-plugin/` to a new GitHub repository `weftwiseink/lace.wezterm` to enable standard wezterm plugin distribution.

Per the proposal, this allows users to load the plugin with:
```lua
wezterm.plugin.require('https://github.com/weftwiseink/lace.wezterm')
```

Instead of the fragile `file://` path approach.

## Background

The wezterm plugin was recently updated with Docker-based discovery (commit fd633e3) as part of the port-scanning implementation. This is the version being packaged.

Repository already created and cloned empty at: `/home/mjr/code/weft/lace.wezterm`

## Implementation Plan

Per the proposal:

1. **Phase 1**: Create new repository structure
   - Copy `plugin/init.lua` to repo root
   - Create README with installation and usage instructions
   - Add LICENSE file (same as lace - MIT)

2. **Phase 2**: Commit to new repository

3. **Phase 3**: Update lace repo
   - Update `config/wezterm/wezterm.lua` to reference the GitHub URL
   - Remove embedded plugin directory
   - Update config/README.md with plugin documentation

4. **Phase 4**: Testing
   - Verify plugin loads from new location

---

## Progress Log

### Entry 1: Initial Setup

Reading the current plugin state at `config/wezterm/lace-plugin/plugin/init.lua`.

Key features preserved:
- Port range 22425-22499 for lace devcontainer SSH servers
- Pre-registration of SSH domains for all ports
- Docker-based project discovery via `docker ps`
- Project picker with InputSelector UI
- Configurable keybinding (default CTRL+SHIFT+P)
- Status bar workspace display (optional)

### Entry 2: Implementation Complete

All phases completed successfully:

1. Created `lace.wezterm` repository structure:
   - `plugin/init.lua` - Complete plugin with Docker-based discovery
   - `README.md` - Installation and usage documentation
   - `LICENSE` - MIT License (same as lace)

2. Pushed to GitHub: https://github.com/weftwiseink/lace.wezterm

3. Updated lace repo:
   - Simplified `config/wezterm/wezterm.lua` to use GitHub URL
   - Added `LACE_WEZTERM_DEV` environment variable override for local development
   - Removed embedded `config/wezterm/lace-plugin/` directory
   - Updated `config/README.md` with plugin documentation section

---

## Implementation Notes

### Plugin URL Loading

The wezterm.lua now uses a simple pattern with optional local override:

```lua
local plugin_url = os.getenv("LACE_WEZTERM_DEV")
  and ("file://" .. os.getenv("LACE_WEZTERM_DEV"))
  or "https://github.com/weftwiseink/lace.wezterm"

local ok, lace_plugin = pcall(wezterm.plugin.require, plugin_url)
```

This allows:
1. Standard users to load from GitHub with automatic caching
2. Plugin developers to set `LACE_WEZTERM_DEV=/path/to/lace.wezterm` for local iteration

### README Documentation

The plugin README includes:
- Quick installation example
- Full configuration options table
- Custom keybinding examples
- Manual discovery API for debugging
- Technical explanation of port range and Docker discovery

---

## Files Created

### lace.wezterm repo

| File | Description |
|------|-------------|
| `plugin/init.lua` | Main plugin (291 lines, Docker-based discovery) |
| `README.md` | User documentation |
| `LICENSE` | MIT License |

### lace repo (changes)

| File | Change |
|------|--------|
| `config/wezterm/wezterm.lua` | Updated to use GitHub URL |
| `config/README.md` | Added plugin documentation section |
| `config/wezterm/lace-plugin/` | Removed (migrated to lace.wezterm) |

---

## Verification

### Plugin Structure Verified

```
lace.wezterm/
├── LICENSE
├── README.md
└── plugin/
    └── init.lua
```

### GitHub Push Successful

Repository available at: https://github.com/weftwiseink/lace.wezterm

### Plugin Loading Test

To test plugin loading from the new location:

1. Restart WezTerm (to clear plugin cache)
2. Check WezTerm logs for: "lace: registered 75 SSH domains for ports 22425-22499"
3. Press CTRL+SHIFT+P to open project picker (will show toast if no containers running)

**Note**: Full testing requires WezTerm restart which cannot be done in this session.

---

## Commits

### lace.wezterm repo

- `90e0ba3` - feat: initial wezterm plugin for lace devcontainer integration

### lace repo

- `1d7b02d` - refactor(wezterm): migrate plugin to weftwiseink/lace.wezterm repo

---

## Success Criteria (per proposal)

| Criterion | Status |
|-----------|--------|
| Plugin loads from GitHub URL | Ready for testing |
| Dotfiles project can use plugin | Documentation provided |
| Old location removed | Done |
| Documentation updated | Done |
