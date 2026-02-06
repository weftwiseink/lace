---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T12:00:00-08:00
task_list: lace/dotfiles-migration
type: proposal
state: archived
status: result_accepted
tags: [dotfiles, devcontainer, chezmoi, wezterm-plugin, migration, lace-plugins]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T18:00:00-08:00
  round: 1
revisions:
  - at: 2026-02-04T19:00:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Disabled keybindings (Leader+D, Leader+W) pending project picker RFP"
      - "Updated plugin path to use dev-deps mount at /mnt/lace/local/dependencies/lace/"
      - "Added dotfiles devcontainer.json devDependencies declaration"
      - "Resolved blocking review issues"
  - at: 2026-02-04T21:00:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Renamed devDependencies to plugins per lace plugins system evolution"
      - "Updated mount path from /mnt/lace/local/dependencies/ to /mnt/lace/plugins/"
      - "Updated terminology: resolve-deps -> resolve-mounts, repos.json -> settings.json"
      - "Noted wezterm lace-plugin extraction deferred to followup work"
      - "Reference: cdocs/reviews/2026-02-04-dev-dependency-cross-project-evolution-review.md"
---

# Dotfiles Migration and Config Extraction

> BLUF: Migrate the dotfiles repository at `/home/mjr/code/personal/dotfiles/` to a lace-style devcontainer with chezmoi-based management, while extracting lace-specific wezterm functionality into a configurable plugin. The migration accomplishes four goals: (1) a minimal devcontainer for safe dotfile iteration using lace's wezterm-server feature for dogfooding, (2) extraction of lace-specific wezterm config into an in-repo plugin with configurable options, (3) migration to chezmoi for agent-safe dotfile management with explicit review steps, and (4) consolidation of personal editor/terminal preferences from lace into dotfiles. The neovim config in lace is purely personal preference and requires no plugin extraction.
>
> **Key Dependencies:**
> - [WezTerm Plugin Research Report](../reports/2026-02-04-wezterm-plugin-research.md)
> - [Chezmoi Migration Research Report](../reports/2026-02-04-chezmoi-migration-research.md)
> - [Neovim Assessment Report](../reports/2026-02-04-neovim-lace-assessment.md)
> - [Dev Dependency Mounts Research](../reports/2026-02-04-dev-dependency-mounts-research.md)
> - [Dev Dependency Cross-Project Mounts Proposal](2026-02-04-dev-dependency-cross-project-mounts.md) (companion proposal, evolving into lace plugins system)
> - [Lace Plugins Evolution Review](../reviews/2026-02-04-dev-dependency-cross-project-evolution-review.md)
>
> **Note:** The wezterm lace-plugin extraction described in Part 2 is deferred to a followup. This proposal focuses on devcontainer setup, chezmoi migration, and config consolidation. The plugin infrastructure (prep scripts, runtime scripts, host setup) is tracked separately.

## Objective

Establish a modern, agent-safe dotfiles management workflow that:

1. Enables safe containerized iteration on dotfile configurations before applying to the host
2. Separates lace infrastructure concerns from personal preferences
3. Provides an explicit review step between agent-authored changes and host application
4. Dogfoods lace devcontainer capabilities (particularly wezterm-server integration)

## Background

### Current State

**Dotfiles Repository (`/home/mjr/code/personal/dotfiles/`):**
- Custom `setup.sh` with `setup_symlink` helper function
- Manages: bashrc, blerc, starship.toml, tmux.conf, firefox chrome/, tridactylrc, vscode configs
- Platform detection via `uname -s` with macOS and Linux branches
- Post-install hooks for dependencies (starship via cargo, blesh git clone, tpm for tmux)
- No devcontainer, no chezmoi
- README notes: "Replace custom scripts with chezmoi if it really is so great"

**Lace Wezterm Config (`config/wezterm/wezterm.lua`):**
Contains a mix of:
- **Lace-specific** (lines 52-86, 148-221): SSH domain config for devcontainer, Leader+D connection keybinding, worktree picker, workspace status bar
- **Personal preference** (lines 13-51, 89-142): Color scheme, fonts, window styling, core keybindings, copy mode

**Lace Neovim Config (`config/nvim/`):**
- LazyVim-based with standard plugins
- Comments reference "matching mjr's" preferences throughout
- **No lace-specific integrations** - purely personal preferences
- Assessed as NOT needing plugin extraction (see research report)

### Motivation for Each Migration Goal

1. **Devcontainer for Dotfiles:** Currently, iterating on dotfiles risks breaking the host environment. A devcontainer provides an isolated environment to test changes.

