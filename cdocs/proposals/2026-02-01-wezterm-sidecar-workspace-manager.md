---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: "2026-02-01T16:40:00-05:00"
task_list: lace/wezterm-sidecar
type: proposal
state: live
status: review_ready  # revised to address R1 blocking findings
tags: [wezterm, plugin, workspace, pane-management, tree-view, monitoring]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-01T18:00:00-05:00
  round: 1
---

# WezTerm Sidecar: Tree-Style Workspace and Activity Manager

> BLUF: Build a WezTerm Lua plugin (`sidecar.wezterm`) that provides a persistent, tree-structured workspace and process manager inspired by Firefox's Sideberry/TreeStyle Tab. The plugin renders a dedicated "sidecar" pane running a custom TUI application, communicating with WezTerm's Lua layer via user variables (OSC 1337) and `wezterm cli`. The sidecar displays the full workspace/tab/pane hierarchy with collapsible nodes, live process status, and configurable summary widgets. Navigation is keyboard-first with fuzzy search. WezTerm's native plugin API handles event wiring, key tables, and status bar integration, while a standalone TUI process (Rust with `ratatui`) handles the rich interactive rendering that WezTerm's Lua API cannot provide natively. This hybrid architecture (Lua plugin + TUI sidecar process) is the critical design decision: it works within WezTerm's real constraints while delivering a UI far beyond what status bars and InputSelector overlays can achieve.

## Objective

Provide a single, integrated view of the entire WezTerm activity tree -- all workspaces, tabs, panes, and their running processes -- in a persistent sidebar that supports:

- **Broad surveying**: See every workspace and its contents at a glance via a collapsible tree.
- **Deep inspection**: Drill into any pane to see process status, recent output summaries, or custom widget content.
- **Fast navigation**: Jump to any pane across any workspace with keyboard shortcuts or fuzzy search, without manually switching workspaces and tabs first.
- **Session monitoring**: Track long-running processes (builds, Claude Code sessions, servers) with live status indicators and configurable summary widgets.

## Background

### The Problem Space

The existing WezTerm workspace model supports named workspaces with tabs and split panes, but there is no unified view across the entire activity tree. As usage grows -- multiple workspaces for different worktrees, each with nested editor/shell/build panes, plus Claude Code sessions -- the mental model fragments. Users must remember which workspace contains which activity and navigate blind.

Browser-based tree tab managers (Sideberry, TreeStyle Tab) solved the analogous problem for web browsing: they replaced flat tab bars with hierarchical, collapsible, always-visible tree views. The core patterns -- collapsible trees, status indicators on collapsed nodes, panel-based workspace separation, fuzzy search across all items -- transfer directly to terminal multiplexer management.

### WezTerm API Constraints

Research into WezTerm's capabilities reveals several hard constraints that shape this design:

1. **No custom rendering surface**: WezTerm plugins cannot render arbitrary UI. Panes are terminal emulators; the status bar and tab titles accept only styled text via `wezterm.format()` with no click handlers.
2. **No custom overlay types**: Overlays (InputSelector, PaneSelect, QuickSelect) are implemented in Rust and cannot be extended by Lua plugins.
3. **Process introspection is local-only**: `pane:get_foreground_process_info()` and the `LocalProcessInfo.children` tree work only for local panes, not multiplexer/SSH panes.
4. **No pane lifecycle events**: There are no built-in events for pane creation or destruction. The `update-status` event fires on focus changes and is the nearest workaround.
5. **Single-threaded Lua**: Event handlers block the GUI thread; status bar updates must be fast and synchronous.

These constraints rule out a pure-Lua implementation for the rich interactive UI. However, WezTerm provides `wezterm cli` (programmatic pane/tab/workspace control), user variables (shell-to-Lua IPC via OSC 1337), `InputSelector` (fuzzy selection overlay), and key tables (modal input) -- together, these provide the building blocks for the hybrid architecture proposed below.

### Prior Art

