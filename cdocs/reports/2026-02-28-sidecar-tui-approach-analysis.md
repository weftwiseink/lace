---
first_authored:
  by: "@claude-opus-4-6"
  at: "2026-02-28T22:00:00-05:00"
task_list: lace/wezterm-sidecar
type: report
state: archived
status: done
tags: [wezterm, ratatui, tui, sidecar, architecture, session-management, cockpit]
---

# Sidecar TUI Approach Analysis: Ratatui vs WezTerm Native vs Alternatives

> BLUF: A standalone TUI process (ratatui or bubbletea) running in a WezTerm pane is the only viable path for a persistent, interactive session management sidebar. WezTerm's native Lua scripting cannot render custom UI beyond status bar text and modal overlays. The prior sidecar proposal (2026-02-01) got the architecture right but stalled at the feasibility spike. This report updates that analysis with the current tab-oriented work, evaluates the "sidecar window" vs "sidebar pane" question, and recommends a phased approach starting with a minimal ratatui binary that shells out to `wezterm cli`.

## Context / Background

### The Goal

Retain a high-level yet precise view and navigation of all panes, agents, editors, and widgets running in WezTerm. The interface should:

1. Represent all windows/tabs/panes in a navigable hierarchy
2. Show status indicators -- especially Claude Code session status
3. Support click-to-navigate to any pane
4. Be extensible with "cockpit"-style widgets (session state summaries, build status, etc.)

### Prior Work in This Codebase

The sidecar concept has been designed but never built:

- **2026-02-01**: Full sidecar proposal (`cdocs/proposals/2026-02-01-wezterm-sidecar-workspace-manager.md`) -- hybrid Lua plugin + Rust/ratatui TUI, tree view, widget system, 5-phase implementation. R1 review found 5 blocking issues (Lua socket APIs don't exist, `top_level` pane split unverified, cross-tab persistence unclear, `update-status` firing scope unknown, mux pane `LocalProcessInfo` unavailable). Proposal was revised but the Phase 0 feasibility spike was **never run**.

- **2026-02-01**: Overlay system deep dive (`cdocs/reports/2026-02-01-wezterm-overlay-system-deep-dive.md`) -- established that overlays are modal, ephemeral, and cannot provide a persistent sidebar.

- **2026-02-01**: Executive summary (`cdocs/reports/2026-02-01-wezterm-sidecar-executive-summary.md`) -- identified `io.open()` availability and full-height pane splits as go/no-go gates.

- **2026-02-28** (today): Tab-oriented connection mode (`cdocs/proposals/2026-02-28-tab-oriented-lace-wezterm.md`) -- a simpler, complementary approach now being implemented. All devcontainers appear as tabs in one window with pinned titles. This work is *orthogonal* to the sidecar -- tabs are the container connection model; the sidecar is the session management UI layer.

### What Changed Since the Original Proposal

1. **Tab mode is landing.** The tab-oriented connection mode makes a sidecar *more* valuable, not less: with many tabs in one window, you need a way to see and navigate them all. The original proposal assumed workspace-per-project; now tab-per-project is the default.

2. **The Lua→TUI communication question is clearer.** We can skip the `io.open()` question entirely. The TUI can poll `wezterm cli list --format json` directly -- it's fast enough for 1-2 Hz updates and avoids the entire Lua IPC complexity.

3. **The "sidecar window" idea is new.** The original proposal only considered a sidebar pane within a tab. A separate WezTerm window dedicated to cockpit widgets opens different architectural possibilities.

## Key Findings

### Finding 1: WezTerm Native Scripting Cannot Build This

WezTerm's Lua API provides:
- **Status bar**: left/right text strips in the tab bar row. No click handlers, no scrolling, no tree rendering.
- **Overlays** (InputSelector, PaneSelect, etc.): Modal, ephemeral, full-pane. Good for fuzzy selection (already used by lace picker) but not for persistent display.
- **Tab title customization**: Already used by the tab-oriented work for pinned project names.
- **No floating panes**: PR #5576 was closed without merging. No persistent sidebar API exists.
- **No custom widget rendering**: The only surfaces are pane terminal content, status bar text, and tab title text.

**Verdict**: Native scripting is the *complement* (key bindings, event hooks, status bar summary) but cannot be the *primary* UI.

### Finding 2: The Simpler Architecture Won

The original proposal's hybrid Lua+TUI design with `io.open()` state files, inotify watchers, and OSC 1337 bidirectional IPC was elegant but complex. The R1 review correctly identified that the IPC was the central risk.

A simpler architecture is now clearly preferable:

```
┌──────────────┐     wezterm cli list --format json     ┌──────────────┐
│  TUI Process │ ◄──────────────────────────────────── │   WezTerm    │
│  (ratatui)   │                                        │   Mux        │
│              │ ────── wezterm cli activate-pane ────► │              │
│              │ ────── wezterm cli activate-tab ─────► │              │
│              │ ────── wezterm cli spawn ─────────────►│              │
└──────────────┘                                        └──────────────┘
```

The TUI is a standalone binary that:
1. Polls `wezterm cli list --format json` every 500ms-1s for pane state
2. Calls `wezterm cli activate-pane --pane-id N` (etc.) for navigation
3. Reads pane content via `wezterm cli get-text --pane-id N` for widget data
4. Runs in a WezTerm pane like any other terminal program

No Lua plugin required for the core loop. Lua plugin only needed for:
- Auto-spawning the sidecar pane on startup
- Status bar summary counters
- `Leader+t` toggle binding
- Claude session status enrichment via user variables

### Finding 3: Sidecar Window vs Sidebar Pane -- Both Have Merit

**Sidebar pane** (original proposal's approach):
- Lives in a left/right split within the current tab
- Always visible alongside work content
- `top_level = true` on `pane:split()` makes it span full tab height
- **Problem**: Per-tab. Switching tabs loses the sidebar unless you recreate it per tab or use a dedicated "sidecar tab" pattern.
- **Problem**: Eats horizontal space from every tab.

**Sidecar window** (new idea):
- A separate WezTerm window running the TUI
- Can contain multiple widget panes (sidebar tree, session summary, build status) as splits
- Always visible on a second monitor or tiled beside the main window
- Not affected by tab switching in the main window
- Can show cross-window state
- **Problem**: Requires window management discipline (tiling WM helps).
- **Problem**: No spatial coupling -- the sidecar is "over there" not "right here."

**Hybrid recommendation**: Build the TUI as a standalone binary that works in *either* context. It's just a terminal program -- it doesn't know or care whether it's in a split pane or a separate window. The Lua plugin can offer both modes:
- `Leader+t` toggles a sidebar pane in the current tab
- `Leader+T` opens/focuses a dedicated sidecar window
- The TUI binary is the same either way

### Finding 4: Framework Comparison for This Specific Use Case

| Criterion | Ratatui (Rust) | Bubbletea (Go) | Textual (Python) |
|-----------|---------------|----------------|-------------------|
| Tree widget | `tui-tree-widget` (mature, maintained) | Manual / community (gap) | Built-in `Tree` (excellent) |
| Mouse/click | Manual coord mapping or `ratatui-interact` | BubbleZone (very good) | Built-in (excellent) |
| Binary distribution | Single binary, 2-5 MB | Single binary, 8-15 MB | Needs Python runtime |
| Dev velocity | Low-medium (Rust learning curve) | Medium-high (Go is fast to iterate) | High (fastest to prototype) |
| Async/polling | Tokio + crossterm EventStream | Go goroutines + tea.Cmd | asyncio workers |
| Ecosystem alignment | Matches WezTerm (also Rust) | Charmbracelet is polished | Rich but heavy |
| Status indicator rendering | Full `Style` + 24-bit color + Nerd Fonts | Lip Gloss styling | CSS-like `.tcss` |

**Ratatui wins for this project** because:
1. `tui-tree-widget` is the best tree widget available across all frameworks -- and the tree is the core UI element.
2. The lace ecosystem is already Rust-adjacent (WezTerm is Rust, the sidecar binary lives alongside a TypeScript CLI but is independent).
3. Single small binary with zero runtime dependencies.
4. Mouse support is adequate -- the TUI doesn't need complex form widgets, just clickable tree rows.

**Bubbletea is the strongest alternative** if Rust development velocity is a concern. BubbleZone's mouse handling is cleaner than ratatui's manual approach. The missing tree widget is the main gap, but a 3-level indented list (workspace→tab→pane) is buildable without a dedicated widget.

### Finding 5: Claude Session Status Is the Killer Widget

The most valuable status indicator is Claude Code session state. The information pipeline:

1. **Claude Code sets terminal title** via OSC 2 (visible as pane title in `wezterm cli list`).
2. **Claude Code may set user variables** via OSC 1337 if shell integration is active.
3. **Pane content** can be sampled via `wezterm cli get-text --pane-id N` for heuristic status extraction (look for "Thinking", spinner characters, idle prompt, etc.).
4. **Process name** is available for local panes (`get_foreground_process_info()` via Lua) but **not for mux/SSH panes** -- which is our primary case.

For mux panes (the lace devcontainer case), the TUI must rely on:
- Pane title (OSC 2 set by Claude Code's TUI)
- Content sampling via `wezterm cli get-text`
- A future container-side agent that publishes structured status via user variables

This is a solvable problem, but the content-sampling approach (regex matching on `get-text` output) should be the Phase 1 approach for Claude status detection.

### Finding 6: Zellij's Model Is Architecturally Superior (But Irrelevant)

Zellij's WASM plugin system allows plugins to:
- Render custom UI as first-class panes
- Subscribe to session events (tab created, pane focused, etc.)
- Access session state without polling an external CLI

This is exactly what a session management sidebar needs, and WezTerm doesn't have it. If WezTerm ever adds a plugin pane API (the floating panes PR was a step toward this), the architecture would simplify dramatically. For now, the external-TUI-in-a-pane approach is the only option, and it works well enough.

## Architecture Deep Dive

### The Minimal Viable Sidecar

```
┌─ WezTerm Window ─────────────────────────────────────────┐
│ ┌─ Sidecar ─┐ ┌─ Main Content ────────────────────────┐  │
│ │ WORKSPACES│ │                                        │  │
│ │ ▼ main    │ │  ┌─ Tab: main ──┐  ┌─ Tab: auth ───┐  │  │
│ │   nvim  ● │ │  │              │  │               │  │  │
│ │   zsh     │ │  │   editor     │  │   tests       │  │  │
│ │   cc  ◉   │ │  │              │  │               │  │  │
│ │ ▶ auth (3)│ │  └──────────────┘  └───────────────┘  │  │
│ │ ▶ ui (2)⚠ │ │                                        │  │
│ └───────────┘ └────────────────────────────────────────┘  │
│ [main] ──────────────────────────── [5 tabs │ 12 panes]  │
└───────────────────────────────────────────────────────────┘
```

The binary: `lace-sidecar` (Rust, ~500-800 lines for MVP)

**Data flow**:
```
Every 500ms:
  wezterm cli list --format json
    → parse into Window/Tab/Pane tree
    → diff against previous state
    → re-render changed nodes

On user action (Enter/click):
  wezterm cli activate-pane --pane-id N
  wezterm cli activate-tab --tab-id N  (if different tab)
```

**MVP feature set**:
- Tree view: window → tab → pane hierarchy
- Status icons: `●` active, `○` idle, `◉` claude thinking, `⚠` error
- Keyboard nav: j/k, h/l collapse, Enter to focus, `/` to search
- Mouse: click row to focus pane
- Auto-refresh on 500ms timer

### The Cockpit Window (Future Extension)

```
┌─ Cockpit Window ─────────────────┐
│ ┌─ Session Tree ──────────────┐  │
│ │ ▼ main                      │  │
│ │   nvim ●  zsh  cc ◉ idle    │  │
│ │ ▶ auth (3)                  │  │
│ │ ▶ ui (2) ⚠                  │  │
│ └─────────────────────────────┘  │
│ ┌─ Claude Sessions ───────────┐  │
│ │ main/cc: idle (42 turns)    │  │
│ │ auth/cc: thinking... (3m)   │  │
│ │ ui/cc: awaiting input       │  │
│ └─────────────────────────────┘  │
│ ┌─ Build Status ──────────────┐  │
│ │ main: tests passing 42/42   │  │
│ │ auth: build failed (tsc)    │  │
│ └─────────────────────────────┘  │
└──────────────────────────────────┘
```

This is a separate WezTerm window with multiple panes, each running a widget. The session tree is `lace-sidecar`. The Claude session monitor could be `lace-sidecar --widget claude`. Build status could be a separate tool entirely.

The cockpit window is spawned by a Lua helper or a shell script:

```bash
# Spawn cockpit window with preset layout
wezterm cli spawn --new-window -- lace-sidecar
wezterm cli split-pane --bottom --percent 40 -- lace-sidecar --widget claude
wezterm cli split-pane --bottom --percent 50 -- lace-sidecar --widget builds
```

### Communication Enrichment Layers

The MVP uses only `wezterm cli list --format json`. Richer data can be layered on:

**Layer 1 (MVP)**: `wezterm cli list` -- pane ID, title, CWD, workspace, dimensions.

**Layer 2**: `wezterm cli get-text --pane-id N` -- sample visible content for status heuristics. Expensive per-pane; only query panes matched by widget rules (e.g., panes whose title contains "claude").

**Layer 3**: Lua plugin enrichment -- a `sidecar.wezterm` plugin that writes a JSON sidecar file with `LocalProcessInfo`, user vars, and widget summaries computed in Lua. The TUI checks for this file and uses it when available, falling back to Layer 1+2 otherwise.

**Layer 4**: Container-side agent -- a lightweight process inside devcontainers that publishes structured status via OSC 1337 user variables. The Lua plugin forwards these to the sidecar file.

Each layer is additive. The TUI should be designed to work with just Layer 1 and progressively enhance when richer data is available.

## Risk Assessment

### Resolved Risks (from the original proposal's R1 review)

| Original Risk | Status |
|---|---|
| Lua socket APIs don't exist | **Moot** -- TUI uses `wezterm cli` directly, no Lua IPC needed for MVP |
| `top_level` pane split unverified | **Still needs validation** for sidebar-pane mode. Workaround: `wezterm cli split-pane --top-level` from shell |
| Cross-tab sidecar persistence | **Addressed** by the sidecar-window approach. For sidebar-pane mode, auto-recreate on tab switch |
| `update-status` firing scope | **Moot for MVP** -- TUI polls `wezterm cli list` independently of Lua events |
| Mux pane `LocalProcessInfo` unavailable | **Accepted** -- design around title + content sampling + user vars |

### New Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `wezterm cli list` polling latency | Low | 500ms is fine for a status display; tune interval if needed |
| `wezterm cli get-text` cost for many panes | Medium | Only query panes matched by widget rules; cache results |
| Sidebar pane disappears on tab switch | Medium | Auto-recreate via Lua, or prefer sidecar window mode |
| Click-to-navigate requires pane ID stability | Low | Pane IDs are stable within a session; refresh tree on each poll |
| Tree view gets unwieldy with 20+ panes | Low | Collapse by default; workspace and tab grouping helps |

## Recommendations

### 1. Build `lace-sidecar` as a standalone Rust/ratatui binary

Start with the simplest possible architecture: a binary that polls `wezterm cli list --format json` and renders a tree. No Lua plugin in Phase 1.

### 2. Support both sidebar-pane and sidecar-window modes

The binary doesn't need to know which mode it's in. Lua plugin or shell wrapper handles spawning:
- `Leader+t` → `pane:split { direction = "Left", size = 0.2, top_level = true, args = { "lace-sidecar" } }`
- `Leader+T` → `wezterm cli spawn --new-window -- lace-sidecar`

### 3. Phase implementation

**Phase 0** (1 session): Validate `top_level` split, measure `wezterm cli list` latency, confirm mouse events work in a split pane. Ship a "hello world" ratatui binary that displays `wezterm cli list` output as a tree.

**Phase 1** (2-3 sessions): Full tree navigation (keyboard + mouse), status icons, auto-refresh. This is the MVP.

**Phase 2**: Claude session status via `get-text` content sampling. Widget framework for extensible status extraction.

**Phase 3**: Lua plugin for auto-spawn, toggle, status bar summary. Sidecar window mode with multi-widget layout.

**Phase 4**: Cockpit window with session tree + Claude monitor + build status as separate widget panes.

### 4. Defer Lua→TUI IPC until it's needed

Layer 1 (`wezterm cli list`) is sufficient for the MVP. The `io.open()` / inotify / user-var channel from the original proposal is only needed for Layer 3 (Lua-computed widget data). By that point, the TUI will be stable enough to justify the complexity.

### 5. Consider bubbletea if Rust velocity is a blocker

The tree widget gap in bubbletea is real but manageable for a 3-level hierarchy. If the first ratatui session is painful, Go is the escape hatch. The architecture is framework-agnostic since all WezTerm interaction goes through the CLI.

## Related Documents

- `cdocs/proposals/2026-02-01-wezterm-sidecar-workspace-manager.md` -- original full design
- `cdocs/reviews/2026-02-01-review-of-wezterm-sidecar-workspace-manager.md` -- R1 review with blocking findings
- `cdocs/reports/2026-02-01-wezterm-sidecar-executive-summary.md` -- executive summary of original design
- `cdocs/reports/2026-02-01-wezterm-overlay-system-deep-dive.md` -- why native overlays can't do this
- `cdocs/proposals/2026-02-28-tab-oriented-lace-wezterm.md` -- complementary tab-mode work (in progress)
- `cdocs/reports/2026-02-28-wezterm-tab-title-pinning.md` -- tab title pinning (in progress)