2. **Wezterm Plugin:** Lace-specific wezterm functionality (SSH domains, worktree picker) should be extractable so other projects can use it, and personal preferences can live in dotfiles.

3. **Chezmoi Migration:** Agent-driven development benefits from a review step. With symlinks, changes are immediately live. Chezmoi's source/apply separation provides this naturally.

4. **Config Consolidation:** Personal preferences scattered across lace should move to dotfiles for proper organization and portability.

## Proposed Solution

### Part 1: Dotfiles Devcontainer

Create a minimal devcontainer in the dotfiles repository that:
- Uses lace's wezterm-server feature for terminal integration (dogfooding)
- Enables safe iteration on dotfile configurations
- Is intentionally minimal (not a full development environment)

**Devcontainer Configuration:**

```jsonc
// dotfiles/.devcontainer/devcontainer.json
{
  "name": "Dotfiles Iteration",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    // Core tools for dotfile development
    "ghcr.io/devcontainers/features/git:1": {},
    // Wezterm server for lace dogfooding
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "version": "20240203-110809-5046fc22"
    },
    // SSH for wezterm domain multiplexing
    "ghcr.io/devcontainers/features/sshd:1": {}
  },
  // Standard wezterm SSH access
  "appPort": ["2222:2222"],
  "mounts": [
    // SSH public key for WezTerm access
    "source=${localEnv:HOME}/.ssh/dotfiles_devcontainer.pub,target=/home/vscode/.ssh/authorized_keys,type=bind,readonly"
  ],
  "postStartCommand": "wezterm-mux-server --daemonize 2>/dev/null || true",
  "customizations": {
    "vscode": {
      "settings": {
        "terminal.integrated.defaultProfile.linux": "bash"
      }
    }
  }
}
```

**Why minimal:**
- Only includes tools needed for dotfile work (git, shell, text editing)
- Not a full dev environment (no Node.js, no language servers beyond basics)
- Chezmoi installed via run_once script rather than feature (testing the dotfiles themselves)

### Part 2: Wezterm Plugin Extraction

Extract lace-specific wezterm functionality into an in-repo plugin at `config/wezterm/lace-plugin/`.

**Plugin Structure:**

```
config/wezterm/
  wezterm.lua                    # Personal config, loads plugin
  lace-plugin/
    plugin/
      init.lua                   # Plugin entry point
```

**Plugin Implementation (`lace-plugin/plugin/init.lua`):**

