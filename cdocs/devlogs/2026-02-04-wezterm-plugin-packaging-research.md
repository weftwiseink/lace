---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T18:00:00-05:00
type: devlog
state: archived
status: done
tags: [wezterm, plugin, packaging, distribution, github]
---

# WezTerm Plugin Packaging and Distribution Research

## Objective

Research proper WezTerm plugin packaging and distribution to determine where the lace wezterm plugin should live to be referenceable as a proper wezterm plugin per the official documentation. Create an approved proposal for the plugin location and migration path.

## Background

The current lace wezterm plugin lives at `/var/home/mjr/code/weft/lace/config/wezterm/lace-plugin/`. It is referenced via the `file://` protocol which requires absolute paths and doesn't work well across different machines or for sharing with others. The dotfiles project at `/home/mjr/code/personal/dotfiles/` uses this plugin.

## Research Summary

### WezTerm Plugin System Overview

From the official documentation at https://wezterm.org/config/plugins.html:

1. **Supported URL Schemes**: `https://` and `file://` protocols only
2. **GitHub Integration**: `wezterm.plugin.require('https://github.com/owner/repo')` clones the repo locally
3. **Directory Structure**: Requires `plugin/init.lua` as the entry point
4. **Versioning**: No tag/version support - always uses default branch

### Current Plugin State

The existing plugin at `config/wezterm/lace-plugin/`:
- Has correct structure (`plugin/init.lua`)
- Exports `apply_to_config(config, opts)` per convention
- Uses `file://` protocol for loading
- Path varies between host and container environments

### Current Usage in Dotfiles

From `/home/mjr/code/personal/dotfiles/dot_config/wezterm/wezterm.lua`:
```lua
local function get_lace_plugin_path()
  local is_container = os.getenv("REMOTE_CONTAINERS") ~= nil
  if is_container then
    return "file:///mnt/lace/plugins/lace/config/wezterm/lace-plugin"
  else
    return "file://" .. wezterm.home_dir .. "/code/weft/lace/config/wezterm/lace-plugin"
  end
end
```

This approach has several issues:
1. Hardcodes user's directory structure
2. Requires different paths per environment
3. Cannot be shared as a proper plugin
4. No portability to other users/machines

### Options Considered

#### Option 1: Keep as Local Plugin (Current State)
- **Pros**: No external dependencies, version controlled with lace
- **Cons**: Not portable, path gymnastics required, cannot share

#### Option 2: Separate GitHub Repository
- **Pros**: Standard wezterm plugin distribution, portable, shareable
- **Cons**: Repository proliferation, separate versioning

#### Option 3: Reference Subdirectory via GitHub URL
- **Evaluation**: WezTerm's plugin system clones the entire repo at the root. A URL like `https://github.com/weftwiseink/lace/config/wezterm/lace-plugin` would NOT work - it would clone the lace repo and look for `plugin/init.lua` at the root level.

#### Option 4: Root-Level Plugin in Lace Monorepo
- **Evaluation**: Would require restructuring lace repo to have `plugin/init.lua` at root - this conflicts with lace's purpose as a devcontainer CLI tool.

### Recommendation

**Option 2: Separate GitHub Repository** is the only viable path for proper wezterm plugin packaging.

The plugin should be published to a new repository (e.g., `weftwiseink/lace.wezterm`) following the wezterm plugin naming convention (`*.wezterm`).

## Progress Log

### Session 1: 2026-02-04 18:00

1. Read prior research at `cdocs/reports/2026-02-04-wezterm-plugin-research.md`
2. Fetched official wezterm plugin documentation
3. Analyzed current plugin structure and usage in dotfiles
4. Evaluated distribution options
5. Created proposal at `cdocs/proposals/2026-02-04-wezterm-plugin-proper-packaging.md`

### Session 1 continued: Review Cycles

**Round 1 Review:**
- Identified blocking issue: proposal contradicted earlier research without explanation
- Non-blocking suggestions: add alternatives section, clarify local development, clarify Phase 3

**Revisions Made:**
- Added "Evolution from Prior Research" section explaining why requirements changed
- Added "Alternatives Considered" section covering rejected approaches
- Expanded local development options to three approaches
- Clarified Phase 3 cleanup instructions

**Round 2 Review:**
- All blocking issues resolved
- Verdict: Accept

## Deliverables

1. **Devlog**: `cdocs/devlogs/2026-02-04-wezterm-plugin-packaging-research.md` (this document)
2. **Proposal**: `cdocs/proposals/2026-02-04-wezterm-plugin-proper-packaging.md` (accepted)
3. **Reviews**:
   - `cdocs/reviews/2026-02-04-review-of-wezterm-plugin-proper-packaging.md` (round 1)
   - `cdocs/reviews/2026-02-04-review-of-wezterm-plugin-proper-packaging-round2.md` (round 2, accepted)

## Status

**Done** - Proposal accepted. Ready for implementation.
