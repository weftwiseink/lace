---
first_authored:
  by: "@claude-opus-4-6"
  at: "2026-02-28T12:00:00-06:00"
task_list: lace/wezterm-tab-mode
type: proposal
state: archived
status: implementation_accepted
tags: [wezterm, lace.wezterm, architecture, tab-management]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-28T18:30:00-06:00
  round: 1
---

# Tab-Oriented Connection Mode for lace.wezterm

> BLUF: Add a `connection_mode = "tab"` option to the lace.wezterm plugin so the project picker spawns tabs in the current window instead of creating separate workspaces. This keeps all lace devcontainer sessions in a single WezTerm window. Tab titles are set via `tab:set_title()` on spawn and rendered by a `format-tab-title` event handler, which makes them immune to OSC title changes from TUI applications like Claude Code. The `wez-into` CLI is updated to use `wezterm cli spawn` instead of `wezterm connect`. Duplicate tab detection prevents spawning a second tab for an already-connected project.

## Objective

Constrain lace devcontainer usage to a single WezTerm window by replacing workspace-per-project with tab-per-project. The current `SwitchToWorkspace` approach creates separate windows that scatter across the desktop; a tab-oriented approach keeps everything in one place with tab-bar visibility of all active projects.

## Background

The lace.wezterm plugin currently uses `act.SwitchToWorkspace()` in its project picker callback (line 298-307 of `plugin/init.lua`), which creates a named workspace per project. The `wez-into` CLI uses `wezterm connect lace:<port> --workspace <project>`, which always opens a new window.

WezTerm has three relevant architectural facts:
1. `wezterm connect` (CLI) always creates a new window — there is no flag to target an existing window as a tab.
2. `act.SpawnCommandInNewTab()` (Lua API) creates a tab in the current window attached to a specified domain.
3. `wezterm cli spawn --domain-name <name>` (CLI) creates a tab in the running mux, appearing in the existing GUI window.

For tab title stability: WezTerm maintains separate title stores for tabs and panes. OSC escape sequences (from programs like Claude Code) only modify pane titles. Tab titles set via `tab:set_title()` are independent and persist. The default tab bar renders pane titles, but a `format-tab-title` event handler can prefer tab titles when set.

## Proposed Solution

### Plugin Changes (`plugin/init.lua`)

**1. New option: `connection_mode`**

Add `connection_mode = "tab"` to `M.defaults` (default `"workspace"` for backward compatibility). The picker callback switches behavior based on this option.

**2. Picker callback: tab mode**

When `connection_mode == "tab"`, the picker callback:
- Checks for an existing tab connected to this domain (duplicate detection)
- If found, activates that tab instead of spawning a new one
- If not found, spawns a new tab via `SpawnCommandInNewTab` with the domain
- Sets the tab title to the project name after spawn

```lua
-- Tab mode: spawn tab in current window
if opts.connection_mode == "tab" then
  -- Check for existing tab with this domain
  local mux_win = win:mux_window()
  for _, tab_info in ipairs(mux_win:tabs_with_info()) do
    for _, p in ipairs(tab_info.tab:panes()) do
      if p:get_domain_name() == domain_name then
        tab_info.tab:activate()
        return
      end
    end
  end

  -- Spawn new tab
  win:perform_action(
    act.SpawnCommandInNewTab({
      domain = { DomainName = domain_name },
      cwd = opts.workspace_path,
    }),
    pane
  )
else
  -- Workspace mode (current behavior)
  win:perform_action(
    act.SwitchToWorkspace({ ... }),
    pane
  )
end
```

> NOTE: `SpawnCommandInNewTab` is a synchronous action — the tab exists after `perform_action` returns. However, `perform_action` doesn't return the new tab object, so tab title setting happens via the discovery cache and `format-tab-title` (see below).

**3. Discovery cache in `wezterm.GLOBAL`**

The picker callback populates `wezterm.GLOBAL.lace_discovery_cache` (a port-to-project-name map) each time it runs. This cache must use `wezterm.GLOBAL` rather than module-level state because WezTerm re-evaluates the config (and reloads the plugin module) multiple times per process, wiping module-level variables. `wezterm.GLOBAL` persists across evaluations within the same process, consistent with the existing pattern for `wezterm.GLOBAL.lace_picker_registered` and `wezterm.GLOBAL.lace_domains_logged`.

```lua
-- In picker callback, after discover_projects():
wezterm.GLOBAL.lace_discovery_cache = wezterm.GLOBAL.lace_discovery_cache or {}
for name, info in pairs(projects) do
  wezterm.GLOBAL.lace_discovery_cache[info.port] = name
end
```

**4. Tab title resolution via `format-tab-title`**