```lua
local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

-- Configurable defaults
M.defaults = {
  domain_name = "lace",           -- Name of the SSH domain
  ssh_port = "localhost:2222",    -- SSH connection address
  username = "node",              -- Container user
  workspace_path = "/workspace",  -- Where worktrees are mounted
  main_worktree = "main",         -- Default worktree name
  remote_wezterm_path = "/usr/local/bin/wezterm",
  -- NOTE: domain_name "lace" may conflict if multiple projects use this plugin
  -- with different configurations. Future work should consider a namespacing
  -- strategy (e.g., "lace:<project-name>") to avoid collision.
}

local function setup_ssh_domain(config, opts)
  config.ssh_domains = config.ssh_domains or {}
  table.insert(config.ssh_domains, {
    name = opts.domain_name,
    remote_address = opts.ssh_port,
    username = opts.username,
    remote_wezterm_path = opts.remote_wezterm_path,
    multiplexing = "WezTerm",
    ssh_option = {
      identityfile = opts.ssh_key,
    },
  })
end

local function spawn_worktree_workspace(name, opts)
  return act.SwitchToWorkspace({
    name = name,
    spawn = {
      domain = { DomainName = opts.domain_name },
      cwd = opts.workspace_path .. "/" .. name,
    },
  })
end

local function setup_worktree_picker(opts)
  local event_name = "lace.trigger-worktree-picker." .. opts.domain_name

  wezterm.on(event_name, function(window, pane)
    local port = opts.ssh_port:match(":(%d+)$") or "2222"
    local success, stdout = wezterm.run_child_process({
      "ssh", "-p", port,
      "-i", opts.ssh_key,
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      opts.username .. "@localhost",
      "ls", "-1", opts.workspace_path,
    })

    if not success then
      window:toast_notification(opts.domain_name, "Container not running or SSH failed", nil, 3000)
      return
    end

    local choices = {}
    for name in stdout:gmatch("[^\n]+") do
      if not name:match("^%.") and name ~= "node_modules" then
        table.insert(choices, { id = name, label = name })
      end
    end

    window:perform_action(
      act.InputSelector({
        title = "Select Worktree (" .. opts.domain_name .. ")",
        choices = choices,
        action = wezterm.action_callback(function(win, _, id)
          if id then
            win:perform_action(spawn_worktree_workspace(id, opts), pane)
          end
        end),
      }),
      pane
    )
  end)

  return event_name
end

local function setup_status_bar()
  -- Only register once (check if already registered)
  if not M._status_registered then
    wezterm.on("update-status", function(window, pane)
      local workspace = window:active_workspace()
      window:set_left_status(wezterm.format({
        { Background = { Color = "#073642" } },
        { Foreground = { Color = "#2aa198" } },
        { Text = "  " .. workspace .. " " },
      }))
    end)
    M._status_registered = true
  end
end

-- NOTE: Keybindings (Leader+D, Leader+W) are intentionally disabled.
-- When multiple projects use this plugin with different configurations,
-- the keybindings conflict (each overwriting the previous).
-- See RFP: cdocs/proposals/2026-02-04-wezterm-project-picker.md for the
-- planned project picker feature that will provide a unified UI for
-- selecting which project's devcontainer to connect to.
--
-- For now, users can invoke the picker event directly via:
--   wezterm.action.EmitEvent("lace.trigger-worktree-picker.<domain_name>")
local function setup_keybindings(config, opts, picker_event)
  -- Keybindings disabled pending project picker feature
  -- config.keys = config.keys or {}
  -- table.insert(config.keys, { key = "d", mods = "LEADER", action = ... })
  -- table.insert(config.keys, { key = "w", mods = "LEADER", action = ... })
end

function M.apply_to_config(config, opts)
  opts = opts or {}
  for k, v in pairs(M.defaults) do
    if opts[k] == nil then
      opts[k] = v
    end
  end

  -- ssh_key is required
  if not opts.ssh_key then
    wezterm.log_error("lace plugin: ssh_key option is required")
    return
  end

  setup_ssh_domain(config, opts)
  local picker_event = setup_worktree_picker(opts)
  setup_status_bar()
  setup_keybindings(config, opts, picker_event)
end

return M
```

**Host Wezterm Config Loading:**

The plugin path differs between host and container. When the dotfiles devcontainer declares lace as a plugin (via the companion lace plugins proposal), lace is mounted at `/mnt/lace/plugins/lace/`:

```lua
-- dotfiles: dot_config/wezterm/wezterm.lua (after personal preferences)

local function get_lace_plugin_path()
  -- Detect if running in container (REMOTE_CONTAINERS is set by devcontainer)
  local is_container = os.getenv("REMOTE_CONTAINERS") ~= nil
  if is_container then
    -- Lace mounted as plugin at standard lace plugins mount point
    return "file:///mnt/lace/plugins/lace/config/wezterm/lace-plugin"
  else
    -- Host path - user-specific
    return "file://" .. wezterm.home_dir .. "/code/weft/lace/config/wezterm/lace-plugin"
  end
end

local ok, lace = pcall(wezterm.plugin.require, get_lace_plugin_path())
if ok then
  lace.apply_to_config(config, {
    ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
    domain_name = "lace",
    ssh_port = "localhost:2222",
  })
else
  wezterm.log_warn("Failed to load lace plugin: " .. tostring(lace))
end
```

**Dotfiles devcontainer.json addition:**

```jsonc
{
  "customizations": {
    "lace": {
      "plugins": {
        // Declares lace as a plugin for wezterm plugin access
        "github.com/weftwiseink/lace": {}
      }
    }
  }
}
```

This approach validates the lace plugins feature by using dotfiles as its first customer. The plugin is mounted (readonly by default) at `/mnt/lace/plugins/lace/`. Users can override the mount source via `~/.config/lace/settings.json` if they have a local checkout.

### Part 3: Chezmoi Migration

Migrate the dotfiles repository from symlink-based `setup.sh` to chezmoi.

**Migration Steps:**

1. **Initialize Chezmoi:**
   ```bash
   cd ~/code/personal/dotfiles
   chezmoi init --source .
   ```

2. **Add Existing Files (following symlinks):**
   ```bash
   chezmoi add --follow ~/.bashrc
   chezmoi add --follow ~/.blerc
   chezmoi add --follow ~/.config/starship.toml
   chezmoi add --follow ~/.tmux.conf
   chezmoi add --follow ~/.config/tridactyl/tridactylrc
   # VSCode handled separately due to platform variance
   ```

