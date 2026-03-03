---
title: "WezTerm Config and Plugin State"
first_authored:
  by: "@claude"
  at: "2026-03-01T12:00:00-06:00"
task_list: null
type: report
state: archived
status: done
tags: [analysis, wezterm, architecture, state-of-the-world]
related_to:
  - cdocs/reports/2026-02-28-tab-oriented-wezterm-integration.md
  - cdocs/reports/2026-02-10-lace-wezterm-setup-status.md
  - cdocs/reports/2026-02-28-wezterm-tab-title-pinning.md
  - cdocs/reports/2026-02-04-wezterm-plugin-research.md
---

# WezTerm Config and Plugin State

## > BLUF

The WezTerm configuration is a single 603-line Lua file managed by chezmoi,
currently in sync between source and deployed locations. It integrates two
plugins (lace.wezterm for devcontainer access, resurrect.wezterm for session
persistence) and one inline integration (smart-splits for Neovim pane
navigation). The lace.wezterm plugin source repo is 2 commits ahead of the
plugin cache's git history, but the actual init.lua file content is identical
(md5 `b7213a5e61b327367ee41dbdd2665500`), meaning WezTerm's file:// plugin
loader copies working tree content rather than checking out a specific commit.
The resurrect plugin writes periodic JSON state to
`~/.local/share/wezterm/resurrect/` across three subdirectories (workspace,
window, tab). The main workspace state shows 8 tabs including several lace
domain tabs with empty CWDs, indicating the resurrect plugin captures SSH
domain tabs but cannot meaningfully restore them (the remote mux must be
running independently).

## Design Choices in the WezTerm Config

### Color and Appearance

The config defines a custom "Slate" palette -- a greyscale replacement for
Solarized's base colors while keeping Solarized accent colors for syntax
highlighting. The base color scheme (`Solarized Dark (Gogh)`) provides the 16
ANSI color definitions, but backgrounds, chrome, tab bar colors, cursor, and
selection are all overridden by the slate palette. This is a hybrid approach:
solarized semantics for terminal output, custom greyscale for the WezTerm UI
chrome.