Rather than relying on a tab-creation event (WezTerm has no `mux-tab-added` event), tab titles are resolved at render time by the `format-tab-title` handler. The handler checks the active pane's domain name against `wezterm.GLOBAL.lace_discovery_cache` to resolve a project name. If the tab has an explicit `tab_title` set, that takes priority. Otherwise, for lace domains, the cache provides the project name. For non-lace tabs, the pane title is used as-is.

The plugin exposes this as a helper function rather than registering the event handler directly, to avoid WezTerm's single-handler-per-event constraint. The user's config owns the event registration:

```lua
-- In plugin (M.format_tab_title):
function M.format_tab_title(tab_info)
  -- Explicit tab title takes priority (user-set or pinned)
  local title = tab_info.tab_title
  if title and title ~= "" then
    return title
  end
  -- Check if active pane is a lace domain
  local domain = tab_info.active_pane.domain_name
  if domain then
    local port = tonumber(domain:match("^lace:(%d+)$"))
    local cache = wezterm.GLOBAL.lace_discovery_cache or {}
    if port and cache[port] then
      return cache[port]
    end
  end
  -- Fallback: pane title
  return tab_info.active_pane.title
end

-- In user's wezterm config:
wezterm.on("format-tab-title", function(tab, tabs, panes, cfg, hover, max_width)
  local title = lace_plugin.format_tab_title(tab)
  if #title > max_width - 2 then
    title = title:sub(1, max_width - 5) .. "..."
  end
  return " " .. title .. " "
end)
```

> NOTE: The `format-tab-title` handler fires on every tab bar repaint. The cache lookup is O(1) (hash table by port number), so performance impact is negligible.

**5. Status bar adaptation**

The plugin's existing `update-status` handler (which shows workspace name) conflicts with the user's own `update-status` handler in their wezterm config. In WezTerm's event model, the last handler registered wins, so the plugin's handler is currently dead code. Rather than compounding this conflict, the plugin removes its `update-status` handler entirely. The user's config already renders the left status bar; in tab mode, the workspace name shown there is less useful but still accurate. The `format-tab-title` handler provides per-tab project context, which is the primary benefit of tab mode.

> NOTE: If the user wants domain-aware status bar content, they can read `pane:get_domain_name()` and consult `wezterm.GLOBAL.lace_discovery_cache` in their own `update-status` handler.

### CLI Changes (`bin/wez-into`)

**6. `do_connect` function: tab mode**

Replace `wezterm connect` with `wezterm cli spawn`:

```bash
do_connect() {
  local project="$1"
  local port="$2"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "wezterm cli spawn --domain-name lace:$port"
    exit 0
  fi

  # Check wezterm prerequisite only when actually connecting
  if ! command -v wezterm &>/dev/null; then
    err "wezterm not found on PATH"
    exit 1
  fi

  # Pre-populate the host key so WezTerm doesn't prompt for trust
  refresh_host_key "$port"

  info "connecting to $project on port $port..."

  # Suppress xkbcommon errors from WezTerm's older bundled libxkbcommon
  export XKB_LOG_LEVEL=10  # critical only

  # wezterm cli spawn creates a tab in the running mux
  # Falls back to wezterm connect if no mux is running
  if wezterm cli spawn --domain-name "lace:$port" 2>/dev/null; then
    info "tab created for $project"
  else
    info "no running mux, falling back to wezterm connect..."
    wezterm connect "lace:$port" --workspace main &>/dev/null &
    disown
  fi
}
```

> NOTE: `wezterm cli spawn` requires a running mux server. If none exists (cold start), it fails. The fallback to `wezterm connect` handles this case — the first project opens a new window in the "main" workspace, and subsequent `wezterm cli spawn` calls create tabs there. The `XKB_LOG_LEVEL` and PATH check are preserved from the original `do_connect`.

## Important Design Decisions

### Decision: Default to workspace mode for backward compatibility

**Why:** Users who have muscle memory and workflows around workspace switching shouldn't be broken by a plugin update. Tab mode is opt-in via `connection_mode = "tab"`. This also means the existing `update-status` handler continues to work for workspace users.

### Decision: Duplicate detection by domain name, not project name

**Why:** Domain names (`lace:<port>`) are the ground truth for what's connected. A project name could theoretically map to different ports across container restarts, but the domain name is always current. Checking `pane:get_domain_name()` across all tabs in the mux window is authoritative.

### Decision: Expose `format_tab_title` as a helper function, not a registered handler

**Why:** WezTerm only supports one handler per event name. If the plugin registers `format-tab-title` directly, it conflicts with any user-side or other-plugin handler. By exposing a helper function that the user calls from their own handler, the user retains control over tab rendering and can compose lace's title resolution with other logic. The `format-tab-title` event itself is the documented pattern for custom tab rendering — it fires on every tab bar repaint and always reflects current state.