3. **Convert Platform Logic to Templates:**

   Create `.chezmoiignore` for platform-specific files:
   ```
   {{- if ne .chezmoi.os "darwin" }}
   .config/karabiner/
   {{- end }}
   {{- if ne .chezmoi.os "linux" }}
   # Linux-specific exclusions
   {{- end }}
   ```

4. **Convert Install Hooks to run_once Scripts:**

   ```bash
   # .chezmoiscripts/run_once_before_10-install-starship.sh
   #!/bin/bash
   if ! command -v starship &> /dev/null; then
       cargo install starship --locked
   fi
   ```

   ```bash
   # .chezmoiscripts/run_once_before_20-install-blesh.sh
   #!/bin/bash
   BLESH_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/blesh"
   if [ ! -d "$BLESH_DIR" ]; then
       mkdir -p "$BLESH_DIR/src"
       git clone --recursive https://github.com/akinomyoga/ble.sh.git "$BLESH_DIR/src"
       make -C "$BLESH_DIR/src" install PREFIX=~/.local
   fi
   ```

5. **Archive Old setup.sh:**
   Rename to `setup.sh.archive` with a note pointing to chezmoi.

**Chezmoi Source Structure:**

```
dotfiles/
  .chezmoi.toml.tmpl           # Machine-specific config template
  .chezmoiignore               # Platform-specific exclusions
  .chezmoiscripts/
    run_once_before_10-install-starship.sh
    run_once_before_20-install-blesh.sh
    run_once_after_10-install-tpm.sh
  dot_bashrc.tmpl              # Templated for platform differences
  dot_blerc
  dot_config/
    starship.toml
    tridactyl/
      tridactylrc
    wezterm/
      wezterm.lua              # Personal wezterm config (loads lace plugin)
    nvim/                      # Migrated from lace
      init.lua
      lua/plugins/
        ...
  dot_tmux.conf
  .devcontainer/
    devcontainer.json
```

### Part 4: Personal Config Migration

Move personal configurations from lace to dotfiles:

**Neovim Config:**
- Copy `lace/config/nvim/` to dotfiles as chezmoi-managed `dot_config/nvim/`
- Remove from lace (or keep as a reference/fallback)
- Update comments to clarify this is personal config, not lace infrastructure

**Wezterm Personal Config:**
- Create `dot_config/wezterm/wezterm.lua` in dotfiles with:
  - Personal appearance settings (color scheme, font, window styling)
  - Personal keybindings (pane navigation, splits, tabs)
  - Plugin loading for lace (and future project plugins)
- Remove personal preferences from lace's `config/wezterm/wezterm.lua`
- Lace's wezterm.lua becomes just the plugin, or a minimal config that loads the plugin

**Container-Side Wezterm Config:**
- `.devcontainer/wezterm.lua` remains in lace (sets default_cwd for mux server)
- This is infrastructure, not personal preference

## Important Design Decisions

### Decision 1: In-Repo Plugin vs Separate Repository

**Decision:** Keep the wezterm lace plugin in the lace repository at `config/wezterm/lace-plugin/`.

**Why:**
- Single repository, no external dependencies for lace contributors
- Version-controlled alongside the devcontainer configuration it supports
- Can be extracted to a separate repo later if demand warrants
- Local `file://` protocol is well-supported by WezTerm

### Decision 2: Configurable Plugin Options

**Decision:** Plugin accepts options (domain_name, ssh_port, etc.) rather than hardcoding values.

**Why:**
- Enables reuse across projects (dotfiles devcontainer can use same plugin with different options)
- User's stated preference for configurability
- Hardcoded values would require forking for any customization

**Note on `domain_name`:** The default "lace" could conflict if a user connects to multiple project devcontainers simultaneously. A future enhancement could namespace domains by project (e.g., `lace:dotfiles`, `lace:myproject`). For now, users can set different `domain_name` values per project.

### Decision 3: Minimal Dotfiles Devcontainer

**Decision:** The dotfiles devcontainer is intentionally minimal, not a full development environment.

**Why:**
- User stated this should be minimal but include wezterm-server for dogfooding
- Full dev environments belong in project-specific devcontainers
- Dotfiles iteration needs shell, git, and a text editor - not language servers or build tools
- Keeps the devcontainer fast to start and low-maintenance

### Decision 4: Chezmoi Over Custom Scripts

**Decision:** Use chezmoi rather than enhancing the existing setup.sh.