- **Sideberry** (Firefox): Panel-based workspace organization with vertical tree tabs, collapsible groups, badge counters on panel icons, auto-hide sidebar (30px icon strip / 320px full tree), snapshot/restore. Key insight: panels = independent tab trees per project context.
- **TreeStyle Tab** (Firefox): Automatic parent-child tree construction from browsing context, twisty arrows for collapse, counter badges on collapsed parents, hover-preview tooltips showing collapsed subtree contents. Key insight: the tree should build itself from natural relationships, not manual organization.
- **tmux/zellij sidebar modes**: tmux has no built-in tree view; zellij has WASM plugins that can render custom UIs within panes. Zellij's approach (plugin renders in a pane) is the closest prior art to this proposal's sidecar architecture.
- **resurrect.wezterm**: WezTerm plugin for saving/restoring workspace state. Relevant for the snapshot/restore component.
- **smart_workspace_switcher.wezterm**: Fuzzy workspace switching with zoxide integration. Relevant for the navigation component.

### References

- [WezTerm Plugin API](https://wezterm.org/config/plugins.html)
- [WezTerm Pane Object (32 methods)](https://wezterm.org/config/lua/pane/index.html)
- [WezTerm Key Tables](https://wezterm.org/config/key-tables.html)
- [WezTerm CLI Reference](https://wezterm.org/cli/cli/index.html)
- [WezTerm User Variables / Passing Data](https://wezterm.org/recipes/passing-data.html)
- [WezTerm InputSelector](https://wezterm.org/config/lua/keyassignment/InputSelector.html)
- [Sideberry (GitHub)](https://github.com/mbnuqw/sidebery)
- [TreeStyle Tab (GitHub)](https://github.com/piroor/treestyletab)
- [awesome-wezterm plugin list](https://github.com/michaelbrusegard/awesome-wezterm)

## Proposed Solution

### Architecture: Hybrid Lua Plugin + TUI Sidecar

The system consists of two cooperating components:

```
┌─────────────────────────────────────────────────────────┐
│ WezTerm GUI                                             │
│                                                         │
│  ┌─────────┐  ┌──────────────────────────────────────┐  │
│  │ Sidecar │  │ Main Content                         │  │
│  │ Pane    │  │                                      │  │
│  │ (TUI)   │  │  ┌──────────┐  ┌──────────────────┐  │  │
│  │         │  │  │ Tab 1    │  │ Tab 2            │  │  │
│  │ ▼ lace  │  │  │ ┌──────┐ │  │ ┌──────┐┌─────┐ │  │  │
│  │   main  │  │  │ │ nvim │ │  │ │ shell││build│ │  │  │
│  │   ├ nvim│  │  │ └──────┘ │  │ └──────┘└─────┘ │  │  │
│  │   ├ sh  │  │  └──────────┘  └──────────────────┘  │  │
│  │   └ cc● │  │                                      │  │
│  │ ▶ feat  │  │                                      │  │
│  │   (3)   │  │                                      │  │
│  │ ▶ scratch│ │                                      │  │
│  │   (1) ⚠ │  │                                      │  │
│  └─────────┘  └──────────────────────────────────────┘  │
│                                                         │
│  [lace]──────────────────────────[3 ws │ 7 panes │ 2●] │
│  ← status bar (left)           status bar (right) →     │
└─────────────────────────────────────────────────────────┘
```

**Component 1: `sidecar.wezterm` (Lua Plugin)**

Responsibilities:
- Register event handlers (`update-status`, `user-var-changed`, `gui-startup`)
- Manage the sidecar pane lifecycle (spawn, respawn on close, position)
- Provide key bindings and key tables for sidecar interaction
- Poll and aggregate workspace/tab/pane state via `wezterm.mux` APIs
- Serialize state to JSON and write it to a watched temp file via `io.open()`
- Update the status bar with summary indicators
- Handle navigation commands from the TUI (focus pane, switch workspace) via `window:perform_action()`

**Component 2: `lace-sidecar` (TUI Process)**

Responsibilities:
- Render the interactive tree view with collapse/expand, scrolling, search
- Display process status indicators and summary widgets
- Accept keyboard input for navigation, search, and tree manipulation
- Communicate state changes back to the Lua plugin via user variables or a control protocol
- Run as a standard terminal process within a WezTerm pane

### Communication Protocol

```
 Lua Plugin                    TUI Process
     │                              │
     │──── state.json (mux dump) ──►│  Periodic state push
     │                              │  (via temp file + inotify)
     │                              │
     │◄── OSC 1337 user vars ──────│  Navigation commands
     │    (SIDECAR_CMD=focus:42)    │  (via terminal escape sequences)
     │                              │
     │──── perform_action() ───────►│  WezTerm executes the action
     │    (focus pane, switch ws)   │  (Lua handles in user-var-changed)
     │                              │
```

1. **State push (Lua → TUI)**: The plugin periodically collects the full mux state (`wezterm.mux.all_windows()`, iterating tabs and panes) and writes a JSON snapshot to a temp file via `io.open()`. The TUI watches this file with inotify for zero-latency updates. For local panes, the state includes `LocalProcessInfo` (process name, pid, status, children). For mux panes (the dominant case in this project), it uses pane title and user vars.

2. **Command push (TUI → Lua)**: When the user selects a target in the TUI (e.g., "focus pane 42"), the TUI emits an OSC 1337 `SetUserVar` escape sequence: `SIDECAR_CMD=focus:42`. The Lua plugin's `user-var-changed` handler parses this and calls `window:perform_action()` to execute the navigation.

3. **Alternative: `wezterm cli` for commands**: For operations like `activate-pane`, `activate-tab`, `rename-workspace`, the TUI can directly invoke `wezterm cli` subcommands instead of going through user vars. This is simpler for fire-and-forget operations but lacks the callback capability of user vars.

### Tree Data Model

```lua
-- Conceptual model (serialized as JSON for the TUI)
{
  workspaces = {
    {
      name = "lace",
      active = true,
      tabs = {
        {
          tab_id = 1,
          title = "main",
          active = true,
          panes = {
            {
              pane_id = 10,
              title = "nvim",
              process = { name = "nvim", pid = 1234, status = "Sleep", cwd = "/workspace/main" },
              active = true,
              has_unseen_output = false,
              user_vars = { WEZTERM_PROG = "nvim ." },
              children = {}  -- split pane children, if any
            },
            {
              pane_id = 11,
              title = "zsh",
              process = { name = "zsh", pid = 1235, status = "Sleep", cwd = "/workspace/main" },
              active = false,
              has_unseen_output = true,
              children = {}
            },
            {
              pane_id = 12,
              title = "claude",
              process = { name = "claude", pid = 1236, status = "Sleep" },
              widget = "claude_session",  -- triggers summary widget rendering
              active = false,
              has_unseen_output = true,
              children = {}
            }
          }
        }
      }
    },
    {
      name = "feature",
      active = false,
      collapsed = true,
      summary = { total_panes = 3, running = 2, errors = 0 },
      tabs = { ... }  -- omitted when collapsed, unless expanded by user
    }
  }
}
```

### Rendering: The Tree View

The TUI renders an indented, scrollable tree. Each node type has a distinct visual treatment:

```
 WORKSPACES                        ← section header
 ▼ lace                           ← expanded workspace (▼ = expanded)
   ├─ main ·····················   ← tab (dots fill to right edge)
   │  ├ nvim . ●                   ← pane (● = active, green = running)
   │  ├ zsh                        ← pane (dim = idle)
   │  └ claude ◉ thinking...       ← pane with widget summary
   └─ tests ····················
      └ npm test ● 3/12 passed     ← pane with inline status
 ▶ feature (3)                     ← collapsed workspace (▶ = collapsed)
 ▶ scratch (1) ⚠                   ← collapsed with warning indicator

 [/] search  [?] help  [q] close
```

**Node types and indicators:**
- **Workspace**: `▼`/`▶` collapse toggle, name, pane count when collapsed, status icon (⚠ = error in any child)
- **Tab**: Name with dot-fill, active indicator
- **Pane**: Process name, status icon (● running, ○ idle, ⚠ error, ✓ completed), optional inline summary from widget

**Visual states** (mapped from Sideberry/TST patterns):
- Active pane: bold text, highlighted
- Unseen output: underlined or marked
- Error state: red icon
- Suspended/idle: dimmed text
- Collapsed with children: count badge + aggregate status icon

### Navigation and Interaction

**Always-available bindings** (registered as WezTerm keys, not handled by TUI):

| Binding | Action |
|---------|--------|
| `Leader + t` | Toggle sidecar pane visibility |
| `Leader + f` | Open fuzzy finder (InputSelector overlay) across all panes |
| `Leader + [` / `Leader + ]` | Cycle workspaces |

**Sidecar-focused bindings** (key table activated when sidecar pane is focused):

| Key | Action |
|-----|--------|
| `j` / `k` | Move cursor down / up in tree |
| `h` / `l` | Collapse / expand node |
| `Enter` | Focus the selected pane (switches workspace/tab as needed) |
| `Space` | Toggle collapse on current node |
| `/` | Start fuzzy search within tree |
| `R` | Refresh tree state |
| `x` | Close selected pane (with confirmation) |
| `m` | Move selected pane (enters move mode) |
| `r` | Rename workspace/tab |
| `?` | Show help |
| `q` or `Escape` | Return focus to previous pane |

**Fuzzy finder** (via WezTerm's `InputSelector` overlay):

The plugin provides a `Leader + f` binding that constructs an `InputSelector` with all panes across all workspaces as choices. Each choice label includes the workspace name, tab name, process name, and truncated recent output. On selection, the plugin navigates to that pane. This provides quick cross-workspace jumping without requiring the sidecar pane to be visible.

### Summary Widgets

Summary widgets are modular display components that render inline status for specific pane types. The widget system is plugin-extensible:

```lua
-- Widget registration in plugin config
sidecar.apply_to_config(config, {
  widgets = {
    claude_session = {
      match = function(pane_info)
        return pane_info.process and pane_info.process.name == "claude"
      end,
      summary = function(pane_info)
        -- Extract status from user vars or recent output
        local prog = pane_info.user_vars.WEZTERM_PROG or ""
        if prog:match("Thinking") then return "◉ thinking..." end
        if prog:match("idle") then return "○ idle" end
        return "● active"
      end,
    },
    npm_test = {
      match = function(pane_info)
        -- Works with mux panes: match on title or user vars, not LocalProcessInfo
        local title = pane_info.title or ""
        local prog = pane_info.user_vars and pane_info.user_vars.WEZTERM_PROG or ""
        return title:match("npm test") or prog:match("npm test")
      end,
      summary = function(pane_info)
        -- Parse recent output for test counts (available via get_lines_as_text on local panes)
        local text = pane_info.recent_output or ""
        local passed = text:match("(%d+) passed")
        local failed = text:match("(%d+) failed")
        if passed then return passed .. " passed" .. (failed and ", " .. failed .. " failed" or "") end
        return "running..."
      end,
    },
  },
})
```

The Lua plugin evaluates widget matchers during state collection and includes the summary string in the JSON state pushed to the TUI. This keeps the TUI rendering simple (it just displays the string) while letting the Lua side do the semantic analysis with full access to WezTerm's pane APIs.

### Status Bar Integration

The plugin augments the existing status bar with aggregate information:

**Left status**: Current workspace name (already implemented in the existing config).

**Right status**: Summary counters.

```
[3 ws │ 7 panes │ 2● │ 1⚠]
```

- `3 ws`: workspace count
- `7 panes`: total pane count
- `2●`: actively-running process count
- `1⚠`: panes with errors or unseen output needing attention

Clicking (when supported) or pressing `Leader + t` opens the sidecar for detail.

## Important Design Decisions

### Decision 1: Hybrid Architecture (Lua Plugin + TUI Sidecar Process)

**Decision**: Use a two-component architecture where a Lua plugin handles WezTerm integration and a standalone TUI process handles rendering.

**Why**: WezTerm's Lua API cannot render custom interactive UI. The three available approaches were evaluated:

1. **Pure Lua (status bar + InputSelector only)**: Could show summary counts in the status bar and use InputSelector for navigation. Too limited -- no persistent tree view, no collapsible hierarchy, no scrolling, no inline status. Would feel like a command palette, not a workspace manager.

2. **Pure TUI (standalone process, no Lua plugin)**: A TUI process in a pane could render the full tree, using `wezterm cli list` to discover panes and `wezterm cli activate-pane` to navigate. Viable but fragile -- no event-driven updates, no access to `LocalProcessInfo` or user vars, polling `wezterm cli list` is slower than Lua API access, and no way to integrate with key tables or status bar.

3. **Hybrid (Lua plugin + TUI sidecar)**: Combines strengths of both. Lua handles event-driven state collection, key bindings, and WezTerm API access. TUI handles rendering. Communication via temp file (Lua → TUI) and user vars (TUI → Lua). This is the proposed approach.

The hybrid approach has precedent in Zellij's plugin architecture (WASM processes rendering in panes) and in Neovim's RPC-based UI model.

### Decision 2: Sidecar Pane (Not a Separate Window or Tab)

**Decision**: The sidecar renders in a dedicated pane within the current tab, toggled via keybinding.

**Why**: A separate window would lose spatial context and require alt-tabbing. A separate tab would be invisible during normal work. A pane within the current tab keeps the tree visible alongside work content. The pane can be toggled (hidden/shown) and auto-sized. This mirrors the Sideberry/TST pattern of a sidebar panel within the main window.

The plugin manages the sidecar pane's lifecycle: spawning it via `pane:split()`, respawning if closed, hiding/showing via pane zoom or resize.

> NOTE: The `top_level = true` parameter on `pane:split()` for full-height sidecar panes is unverified in the WezTerm Lua API documentation. The `wezterm cli split-pane --top-level` CLI flag exists, but it is unclear whether this capability is exposed to Lua. The Phase 0 feasibility spike must validate this. If full-height splits are not available via Lua, alternatives include: (a) invoking `wezterm cli split-pane --top-level` from Lua via `run_child_process`, (b) using a dedicated tab approach where the sidecar tab auto-switches alongside the work tab, or (c) accepting that the sidecar splits within the current tab's pane layout.

### Decision 3: State Push via Temp File with `io.open()`

**Decision**: Use Lua's standard `io.open()` / `file:write()` to write state JSON to a temp file, with the TUI watching the file via inotify. User variables (OSC 1337) handle the TUI → Lua direction.

**Why**: The Lua-to-TUI communication channel is the central technical risk. WezTerm's Lua environment does not expose socket APIs. The standard Lua runtime lacks socket libraries, and WezTerm's async primitives (`wezterm.background_child_process`) are fire-and-forget with no I/O back to Lua. Alternatives considered:

- **Unix socket via `wezterm.run_child_process` + socat**: `run_child_process` is synchronous and blocks the GUI thread (violates Constraint 5). Calling an external process to write to a socket on every state update would cause noticeable GUI freezes.
- **`inject_output` with escape sequences**: Could inject state into the sidecar pane's terminal stream. The sidecar pane is local, so `inject_output` works. However, this couples the TUI to parsing escape sequences from its own terminal stream and could interfere with rendering. Worth exploring in the Phase 0 spike as a potential upgrade path.
- **`wezterm cli get-text` / `send-text`**: Would require the TUI to parse terminal output, which is fragile.
- **TUI polls `wezterm cli list --format json` directly**: Simplest approach, but loses access to `LocalProcessInfo`, user vars, and pane content. The Lua plugin's role would reduce to key bindings and status bar only.

The chosen approach: Lua `io.open()` writes a JSON state file to a well-known path (e.g., `/run/user/$UID/lace-sidecar-$WEZTERM_PANE.json`). The TUI watches this file with inotify (zero-latency notification, no polling). Atomic writes via write-to-temp-then-rename prevent partial reads. Cleanup is handled by the TUI on exit and the Lua plugin on sidecar pane close.

> NOTE: `io.open()` availability in WezTerm's Lua environment must be validated in the Phase 0 feasibility spike. WezTerm uses a custom Lua runtime (mlua) and may sandbox file I/O. If `io.open()` is unavailable, the fallback is `wezterm.run_child_process({"sh", "-c", "cat > /path/to/file"})` with stdin piping, or the TUI polling `wezterm cli list --format json` directly.

For the TUI → Lua direction, user variables (OSC 1337) are the simplest path: the TUI prints an escape sequence, WezTerm's terminal emulator picks it up, and the `user-var-changed` event fires in Lua. This avoids needing the Lua side to poll anything.

### Decision 4: TUI Implementation Language

**Decision**: Recommend Rust with `ratatui` as the TUI framework. Go with `bubbletea` is an acceptable alternative.

**Why**: The TUI process needs to be:
- Fast to start (spawned when the sidecar pane opens)
- Low memory footprint (runs alongside many other processes)
- Capable of rich terminal rendering (tree views, scrolling, colors, unicode glyphs)
- Able to watch files (inotify) and emit terminal escape sequences

Rust + ratatui satisfies all of these and aligns with WezTerm's own Rust implementation. Go + bubbletea is a viable alternative if contributor preference leans that direction. Python (textual/rich) would work but adds a runtime dependency and startup latency.

### Decision 5: Fuzzy Finder Uses Native InputSelector

**Decision**: The cross-workspace fuzzy search uses WezTerm's built-in `InputSelector` overlay rather than a custom TUI implementation.

**Why**: InputSelector provides a high-quality fuzzy search overlay that is already native to WezTerm, supports keyboard-driven selection, and renders as a proper modal overlay (not constrained to the sidecar pane's dimensions). The Lua plugin constructs the choices dynamically from current mux state and handles the selection callback. This avoids duplicating fuzzy search logic in the TUI while providing a consistent UX with WezTerm's other fuzzy selectors (launcher, workspace switcher).

The sidecar TUI still provides its own in-tree search (`/` key) for filtering within the visible tree, but the `Leader + f` global finder delegates to InputSelector.

### Decision 6: Widget System is Lua-Side, Not TUI-Side

**Decision**: Widget matching and summary generation happen in the Lua plugin, not in the TUI process.

**Why**: The Lua plugin has access to WezTerm APIs that the TUI does not: `pane:get_user_vars()`, `pane:get_foreground_process_info()`, `pane:get_lines_as_text()`, `pane:get_semantic_zones()`. Widget logic that inspects pane content or process state must run in Lua. The TUI receives pre-computed summary strings and renders them without needing to understand the underlying data.

This also means new widget types can be added by users in their WezTerm config without modifying the TUI binary.

## Stories

### Story: Monitoring a Claude Code Session

A developer has Claude Code running a complex multi-file refactor in workspace "feature". They switch to workspace "main" to handle a separate task. The sidecar shows:

```
 ▼ main                     ← current workspace
   └─ editor
      └ nvim ●
 ▶ feature (2) ◉            ← collapsed, ◉ = Claude active
```

The `◉` indicator on the collapsed "feature" workspace tells them Claude is still working. When Claude finishes, the indicator changes to `✓`. The developer presses `Enter` on "feature" to expand it, sees the results, and presses `Enter` on the relevant pane to jump there.

### Story: Navigating a Large Worktree Setup

A developer has 4 workspaces (main, feature-auth, feature-ui, scratch), each with 2-3 tabs and multiple split panes. They need to find the pane running `npm test` but cannot remember which workspace it is in. They press `Leader + f`, type "npm", and the InputSelector shows:

```
> npm
  feature-auth / tests / npm test ● 12/12 passed
  feature-ui / build / npm run build ● bundling...
```

They select the first entry and are instantly navigated to that pane in the feature-auth workspace.

### Story: Quick Workspace Assessment After a Break

Returning from a break, the developer glances at the sidecar:

```
 ▶ main (3)                  ← all panes idle
 ▶ feature-auth (4) ✓        ← all processes completed successfully
 ▶ feature-ui (2) ⚠          ← warning: a process exited with error
 ▶ scratch (1)               ← idle
```

The `⚠` on feature-ui immediately tells them something needs attention. They press `j` to move to that workspace, `l` to expand it, and see:

```
 ▼ feature-ui (2) ⚠
   └─ build
      ├ webpack ⚠ exit 1      ← the problem
      └ tsc ✓ exit 0
```

## Edge Cases / Challenging Scenarios

### Multiplexer Pane Limitations (Primary Use Case)

> NOTE: For the lace project, the SSH domain ("lace") is the dominant pane type. Most panes are multiplexer panes where `get_foreground_process_info()` returns `nil`. This is the primary use case, not an edge case: the core UX must be designed around mux-pane-level information, with `LocalProcessInfo` enrichment as a bonus for local panes.

The sidecar's information sources for mux panes, in priority order:

1. **`pane:get_title()`**: Set via OSC 0/1/2 or shell integration. This is the primary identifier for mux panes.
2. **`pane:get_user_vars()`**: If shell integration sets `WEZTERM_PROG` or custom variables. This is the primary channel for structured metadata from inside the container.
3. **Container-side agent (future)**: A lightweight process inside the container that publishes process info via user variables, bridging the `LocalProcessInfo` gap for SSH/mux panes.
4. **"unknown" fallback**: Display with a distinct icon if no information is available.

Widget matchers and summary functions must work with title and user vars as their default inputs. Widgets that depend on `LocalProcessInfo` (e.g., process argv inspection) should be clearly documented as local-pane-only and should never display stale or incorrect data for mux panes.

### Sidecar Pane Self-Reference

The sidecar TUI runs in a WezTerm pane, so it will appear in the pane list. The plugin must filter out the sidecar's own pane from the tree display. The sidecar pane can be identified by a user variable set at spawn time (e.g., `SIDECAR_PANE=true`).

### Sidecar Pane Closure

If the user closes the sidecar pane (e.g., via `Alt+W`), the plugin should detect this (via `update-status` polling or `mux-is-process-stateful`) and be prepared to respawn it on the next `Leader + t` toggle. The sidecar should not prevent tab/workspace closure -- the `mux-is-process-stateful` handler should return `false` for the sidecar pane.

### High Pane Counts

With dozens of panes across many workspaces, the state JSON could become large. Mitigations:

- Only collect full `LocalProcessInfo` for expanded nodes; collapsed workspaces get summary counts only.
- Debounce state updates (e.g., max 2 per second).
- The TUI should handle incremental rendering (only redraw changed nodes).

### Race Conditions in Navigation

When the TUI sends a "focus pane 42" command and the Lua handler executes it, the pane might have been closed between the state snapshot and the command. The handler should validate the pane exists (`wezterm.mux.get_pane(id) ~= nil`) before performing the action, and send an error notification if it does not.

### Multiple Windows

WezTerm can have multiple GUI windows. The sidecar should be per-window (each window has its own sidecar pane). The state snapshot should be scoped to the window that the sidecar belongs to, though a configuration option could enable cross-window visibility.

## Implementation Phases

### Phase 0: Feasibility Spike

Validate the critical technical assumptions before committing to a multi-phase build. This spike produces a go/no-go decision with documented findings.

**Validate:**

1. **Lua file I/O**: Can `io.open()` write files from WezTerm's Lua event handlers without blocking the GUI? Test writing a JSON file from an `update-status` handler and measure latency.
2. **Sidecar pane positioning**: Can `pane:split()` create a full-height left pane that spans the entire window, independent of other tab splits? Test `top_level` parameter if available; test `wezterm cli split-pane --top-level` as a fallback.
3. **Cross-tab sidecar persistence**: Does a pane created via split survive tab switches within the same workspace? If panes are per-tab, evaluate the auto-recreate and dedicated-tab alternatives.
4. **`update-status` firing scope**: Does `update-status` fire when a pane in a non-focused tab or workspace changes state? If not, determine whether a timer-based poll (using the TUI polling `wezterm cli list --format json`) can supplement event-driven updates.
5. **OSC 1337 round-trip**: Verify that a TUI process can emit `SetUserVar` and have the Lua `user-var-changed` handler receive it reliably, including measuring latency.

**Verification**: A minimal prototype: Lua plugin writes a JSON file containing `wezterm.mux` state, a shell script reads and displays it in a split pane, and a user variable round-trip triggers a pane focus change. Document findings for each of the 5 validation points. Produce a go/no-go recommendation.

### Phase 1: Lua Plugin Foundation

Build the `sidecar.wezterm` Lua plugin with:

- `apply_to_config` setup registering event handlers and key bindings
- State collection: iterate `wezterm.mux.all_windows()` → tabs → panes, build the workspace tree data structure
- JSON serialization of the state tree
- `Leader + t` keybinding to spawn/toggle a sidecar pane (initially running a placeholder command like `cat` or `watch`)
- Status bar integration showing workspace/pane counts
- `Leader + f` fuzzy finder via `InputSelector` with all panes as choices, navigating on selection

**Verification**: The fuzzy finder correctly lists all panes across workspaces and navigates to the selected one. The status bar shows accurate counts. The sidecar pane spawns and toggles.

### Phase 2: TUI Sidecar Prototype

Build the `lace-sidecar` TUI application:

- Read state JSON from stdin (for testing) or a watched temp file (production)
- Render a static tree view with workspace/tab/pane hierarchy
- Handle `j`/`k` navigation, `h`/`l` collapse/expand, `Enter` to emit focus command
- Emit OSC 1337 user variables for navigation commands
- Support `/` for in-tree search

**Verification**: The TUI renders the tree, navigation works, and pressing Enter on a pane causes WezTerm to focus that pane.

### Phase 3: Live State Synchronization

Connect the Lua plugin and TUI with live updates:

- Implement file-based communication between Lua and TUI (temp file + inotify)
- Periodic state refresh in the `update-status` event handler (debounced)
- Process status enrichment via `get_foreground_process_info()` for local panes
- User variable enrichment for mux panes
- Sidecar self-filtering (exclude the sidecar pane from the tree)

**Verification**: The tree updates in near-real-time as panes are created, closed, or change state. Mux panes show title-based information. The sidecar pane does not appear in its own tree.

### Phase 4: Summary Widgets

Implement the widget system:

- Widget registration API in plugin config
- Built-in widgets: Claude Code session monitor, npm/build status, generic process exit status
- Widget evaluation during state collection
- Summary string inclusion in JSON state
- TUI rendering of inline widget summaries

**Verification**: A Claude Code session pane shows status ("thinking", "idle", etc.). An npm test pane shows pass/fail counts. Widget summaries update as processes run.

### Phase 5: Polish and Advanced Features

- Workspace collapse/expand persistence (across sidecar restarts)
- Pane management actions from sidecar: close pane, move pane, rename workspace
- Status bar click-through (when WezTerm supports it) or `Leader + t` auto-focus
- Cross-window visibility option
- Theming (inherit WezTerm color scheme)
- Documentation and packaging as a Git-hosted WezTerm plugin

**Verification**: Full workflow test: multiple workspaces with various process types, collapse/expand, search, navigate, monitor, manage. The plugin installs via `wezterm.plugin.require` and configures via `apply_to_config`.

## Open Questions

1. **File I/O sandboxing**: Does WezTerm's Lua runtime (mlua) allow `io.open()` for writing? If sandboxed, the fallback is `wezterm.run_child_process({"sh", "-c", "cat > path"})` with stdin, or the TUI polling `wezterm cli list --format json` directly. The Phase 0 spike must resolve this.

2. **State refresh frequency**: How often should the state snapshot be pushed? `update-status` fires on every focus change, which may be sufficient for most cases. A configurable timer-based refresh (e.g., every 2 seconds) would catch changes that don't involve focus (like background process completion).

3. **Pane content sampling for widgets**: `pane:get_lines_as_text()` reads the viewport. For widgets that need to parse recent output (like test results), how many lines should be sampled? This has performance implications -- sampling all panes every 2 seconds could be expensive.

4. **Devcontainer integration**: The existing "lace" SSH domain means many panes are multiplexer panes where `LocalProcessInfo` is unavailable. Should the TUI process run inside the container (with access to local process info) or on the host (with access to WezTerm's Lua API)? A split approach may be needed.