### Decision: Resolve tab titles from discovery cache at render time, not at spawn time

**Why:** WezTerm has no `mux-tab-added` event. Rather than using a proxy event like `pane-focus-changed` (which fires frequently and requires careful deduplication), the `format-tab-title` handler resolves project names from `wezterm.GLOBAL.lace_discovery_cache` on each render. The cache lookup is O(1) by port number. This is simpler and more reliable than trying to intercept tab creation.

### Decision: Fall back to `wezterm connect` from CLI when no mux is running

**Why:** `wezterm cli spawn` only works when a mux server is running. On cold start (no WezTerm window open), it fails. Rather than requiring the user to open WezTerm first, the CLI falls back to `wezterm connect` which bootstraps a new window. This makes `wez-into` work from any context.

## Edge Cases / Challenging Scenarios

### Container restart changes port

If a container is recreated and gets a different port, the old tab's domain connection dies (pane shows disconnected). The user opens the picker again, which spawns a new tab on the new port. The stale tab must be closed manually. Duplicate detection won't flag it because the domain name differs.

### Tab bar overflow

With many active projects, the tab bar becomes crowded. WezTerm's `tab_max_width = 40` (current config) truncates long titles. The `format-tab-title` handler should keep titles short — just the project name, no port or path.

### Mixed local and remote tabs

The `format-tab-title` handler must work for all tabs, not just lace tabs. When `tab_title` is empty (local tabs), it falls back to the pane title. This is the default behavior, so local tabs are unaffected.

### `format-tab-title` handler conflicts

Both the plugin and the user's wezterm config might want to customize tab rendering. The plugin should register its handler only when `connection_mode == "tab"`, and the user can override it in their config (later registrations win in WezTerm's event system). Alternatively, the handler could be registered in the user's config rather than the plugin, with the plugin only setting `tab:set_title()`.

### Cross-workspace tab spawning

If the user switches to a non-default workspace (e.g., "scratch") and then uses the picker, `SpawnCommandInNewTab` creates the lace tab in that workspace. Duplicate detection only checks the current mux window's tabs, so a lace tab in a different workspace won't be found. This is acceptable for the "single window" goal — users who stay in one workspace won't encounter this. Documented as a known limitation.

### Multiplexer fan-out

With `multiplexing = "WezTerm"`, connecting to a remote domain can "fan out" existing remote tabs into the local tab bar. This is existing behavior and happens regardless of tab vs workspace mode. In tab mode it's more visible since all tabs share one window.

## Test Plan

### Plugin validation

1. Set `connection_mode = "tab"` in wezterm config
2. Open picker, select a project → new tab appears in current window
3. Tab title shows project name, not pane title
4. Run Claude Code in the tab → tab title remains pinned to project name
5. Open picker, select same project → existing tab activates (no duplicate)
6. Open picker, select different project → second tab appears
7. Close all lace tabs → only local tabs remain

### CLI validation

1. With running WezTerm: `wez-into <project>` → new tab appears (no new window)
2. Without running WezTerm: `wez-into <project>` → new window opens (fallback)
3. `wez-into --dry-run <project>` → prints `wezterm cli spawn` command

### Backward compatibility

1. Set `connection_mode = "workspace"` (or omit) → existing behavior unchanged
2. Workspace switching keybindings still work
3. Status bar shows workspace name in workspace mode

## Implementation Phases

### Phase 1: Plugin tab mode with title support

Add `connection_mode` option to `M.defaults`. Modify the picker callback to branch on this option: `SpawnCommandInNewTab` for tab mode, `SwitchToWorkspace` for workspace mode. Include duplicate tab detection. Populate `wezterm.GLOBAL.lace_discovery_cache` from picker results. Expose `M.format_tab_title()` helper function. Remove the plugin's `update-status` handler (it conflicts with the user's handler and is effectively dead code).

**Verify:** Picker spawns tabs instead of workspaces. Duplicate detection prevents double-spawn. Workspace mode still works when option is omitted.

### Phase 2: User config integration

Add `format-tab-title` event handler to the user's wezterm config, calling `lace_plugin.format_tab_title()`. Verify tab titles show project names and are immune to OSC title changes from TUI applications.

**Verify:** Tab titles show project names. Running Claude Code in a tab does not change the tab title. Local tabs still show pane titles. Config reload preserves the discovery cache via `wezterm.GLOBAL`.

### Phase 3: CLI update

Modify `wez-into` `do_connect` to use `wezterm cli spawn --domain-name` with fallback to `wezterm connect --workspace main`. Preserve `XKB_LOG_LEVEL`, PATH check, and dry-run ordering. Update `--dry-run` output and help text.

**Verify:** `wez-into` creates tabs in running WezTerm. Cold start falls back to new window in "main" workspace. Dry run shows correct command.