**Why:**
- Provides natural source/apply separation for agent-safe workflows
- `chezmoi diff` and `chezmoi apply -nv` give the review step requested
- Mature, well-documented tool with active development
- Handles templating, encryption, and cross-platform concerns built-in
- User's README already noted interest in chezmoi

### Decision 5: No Neovim Plugin

**Decision:** Do not extract a lace-neovim plugin. Move nvim config to dotfiles.

**Why:**
- Assessment found zero lace-specific code in the nvim configuration
- It's purely personal preferences (solarized theme, keybindings, plugins)
- Creating an empty/placeholder plugin adds complexity without benefit
- If lace-specific nvim features are desired later, build from scratch

## Edge Cases / Challenging Scenarios

### Plugin Path Resolution

The lace plugin path differs between host (`~/code/weft/lace/...`) and container.

**Solution:** The dotfiles devcontainer declares lace as a plugin, which mounts it at `/mnt/lace/plugins/lace/`. Environment detection (`REMOTE_CONTAINERS`) determines context and selects the appropriate path. Wrap `plugin.require` in `pcall` for graceful failure.

This approach:
- Makes dotfiles the first customer of the lace plugins feature
- Provides a consistent, lace-controlled mount point in all containers
- Removes hardcoded assumptions about workspace structure (`/workspace/main/lace`)
- Users can configure local overrides via `~/.config/lace/settings.json` for development

### Plugin Update After Changes

WezTerm caches plugins. After modifying the lace plugin, users must run `wezterm.plugin.update_all()` (via Debug Overlay or config reload).

**Solution:** Document this in the plugin README. Consider adding a Leader+R+U keybinding that calls update_all.

### Multiple Devcontainer Connections

If a user has multiple devcontainers running with different SSH ports, the plugin's default port may conflict.

**Solution:** Each project's wezterm config specifies unique `domain_name` and `ssh_port` options. Document this pattern.

### Chezmoi + Devcontainer Bind Mount

When developing dotfiles in a devcontainer with the dotfiles repo bind-mounted, chezmoi's source state is inside the container but the destination state (home directory) is container-local.

**Solution:** This is actually the desired behavior. Agent edits source state in container. User reviews via `chezmoi diff` on host (where the source state is also visible via bind mount) and applies with `chezmoi apply` on host.

### Existing Symlinks During Migration

Running `chezmoi apply` will replace existing symlinks with regular files.

**Solution:** Document that this is intentional. The symlinks were the old system; chezmoi manages files directly. Backup before migration if concerned.

## Test Plan

### Wezterm Plugin Tests

1. **Unit Tests (Manual):**
   - Load plugin with various option combinations
   - Verify SSH domain is added to config
   - Verify event handler is set up for worktree picker
   - Verify status bar workspace display

2. **Integration Tests (Manual):**
   - Start lace devcontainer
   - Load wezterm config with plugin
   - Manually trigger picker event via Debug Overlay to verify worktree picker works
   - Verify SSH domain connects to container

3. **Error Handling:**
   - Load plugin without ssh_key option, verify error logged
   - Load plugin with container not running, verify toast notification

**Note:** Keybindings (Leader+D, Leader+W) are disabled pending the project picker feature. See RFP: `cdocs/proposals/2026-02-04-wezterm-project-picker.md`.

### Chezmoi Migration Tests

1. **File Mapping Verification:**
   - After `chezmoi apply`, verify each file exists at target location
   - Compare content with original dotfiles repo content

2. **Template Rendering:**
   - Run `chezmoi apply` on Linux, verify Linux-specific content
   - Run `chezmoi apply` on macOS (if available), verify macOS-specific content

3. **run_once Scripts:**
   - Verify starship installed after first apply
   - Verify blesh installed after first apply
   - Run apply again, verify scripts don't re-run (idempotent)

4. **Review Workflow:**
   - Make a change to source state
   - Run `chezmoi diff`, verify diff shown
   - Run `chezmoi apply -nv`, verify dry-run output
   - Run `chezmoi apply`, verify change applied

### Devcontainer Tests

1. **Container Build:**
   - `devcontainer build` succeeds
   - All features install correctly

2. **Wezterm Integration:**
   - wezterm-mux-server running after postStartCommand
   - SSH connection works from host
   - `wezterm connect dotfiles` connects (with plugin configured)

3. **Dotfiles Iteration:**
   - Can edit files in /workspaces/dotfiles
   - Changes visible on host via bind mount
   - chezmoi commands work inside container

## Implementation Phases

### Phase 1: Wezterm Plugin Scaffold

Create the plugin structure and basic functionality.