Font rendering uses `NO_HINTING` with DemiBold weight to compensate for thin
strokes -- a deliberate tradeoff against FreeType hinting to avoid subpixel
rendering inconsistencies (WezTerm issue #3774). Ligatures are explicitly
disabled.

### Keybinding Philosophy

The keybinding design is modeled on tmux conventions but adapted for WezTerm's
modal structure:

- **Ctrl+H/J/K/L**: Pane navigation, smart-splits aware (passes through to
  Neovim if the active pane is an nvim process)
- **Ctrl+Alt+H/J/K/L**: Pane resizing, also smart-splits aware
- **Alt+H/J/K/L**: Create splits in the corresponding direction
- **Alt+N/P**: Tab cycling; **Alt+Shift+N**: New tab
- **Alt+C**: Enter copy mode
- **Alt+W**: Close pane (with confirmation)
- **Leader (Alt+Z)**: Prefix for workspace/session commands
  - Leader+S: Fuzzy workspace picker
  - Leader+1/2/3: Quick workspace access (main, feature, scratch)
  - Leader+Z: Toggle pane zoom
  - Leader+W: Lace project picker
  - Leader+D: Detach from mux domain
  - Leader+R: Reload configuration
  - Leader+`:`: Command palette

The leader key has a 1-second timeout. There is no overlap between Alt
bindings and Leader bindings. The smart-splits integration uses the
`IS_NVIM` user variable (set by the Neovim side) to decide whether to forward
keys or handle them natively.

### Smart-Splits: Neovim/WezTerm Pane Navigation

The smart-splits integration goes beyond basic passthrough. When navigating
from a WezTerm pane into a Neovim pane, it sends a `FocusFromEdge <direction>`
command via synthetic keystrokes to focus the correct Neovim split based on
entry direction. This uses `<C-\><C-n>` to force normal mode (avoiding
buffer-local Escape mappings in pickers), then sends the command character by
character. This is a custom protocol that requires a corresponding
`FocusFromEdge` command on the Neovim side.

### Mouse Selection Model

Mouse bindings route all selections to PrimarySelection only, following the
Linux convention (mouse select -> primary, explicit copy -> clipboard). Single,
double, and triple clicks all trigger a `mouse_select_into_copy_mode` callback
that saves to PrimarySelection and then enters copy mode, creating a seamless
select-then-yank workflow. If already in copy mode, mouse clicks just update
the PrimarySelection without mode transitions.

### Copy Mode Customization

Copy mode overrides are built on top of `wezterm.gui.default_key_tables()`,
preserving all default bindings and only modifying specific ones:

- **y**: Yank to clipboard+primary, scroll to bottom, exit
- **Y (Shift)**: Yank entire line (enter line mode, copy, exit)
- **Escape**: Always exit (scroll to bottom, close) -- no "clear selection
  first" behavior due to a WezTerm API quirk where
  `get_selection_text_for_pane` returns PrimarySelection content even without
  an active copy mode selection
- **q**: Exit without copying (clear selection, scroll to bottom, close)

The `override_binding` helper function searches the default key table by
key+mods and replaces in-place, appending if not found.

### Tab/Workspace Model

The config uses a unix domain mux for session persistence:

```lua
config.unix_domains = { { name = "unix" } }
config.default_gui_startup_args = { "connect", "unix" }
```

The GUI always connects to a local mux server, meaning tab/pane state survives
GUI restarts. The `mux-startup` event creates a "main" workspace.

Three named workspaces are available via quick-access bindings
(main/feature/scratch), but the primary project navigation is now tab-oriented
via the lace plugin (connection_mode = "tab").

### Status Bar

The status bar uses a unified `update-status` handler that avoids
`set_config_overrides` (which caused WezTerm issue #5318 and a colors table
replacement bug). The left side always shows the workspace name in cyan. The
right side shows a mode badge (COPY in yellow, SEARCH in blue) or a clock when
in normal mode.

## Plugins in Use

### 1. lace.wezterm

- **Source repo**: `~/code/weft/lace.wezterm` (git@github.com:weftwiseink/lace.wezterm.git)
- **Loaded via**: `file:///home/mjr/code/weft/lace.wezterm`
- **Plugin cache**: `~/.local/share/wezterm/plugins/filesCssZssZssZshomesZsmjrsZscodesZsweftsZslacesDswezterm`
- **Cache git HEAD**: `df9bcf2` (fix: use dedicated known_hosts file)
- **Source git HEAD**: `e0d6969` (fix: use direct SSH for tab mode)
- **File content**: Identical (same md5 hash) despite git divergence

**Role**: Provides SSH domain registration and project discovery for lace
devcontainers. Pre-registers 75 SSH domains (ports 22425-22499), discovers
running containers via Docker CLI, and offers a fuzzy project picker.

### 2. resurrect.wezterm

- **Git repo**: https://github.com/MLFlexer/resurrect.wezterm
- **Plugin cache**: `~/.local/share/wezterm/plugins/httpssCssZssZsgithubsDscomsZsMLFlexersZsresurrectsDswezterm`
- **Cache git HEAD**: `47ce553` (Merge pull request #113)

**Role**: Cross-reboot session persistence. Serializes workspace layouts to
JSON on disk. Configured with a 5-minute periodic save interval, 5000-line
scrollback capture, and IPC integration via OSC 1337 user variables for
shell-side `wez save/restore` commands.

### 3. dev.wezterm (transitive dependency)

- **Git repo**: https://github.com/chrisgve/dev.wezterm
- **Plugin cache**: `~/.local/share/wezterm/plugins/httpssCssZssZsgithubsDscomsZschrisgvesZsdevsDswezterm`
- **Cache git HEAD**: `8645826`

**Role**: Plugin management utility used by resurrect.wezterm internally. Not
directly referenced in the wezterm config. Provides path resolution and module
loading support for the resurrect plugin.

## How lace.wezterm Works

### Discovery

When the project picker is invoked (Leader+W or Ctrl+Shift+P), the plugin runs
`docker ps --filter label=devcontainer.local_folder` to find running
containers. It extracts:

1. Container ID and local folder path (from the devcontainer label)
2. SSH port by pattern-matching `<port>->2222/tcp` in the port mapping output
3. Project name from the `lace.project_name` Docker label (falling back to
   basename of local_folder)
4. Container user via `resolve_container_user`, which checks
   `devcontainer.metadata` label for `remoteUser`, then `Config.User`, then
   falls back to "node"

Discovery also runs at config load time (inside `setup_port_domains`) for a
narrower purpose: resolving the correct username for active ports so that
`wezterm connect lace:<port>` uses the right user even without going through
the picker.

### SSH Domains

The plugin pre-registers 75 SSH domains at config load time, one per port in
the 22425-22499 range. Each domain is named `lace:<port>` and configured with:

- `multiplexing = "WezTerm"` (remote mux protocol)
- `no_agent_auth = true` (prevents SSH agent from overriding key auth)
- A dedicated `identityfile` at `~/.config/lace/ssh/id_ed25519`
- A dedicated `userknownhostsfile` at `~/.ssh/lace_known_hosts`

The port range encodes "wez" in alphabet positions (w=22, e=4, z=25 -> 22425).
The domains are static -- WezTerm does not support dynamic domain registration,
so all 75 must exist whether containers are running or not.

### Tab Mode vs. Workspace Mode

The plugin supports two connection modes controlled by `connection_mode`:

**Workspace mode** (`"workspace"`, the default): Uses `act.SwitchToWorkspace`
to create a named workspace per project. Each project gets its own tab bar.
Switching between projects replaces the visible tab bar.

**Tab mode** (`"tab"`, currently active in the config): Spawns tabs in the
current window using direct SSH via `mux_win:spawn_tab({ args = ssh_args })`.
Project tabs appear alongside local tabs in a single tab bar. The picker checks
for existing tabs by title before spawning to prevent duplicates.

Tab mode uses direct SSH arguments instead of domain-based spawn because
WezTerm's mux server SSH domain implementation does not reliably pick up config
changes (like SSH key paths) after hot-reload. This is a deliberate workaround
documented in the plugin source.

### format-tab-title

The plugin exposes `M.format_tab_title(tab_info)` as a helper for the user's
`format-tab-title` event handler (WezTerm only supports one handler per event
name). The resolution order is:

1. Explicit tab title (`tab_info.tab_title`) -- set by `tab:set_title()` in
   the picker or by `wezterm cli set-tab-title` in wez-into
2. Lace discovery cache lookup by domain port
   (`wezterm.GLOBAL.lace_discovery_cache[port]`)
3. Fallback to `tab_info.active_pane.title` (pane's OSC title)

This makes lace tab titles immune to OSC title changes from TUIs (like
`node@hostname: ~` overwriting the project name).

### GLOBAL Cache

`wezterm.GLOBAL.lace_discovery_cache` is a port-to-project-name mapping
populated during picker invocation. It uses `wezterm.GLOBAL` (not module-level
variables) because the plugin module is reloaded on each config re-evaluation,
wiping module-level state. The cache is fully replaced (not incrementally
updated) on each picker invocation to evict stale entries from containers that
stopped or restarted on different ports.

Other GLOBAL flags used by the plugin:

- `wezterm.GLOBAL.lace_domains_logged`: Guards the one-time domain registration
  log message
- `wezterm.GLOBAL.lace_picker_registered`: Guards the event handler
  registration (idempotent across config re-evaluations)
- `wezterm.GLOBAL.lace_use_local`: Override flag to force local plugin path

## State Storage Locations

### 1. Unix Domain Mux Server

The primary session persistence layer. The mux server runs independently of the
GUI and maintains tab/pane state. When the GUI disconnects and reconnects, all
tabs are preserved. The mux socket is at `$XDG_RUNTIME_DIR/wezterm/` (typically
`/run/user/1000/wezterm/`).

Current mux state (from `wezterm cli list`): 1 window, 1 tab, 1 pane in the
"main" workspace.

### 2. Resurrect Plugin JSON Files

Located at `~/.local/share/wezterm/resurrect/` with three subdirectories:

**workspace/** (2 files):
- `main.json` -- 2.3KB, captures the main workspace with 8 tabs. Several tabs
  have `"title": "lace"` and empty CWDs, indicating SSH domain tabs that the
  plugin captured but cannot meaningfully restore.
- `default.json` -- 42 bytes, empty workspace (`window_states: {}`)

**window/** (7 files):
- Various window states with titles like `~+code+personal+dotfiles> vim`,
  Claude Code window states (with Braille-pattern emoji prefixes), and a
  `node@f1ca2cfd7131: ~.json` from a lace container session (10 tabs, most
  with empty CWDs)

**tab/** (1 file):
- `lace.json` -- 198 bytes, single tab state

The resurrect plugin is configured with:
- Periodic save every 300 seconds (5 minutes)
- Saves workspaces, windows, and tabs
- Max 5000 scrollback lines captured per pane
- IPC via `WEZ_SESSION_CMD` user variable for shell-side save/restore

### 3. Plugin Cache

Located at `~/.local/share/wezterm/plugins/`. WezTerm clones plugin repos here
using URL-encoded directory names. Three cached plugins:

| Plugin | Directory Name | Origin |
|--------|---------------|--------|
| lace.wezterm | `filesCssZssZssZshomesZsmjrsZscodesZsweftsZslacesDswezterm` | file:///home/mjr/code/weft/lace.wezterm |
| resurrect.wezterm | `httpssCssZssZsgithubsDscomsZsMLFlexersZsresurrectsDswezterm` | https://github.com/MLFlexer/resurrect.wezterm |
| dev.wezterm | `httpssCssZssZsgithubsDscomsZschrisgvesZsdevsDswezterm` | https://github.com/chrisgve/dev.wezterm |

### 4. Lace SSH Key and Known Hosts

- SSH private key: `~/.config/lace/ssh/id_ed25519` (399 bytes, present)
- Known hosts: `~/.ssh/lace_known_hosts` (4.3KB, present) -- dedicated file
  for ephemeral container host keys, managed by `wez-into`'s
  `refresh_host_key()` function

### 5. wezterm.GLOBAL (In-Memory)

The following keys are used at runtime:

- `lace_discovery_cache`: Port-to-project-name mapping (populated by picker)
- `lace_domains_logged`: One-time log guard
- `lace_picker_registered`: Event handler registration guard
- `lace_use_local`: Plugin path override
- `resurrect_initialized`: Resurrect setup guard

GLOBAL state persists across config re-evaluations within the same WezTerm
process but is lost on mux server restart.

## Plugin Cache Mechanics

WezTerm's `wezterm.plugin.require` clones the plugin repository to
`~/.local/share/wezterm/plugins/` on first use. The directory name is a
URL-encoded version of the plugin URL.

For `file://` URLs (like lace.wezterm), WezTerm clones the local repository.
The clone's git history may diverge from the source, but the working tree
content reflects the source at clone time. The diff confirms that the lace
plugin cache has the same init.lua content as the source repo despite being 2
commits behind in git log.

**Refresh mechanism**: There is no automatic refresh. Plugin updates require
manual intervention:

- For GitHub plugins (resurrect, dev): `wezterm.plugin.update_all()` or
  deleting the cache directory
- For file:// plugins (lace): WezTerm re-clones from the local path. The
  timing of re-clone is not well documented -- it appears to happen on config
  reload but may cache aggressively

The current state shows the lace plugin cache content is up-to-date with the
source even though git log differs. This suggests WezTerm copies the working
tree content rather than checking out from git refs.

## Relationship: Chezmoi Source, Deployed Config, Plugin Cache

```
[Chezmoi Source]                     [Deployed Config]
dot_config/wezterm/wezterm.lua  ---> ~/.config/wezterm/wezterm.lua
(edit here)                     chezmoi apply    (WezTerm reads this)
                                                        |
                                              hot-reload on change
                                                        |
                                                        v
                                              [WezTerm Process]
                                                   |        |
                                     wezterm.plugin.require  |
                                                   |        |
                                    [Plugin Cache]          [Mux Server]
                                    ~/.local/share/          unix domain
                                    wezterm/plugins/         socket
                                         |
                                    [Plugin Sources]
                                    ~/code/weft/lace.wezterm (file://)
                                    github.com/MLFlexer/... (https://)
```

The chezmoi source and deployed config are currently identical (zero diff).
Edit flow: modify chezmoi source -> `chezmoi apply` -> WezTerm hot-reloads.

The deployed config references the lace plugin via a `file://` URL pointing at
the local checkout (`~/code/weft/lace.wezterm`). The `get_lace_plugin_url()`
function has a commented-out GitHub URL for when the plugin stabilizes, but
currently always returns the local path regardless of environment variables
(the conditional logic falls through to the local path in all code paths).

## Risks and Fragilities

### Plugin Cache Staleness

The lace plugin is loaded via `file://` URL, which means WezTerm clones from
the local checkout. The cache can become stale relative to the source repo.
Currently the content is identical, but the mechanism for refreshing file://
plugin caches is poorly documented. If the cache gets out of sync and WezTerm
does not re-clone automatically, the user would need to manually delete the
cache directory.

### Resurrect State Captures SSH Domain Tabs Poorly

The `main.json` workspace state shows 8 tabs, but several have empty CWDs and
domain "unix". The SSH domain tabs (lace connections) are captured as tab
entries but lose their domain association and working directory. Restoring this
workspace state would create empty local tabs, not reconnect to containers.
This is an inherent limitation -- the containers may not be running at restore
time.

### 75 SSH Domains Registered at Config Load Time

Every config evaluation (including hot-reload) registers 75 SSH domains and
runs `docker ps` to resolve usernames for active ports. If Docker is not
running or is slow to respond, this adds latency to every config reload. The
`docker ps` call is synchronous (blocking the main thread during config
evaluation). On a system where Docker is temporarily unavailable, this could
cause visible config reload delays.

### get_lace_plugin_url Always Returns Local Path

The function `get_lace_plugin_url()` has conditional logic for environment
variable override and GLOBAL flag, but the default fallback at the end also
returns the local path. The commented-out GitHub URL means the plugin can never
be loaded from GitHub in the current code, even if the local checkout is
missing. If the local checkout at `~/code/weft/lace.wezterm` is absent, the
plugin load will fail (handled by pcall, logged as warning).

### wezterm.GLOBAL Persistence Boundary

GLOBAL state (discovery cache, registration guards) persists across config
re-evaluations but not across mux server restarts. If the mux server restarts
(e.g., after a reboot), all GLOBAL flags reset, causing:

- One-time log messages to fire again (cosmetic)
- Event handlers to be re-registered (handled correctly by the guard pattern)
- Discovery cache to be empty until the picker is invoked (tab titles fall back
  to pane titles until then)

### Direct SSH in Tab Mode Bypasses Mux Protocol

Tab mode uses `ssh` command arguments directly instead of WezTerm's SSH domain
multiplexer. This means:

- No remote mux server involvement (no persistent remote tabs)
- Tab pane shows as domain "local" or "unix", not "lace:<port>"
- The `format_tab_title` domain-based cache lookup path
  (`domain:match("^lace:")`) will not match -- tab title resolution relies
  entirely on the explicit `tab:set_title()` call
- If the title is not set (e.g., `mux_win:spawn_tab` returns nil), the tab
  shows the SSH connection's OSC title instead of the project name

### Copy Mode Escape Quirk

The copy mode Escape binding was simplified to always exit because
`get_selection_text_for_pane` returns PrimarySelection content even without an
active copy mode selection, making a "clear selection first, exit second"
pattern appear stuck. This means there is no way to clear a visual selection
without exiting copy mode entirely.

### CSI u Key Encoding Disabled

`enable_csi_u_key_encoding = false` is set for compatibility with tools that
do not handle the newer key encoding (specifically Claude Code is mentioned).
This disables WezTerm's enhanced key reporting, which may affect applications
that rely on it for modifier disambiguation.