**Tasks:**
- Create `config/wezterm/lace-plugin/plugin/init.lua`
- Implement `apply_to_config` with SSH domain setup
- Add configurable options with defaults
- Write basic documentation in plugin README
- Update existing `config/wezterm/wezterm.lua` to load plugin

**Success Criteria:**
- Plugin loads without errors
- SSH domain "lace" appears in wezterm config
- Existing lace devcontainer workflow unchanged

**Constraints:**
- Do not remove code from existing wezterm.lua yet (keep working state)
- Keep backward compatibility during transition

### Phase 2: Wezterm Plugin Full Implementation

Complete plugin with events and status bar (keybindings deferred to project picker RFP).

**Tasks:**
- Implement worktree picker event handler
- Implement status bar workspace display
- Add placeholder keybinding function (disabled, with RFP reference)
- Handle host vs container path detection
- Add error handling with pcall wrapper

**Success Criteria:**
- Worktree picker event can be triggered manually
- Status bar shows workspace name
- SSH domain connects to devcontainer
- Graceful failure if container not running

**Note:** Keybindings are intentionally disabled. See RFP: `cdocs/proposals/2026-02-04-wezterm-project-picker.md`.

### Phase 3: Dotfiles Devcontainer Setup

Create minimal devcontainer in dotfiles repository.

**Tasks:**
- Create `.devcontainer/devcontainer.json` with minimal config
- Add wezterm-server feature for lace dogfooding
- Configure SSH access (port 2223 to avoid conflict with lace)
- Create `bin/open-dotfiles-workspace` script (adapted from lace)
- Test container build and wezterm connection

**Success Criteria:**
- `devcontainer up` succeeds
- wezterm-mux-server running
- Can connect via `wezterm connect dotfiles` (with appropriate config)

**Constraints:**
- Use different SSH port (2223) than lace (2222) to allow concurrent use

### Phase 4: Chezmoi Initialization

Initialize chezmoi and migrate core files.

**Tasks:**
- Run `chezmoi init` in dotfiles repo
- Add core files: bashrc, blerc, starship.toml, tmux.conf
- Convert setup_symlink hooks to run_once scripts
- Create `.chezmoiignore` for platform-specific files
- Test `chezmoi apply` on a clean system (or container)

**Success Criteria:**
- `chezmoi apply` creates all managed files
- run_once scripts install dependencies correctly
- No errors during apply

**Constraints:**
- Preserve existing setup.sh as .archive until chezmoi proven

### Phase 5: Personal Config Migration

Move personal configs from lace to dotfiles.

**Tasks:**
- Copy `lace/config/nvim/` to dotfiles as `dot_config/nvim/`
- Create `dot_config/wezterm/wezterm.lua` with personal preferences + plugin loading
- Update chezmoi to manage these new files
- Remove or archive personal configs from lace
- Update lace `config/wezterm/wezterm.lua` to be plugin-only

**Success Criteria:**
- Neovim config applies correctly from dotfiles
- Wezterm config loads lace plugin from dotfiles
- Lace repository contains only infrastructure, not personal preferences

### Phase 6: Documentation and Cleanup

Finalize documentation and remove deprecated code.

**Tasks:**
- Write plugin README with usage examples
- Update lace README to reference plugin pattern
- Update dotfiles README with chezmoi usage
- Archive old setup.sh
- Remove deprecated code paths

**Success Criteria:**
- New contributor can understand and use the plugin
- Existing lace users can migrate smoothly
- Dotfiles users understand chezmoi workflow

## Open Questions

1. **SSH Key Naming:** Should dotfiles devcontainer use `~/.ssh/dotfiles_devcontainer` or share `~/.ssh/lace_devcontainer`? Separate keys are cleaner but require additional setup.

2. **Wezterm Plugin Distribution:** If other projects want to use the lace wezterm plugin, should we publish it to a separate repository for easier consumption? For now, keeping it in-repo is simpler.

3. **Chezmoi Encryption:** Should any dotfiles be encrypted (e.g., gitconfig with email)? The research report covers this but no immediate secrets were identified in the current dotfiles.

4. **~~Dev Dependencies Integration~~** *(Resolved)*: The dotfiles devcontainer will declare lace as a plugin using the `customizations.lace.plugins` schema. Lace is mounted at `/mnt/lace/plugins/lace/`, providing access to the wezterm plugin. This makes dotfiles the first customer of the lace plugins feature. The `lace resolve-mounts` command handles plugin resolution, and users can configure local mount overrides via `~/.config/lace/settings.json`.
