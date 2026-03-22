---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T21:30:00-07:00
task_list: terminal-management/sprack-tui
type: report
state: live
status: wip
tags: [ratatui, widgets, tui, visual_design, rust]
---

# Ratatui Widget Ecosystem for sprack

> BLUF: Ratatui ships 13 built-in widgets and has a rich third-party ecosystem.
> For sprack, the critical widgets are `tui-tree-widget` (tree rendering with configurable open/closed/leaf symbols, per-node styled text, built-in scrollbar, and mouse hit testing), `Block` (bordered panels with titled sections), `Scrollbar` (viewport position indicator), and `Paragraph` (detail panel text).
> The `Stylize` trait enables fluent chaining (`"text".bold().yellow()`) and the `catppuccin` crate provides direct `ratatui::style::Color` conversion via a feature flag.
> `ratatui-macros` eliminates boilerplate for constraints, spans, and layouts.
> Real-world apps like yazi, gitui, and bottom demonstrate the standard composition pattern: vertical frame (header/body/footer) with horizontal splits inside the body, bordered blocks per panel, and stateful widgets for navigation.

## 1. Built-in Widgets Catalog

Ratatui (v0.29+, modularized into `ratatui-core` and `ratatui-widgets` since v0.30) ships the following widgets:

| Widget | Purpose | sprack Relevance |
|--------|---------|-----------------|
| `Block` | Borders, titles, padding around other widgets | High: panel frames for tree, detail, status |
| `List` | Scrollable selectable item list | Low: tree widget supersedes this |
| `Table` | Rows/columns with headers and selection | Medium: potential for detail panel structured data |
| `Paragraph` | Styled, wrapped/truncated text | High: detail panel, status messages |
| `Scrollbar` | Scroll position indicator | Medium: built into tui-tree-widget, but useful for detail panel |
| `Tabs` | Horizontal tab bar with selection | Low: sprack has no tab UI currently |
| `BarChart` | Bar graphs with grouping | None |
| `Chart` | Line/scatter plots with datasets | None |
| `Canvas` | Arbitrary shape drawing | None |
| `Gauge` / `LineGauge` | Progress percentage display | Low: could show context % in detail panel |
| `Sparkline` | Compact data trend lines | None |
| `Calendar::Monthly` | Month calendar (feature-gated) | None |
| `Clear` | Clears an area for overdrawing (popup support) | Low: useful if sprack adds popups later |

### Block: the Universal Container

`Block` is the most-used widget in ratatui applications.
It wraps other widgets with borders, titles, and padding:

```rust
let block = Block::bordered()
    .title("Sessions")
    .title_bottom(Line::from("q: quit").right_aligned())
    .border_type(BorderType::Rounded)
    .padding(Padding::horizontal(1));

let inner = block.inner(area);
frame.render_widget(block, area);
frame.render_stateful_widget(tree_widget, inner, &mut tree_state);
```

Builder methods:
- `bordered()` / `borders(Borders::LEFT | Borders::RIGHT)`: which edges to draw.
- `border_type()`: `Plain`, `Rounded`, `Double`, `Thick`.
- `border_style()`: style only the border characters.
- `border_set()`: fully custom border character set.
- `title()` / `title_top()` / `title_bottom()`: add titles with alignment via `Line::from("text").centered()`.
- `title_style()`: style all titles.
- `padding()`: `Padding::horizontal(n)`, `Padding::vertical(n)`, `Padding::uniform(n)`.
- `style()`: base style for the entire block area.
- `inner(area) -> Rect`: compute the drawable area inside borders and padding.

Block implements `Stylize`, so shorthand works: `Block::bordered().red().on_black().bold()`.

### Scrollbar

The built-in `Scrollbar` renders a position indicator alongside scrollable content:

```rust
let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight);
let mut scrollbar_state = ScrollbarState::new(total_items).position(current_position);
frame.render_stateful_widget(scrollbar, area, &mut scrollbar_state);
```

Orientations: `VerticalRight`, `VerticalLeft`, `HorizontalBottom`, `HorizontalTop`.
`ScrollbarState` tracks `content_length` (total scrollable items) and `position` (current scroll offset).

> NOTE(opus/sprack-tui): `tui-tree-widget` has its own `experimental_scrollbar()` method, so sprack may not need to render a separate `Scrollbar` for the tree panel.
> A standalone `Scrollbar` is still useful for the detail panel if it becomes scrollable.

### Paragraph

`Paragraph` renders styled, optionally wrapped text:

```rust
let detail = Paragraph::new(text![
    line!["Model: ".bold(), "claude-opus-4-5-20251101".cyan()],
    line!["Context: ".bold(), "42% (84k/200k)".yellow()],
    line!["Status: ".bold(), "thinking...".bold().yellow()],
])
.block(Block::bordered().title("Detail"))
.wrap(Wrap { trim: true });
```

Without `.wrap()`, lines are truncated at the widget boundary.
For the detail panel, wrapping is appropriate; for inline labels, truncation is preferred.

## 2. tui-tree-widget Deep Dive

The `tui-tree-widget` crate (v0.24.0, MIT, by EdJoPaTo) is the standard tree widget for ratatui.

### Visual Rendering

The tree renders with configurable symbols for each node type:

| Node State | Default Symbol | Configurable Via |
|------------|---------------|-----------------|
| Expanded (has children, open) | (built-in default) | `node_open_symbol()` |
| Collapsed (has children, closed) | (built-in default) | `node_closed_symbol()` |
| Leaf (no children) | (built-in default) | `node_no_children_symbol()` |
| Selected | `""` (none) | `highlight_symbol()` |

Custom symbols for sprack:

```rust
let tree = Tree::new(&items)?
    .block(Block::bordered().title("Sessions"))
    .node_open_symbol("v ")
    .node_closed_symbol("> ")
    .node_no_children_symbol("  ")
    .highlight_symbol(">> ")
    .highlight_style(Style::new().fg(Color::Black).bg(Color::LightGreen).bold())
    .experimental_scrollbar(Some(
        Scrollbar::new(ScrollbarOrientation::VerticalRight)
    ));
```

Rendered output with these symbols:

```
┌Sessions────────────────────┐
│ v lace (22425)             │
│   v editor                 │
│ >>   shell (nvim) [*]      │▓
│     terminal (nu)          │░
│   > logs (3)               │░
│ > dotfiles (22430)         │░
│ > local                    │░
│                            │
└q: quit─────────────────────┘
```

### Per-Node Styled Text

`TreeItem` accepts any type implementing `Into<Text<'text>>`, which includes `Line`, `Span`, `String`, and `&str`.
This means each node can have independently styled text using multiple colored `Span`s:

```rust
let pane_text = Line::from(vec![
    Span::raw("shell "),
    Span::styled("(nvim)", Style::default().dim()),
    Span::raw(" "),
    Span::styled("[thinking]", Style::default().bold().yellow()),
]);

TreeItem::new_leaf("pane-1", pane_text)
```

This is critical for sprack: session names can be bold, process info dimmed, status badges colored.

### Tree API Summary

**`Tree` builder methods:**
- `new(&[TreeItem])` -> `Result`: validates unique identifiers.
- `block()`: wrap in a `Block`.
- `style()`: default text style.
- `highlight_style()`: selected item style.
- `highlight_symbol()`: prefix for selected item.
- `node_open_symbol()` / `node_closed_symbol()` / `node_no_children_symbol()`: node state indicators.
- `experimental_scrollbar()`: optional integrated scrollbar.

**`TreeItem` construction:**
- `new(identifier, text, children)` -> `Result`: parent node.
- `new_leaf(identifier, text)`: leaf node.
- `add_child(item)` -> `Result`: append child after creation.
- `children()` / `child(idx)` / `child_mut(idx)`: child access.
- `height()`: compute total height including descendants.

**`TreeState` navigation:**
- `key_up()` / `key_down()`: vertical movement.
- `key_left()`: collapse or move to parent.
- `key_right()`: expand or move to first child.
- `toggle_selected()`: toggle open/close.
- `select_first()` / `select_last()`: jump to bounds.
- `scroll_up(n)` / `scroll_down(n)`: viewport scroll.
- `click_at(Position)` -> `bool`: mouse click with hit testing.
- `rendered_at(Position)` -> `Option<&[Identifier]>`: identify node at position.

## 3. Styling API

### Style Struct

The `Style` struct controls foreground color, background color, underline color, and modifier flags:

```rust
Style::new()
    .fg(Color::Yellow)
    .bg(Color::Black)
    .add_modifier(Modifier::BOLD | Modifier::DIM)
```

### Modifier Flags

All available modifiers (bitwise-combinable):

| Modifier | Terminal Support |
|----------|----------------|
| `BOLD` | Universal |
| `DIM` | Universal |
| `ITALIC` | Most modern terminals |
| `UNDERLINED` | Universal |
| `SLOW_BLINK` | Limited |
| `RAPID_BLINK` | Rare |
| `REVERSED` | Universal |
| `HIDDEN` | Most terminals |
| `CROSSED_OUT` | Most modern terminals |

For sprack, `BOLD`, `DIM`, and `REVERSED` are the workhorses.
`ITALIC` is useful for secondary information.

### Stylize Trait: Fluent Chaining

The `Stylize` trait is implemented for `String`, `&str`, `Span`, `Line`, `Text`, `Block`, `Style`, and most widget types.
It enables chainable shorthand methods:

```rust
// Instead of:
Span::styled("thinking", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))

// Write:
"thinking".bold().yellow()
```

**Foreground color methods:** `black()`, `red()`, `green()`, `yellow()`, `blue()`, `magenta()`, `cyan()`, `gray()`, `dark_gray()`, `light_red()`, `light_green()`, `light_yellow()`, `light_blue()`, `light_magenta()`, `light_cyan()`, `white()`.

**Background color methods:** `on_black()`, `on_red()`, `on_green()`, etc.

**Generic color:** `fg(impl Into<Color>)`, `bg(impl Into<Color>)`.

**Modifier methods:** `bold()`, `dim()`, `italic()`, `underlined()`, `slow_blink()`, `rapid_blink()`, `reversed()`, `hidden()`, `crossed_out()`.

**Removal methods:** `not_bold()`, `not_dim()`, `not_italic()`, etc.

### Color Enum

```rust
enum Color {
    Reset,
    Black, Red, Green, Yellow, Blue, Magenta, Cyan, Gray,
    DarkGray, LightRed, LightGreen, LightYellow,
    LightBlue, LightMagenta, LightCyan, White,
    Rgb(u8, u8, u8),      // 24-bit true color
    Indexed(u8),           // 256-color palette
}
```

Construction from various formats:
- Named: `Color::Yellow`
- RGB: `Color::Rgb(255, 165, 0)`
- Hex: `Color::from_str("#FFA500")`
- u32: `Color::from_u32(0x00FFA500)`
- Indexed: `Color::Indexed(208)`

### Catppuccin Integration

The `catppuccin` crate provides a `ratatui` feature flag that implements `Into<ratatui::style::Color>` for catppuccin colors:

```toml
[dependencies]
catppuccin = { version = "2", features = ["ratatui"] }
```

```rust
use catppuccin::PALETTE;

let mocha = &PALETTE.mocha;
let green = mocha.colors.green;   // implements Into<Color>
let surface0 = mocha.colors.surface0;

// Direct use with Stylize .fg() method:
"active".fg(green)

// Or in a Style:
Style::new().fg(mocha.colors.yellow.into()).bg(mocha.colors.base.into())
```

Four flavors available: `latte` (light), `frappe`, `macchiato`, `mocha` (darkest).
Each flavor has accent colors (14 saturated colors) and surface/overlay/base colors (monochromatic).
The crate also provides ANSI color mappings via `flavor.ansi_colors`.

For sprack, catppuccin provides a ready-made, widely-adopted color palette.
Using `mocha` (the darkest flavor) aligns with typical dark terminal themes.

## 4. ratatui-macros

The `ratatui-macros` crate eliminates common boilerplate:

```toml
[dependencies]
ratatui-macros = "0.6"
```

### Constraint Macros

```rust
use ratatui_macros::{constraint, constraints, horizontal, vertical};

// Single constraint
let c = constraint!(==50);        // Constraint::Length(50)
let c = constraint!(>=25);        // Constraint::Min(25)
let c = constraint!(<=40);        // Constraint::Max(40)
let c = constraint!(==30%);       // Constraint::Percentage(30)
let c = constraint!(==1/3);       // Constraint::Ratio(1, 3)
let c = constraint!(*=1);         // Constraint::Fill(1)

// Multiple constraints
let cs = constraints![==1, *=1, ==1];
// Expands to: [Constraint::Length(1), Constraint::Fill(1), Constraint::Length(1)]
```

### Layout Macros

```rust
// Vertical layout
let [header, body, footer] = vertical![==1, *=1, ==1].areas(area);

// Horizontal layout
let [sidebar, main] = horizontal![>=25, *=1].areas(area);
```

### Text Macros

```rust
use ratatui_macros::{span, line, text};

let s = span!("plain text");
let s = span!(Color::Green; "colored {}", name);
let s = span!(Modifier::BOLD; "bold text");

let l = line!["hello", "world".bold()];
let l = line![span!(Color::Red; "error"), ": something broke"];

let t = text![
    line!["Model: ".bold(), model_name.cyan()],
    line!["Status: ".bold(), status.yellow()],
];
```

### Row Macro (for tables)

```rust
use ratatui_macros::row;

let r = row!["session", "3 windows", "attached"];
```

> NOTE(opus/sprack-tui): These macros are especially valuable for sprack's tree item construction, where mixing styled spans is frequent.
> Using `line!` and `span!` reduces the verbosity of `Line::from(vec![Span::styled(...), ...])`.

## 5. Third-Party Widget Ecosystem

### Widgets Relevant to sprack

| Crate | Description | sprack Use Case |
|-------|-------------|----------------|
| `tui-tree-widget` | Collapsible tree with mouse support | Core: session/window/pane hierarchy |
| `tui-scrollview` | Scrollable viewport for arbitrary content | Detail panel if content exceeds height |
| `tui-popup` | Modal popup windows with `Clear` overdrawing | Confirmation dialogs, help overlay |
| `tui-widget-list` | Heterogeneous widget list with per-item styling | Alternative to `List` for custom items |
| `tui-big-text` | Large ASCII art text from font8x8 glyphs | None (logo/banner use only) |
| `ratatui-image` | Image rendering via sixel/kitty/iTerm2 protocols | None |
| `tui-textarea` | Multi-line text editor widget | None (sprack is read-only) |
| `tui-logger` | Log capture and display widget | Debug builds only |
| `throbber-widgets-tui` | Spinners and activity indicators | Low: loading state while waiting for first poll |
| `tui-menu` | Nestable menu widget | Low: command palette if added later |

### tui-scrollview

Provides a virtual canvas larger than the visible area, with managed scroll state:

```rust
use tui_scrollview::{ScrollView, ScrollViewState};

let mut scroll_state = ScrollViewState::default();
let mut scroll_view = ScrollView::new(Size::new(80, 200)); // virtual size

// Render content into the scroll view's buffer
scroll_view.render_widget(paragraph, Rect::new(0, 0, 80, 200));

// Render the visible portion
frame.render_stateful_widget(scroll_view, area, &mut scroll_state);
```

Useful for the detail panel when process integration data is taller than the available area.

### tui-widget-list

An alternative to the built-in `List` that accepts any widget implementing the `Listable` trait.
Each item can have different heights and rendering logic:

```rust
use tui_widget_list::{ListView, ListState};

let items: Vec<MyCustomItem> = build_items();
let mut list_state = ListState::default();
let list_view = ListView::new(items)
    .scroll_padding(2)
    .block(Block::bordered().title("Items"));

frame.render_stateful_widget(list_view, area, &mut list_state);
```

Not needed for sprack's initial implementation (tui-tree-widget covers the primary use case), but useful if sprack adds a non-tree view mode.

### tui-widgets Collection

The `ratatui/tui-widgets` repository consolidates several widgets under one workspace:
`tui-bar-graph`, `tui-big-text`, `tui-box-text`, `tui-cards`, `tui-popup`, `tui-prompts`, `tui-qrcode`, `tui-scrollbar`, `tui-scrollview`.

## 6. Composition Patterns from Real Applications

### Standard Frame: Header / Body / Footer

Every major ratatui application uses the same outer frame:

```rust
let [header, body, footer] = vertical![==1, *=1, ==1].areas(frame.area());
```

- **Header** (1 row): app title, mode indicator, or tab bar.
- **Body** (fill): primary content, usually split horizontally.
- **Footer** (1 row): status bar, keybind hints, or command input.

### Panel Composition: Bordered Blocks

Each logical panel is wrapped in a `Block` with a title:

```rust
let tree_block = Block::bordered()
    .title("Sessions")
    .border_type(BorderType::Rounded);

let detail_block = Block::bordered()
    .title("Detail")
    .border_type(BorderType::Rounded);
```

Panels are assigned to layout regions and rendered independently.
The `Block::inner()` method computes the usable area inside borders.

### Application Patterns

**Yazi** (file manager):
- Three-column layout: parent directory, current directory (focus), preview.
- Each column is a bordered panel.
- Current directory uses a styled list with per-item icons and colors.
- Preview panel switches content type based on selected file (text, image, PDF).
- Tab bar at the top for multiple directory tabs.
- Status bar at the bottom with file metadata.

**GitUI** (git client):
- Tabbed top-level views: Status, Log, Stash, Explore.
- Status view: left panel (file tree), right panel (diff preview), split ~40/60.
- File tree uses a tree/list widget with expand/collapse for directories.
- Diff panel uses `Paragraph` with per-line coloring (green for adds, red for deletes).
- Modal popups for commit messages, branch operations.

**Bottom/btm** (system monitor):
- Grid layout with multiple panels: CPU graph, memory graph, process list, disk I/O, network.
- Process list is a `Table` with sortable columns.
- Each panel is a `Block` with a title showing the metric name.
- Tabs for switching between views.
- Status bar with keybind hints.

### Pattern: Focus Ring

Multi-panel applications track which panel has focus, styling the focused panel's border differently:

```rust
fn panel_border_style(focused: bool) -> Style {
    if focused {
        Style::new().fg(Color::LightCyan).bold()
    } else {
        Style::new().fg(Color::DarkGray)
    }
}

let tree_block = Block::bordered()
    .title("Sessions")
    .border_style(panel_border_style(self.focused_panel == Panel::Tree));
```

This pattern is relevant if sprack adds a detail panel: the tree and detail panels would alternate focus.

### Pattern: Conditional Panel Visibility

Show or hide panels based on available width, as documented in the [responsive layout report](2026-03-21-ratatui-responsive-layout-patterns.md):

```rust
if body.width >= 60 {
    let [tree_area, detail_area] = horizontal![>=25, *=1].areas(body);
    render_tree(frame, tree_area);
    render_detail(frame, detail_area);
} else {
    render_tree(frame, body);
}
```

## 7. Recommendations for sprack

### Widget Selection

| sprack Component | Widget | Rationale |
|-----------------|--------|-----------|
| Session tree | `tui-tree-widget::Tree` | Purpose-built: collapse/expand, mouse, scrollbar, per-node styling |
| Tree panel frame | `Block` (rounded borders) | Standard container pattern |
| Detail panel text | `Paragraph` | Styled multi-line text with wrapping |
| Detail panel frame | `Block` (rounded borders) | Matches tree panel style |
| Status bar | Raw `Line` rendered to footer `Rect` | Status bars are typically unbordered |
| Scroll indicator | `Tree::experimental_scrollbar()` | Built into tree widget |

### Styling Approach

Use the `Stylize` trait fluent API everywhere for readability.
Define a theme module that centralizes color choices:

```rust
mod theme {
    use catppuccin::PALETTE;
    use ratatui::style::{Color, Modifier, Style};

    pub fn mocha() -> &'static catppuccin::FlavorColors {
        &PALETTE.mocha.colors
    }

    pub fn active_pane() -> Style {
        Style::new().fg(mocha().text.into()).bold()
    }

    pub fn dimmed_session() -> Style {
        Style::new().fg(mocha().overlay0.into()).dim()
    }

    pub fn status_thinking() -> Style {
        Style::new().fg(mocha().yellow.into()).bold()
    }

    pub fn status_idle() -> Style {
        Style::new().fg(mocha().green.into()).dim()
    }

    pub fn status_error() -> Style {
        Style::new().fg(mocha().red.into()).bold()
    }

    pub fn selected() -> Style {
        Style::new().fg(mocha().base.into()).bg(mocha().lavender.into()).bold()
    }

    pub fn border_focused() -> Style {
        Style::new().fg(mocha().lavender.into())
    }

    pub fn border_unfocused() -> Style {
        Style::new().fg(mocha().surface1.into())
    }
}
```

### Tree Node Construction with Macros

Combine `ratatui-macros` with per-node styling for clean tree item creation:

```rust
use ratatui_macros::{line, span};

fn build_pane_line(pane: &PaneInfo, tier: LayoutTier) -> Line<'static> {
    match tier {
        LayoutTier::Compact => line![
            span!(theme::status_icon_style(pane.status); "{}", pane.status_icon()),
            format!(" {}", truncate(&pane.title, 15))
        ],
        LayoutTier::Standard => line![
            pane.title.clone().bold(),
            span!(Style::default().dim(); " ({})", pane.command),
            span!(theme::status_style(pane.status); " [{}]", pane.status_label()),
        ],
        _ => { /* Wide/Full with more detail */ }
    }
}
```

### Recommended Dependencies

```toml
[dependencies]
ratatui = "0.29"
crossterm = "0.28"
tui-tree-widget = "0.24"
ratatui-macros = "0.6"
catppuccin = { version = "2", features = ["ratatui"] }
unicode-width = "0.2"
```

Optional, add if needed:
- `tui-scrollview`: if the detail panel needs scrolling.
- `tui-popup`: if sprack adds confirmation dialogs or help overlays.

### Composition Summary

```
┌─header (1 row)──────────────────────────────────┐
│ sprack - 3 sessions, 8 windows                   │
├─body─────────────────────┬───────────────────────┤
│ ┌Sessions (rounded)─────┐│ ┌Detail (rounded)────┐│
│ │ v lace (22425)        ││ │ claude-opus-4-5     ││
│ │   v editor            ││ │   [thinking...]     ││
│ │ >>  shell (nvim) [*]  ││ │   3 subagents       ││
│ │     terminal (nu) [.]  ││ │   42% context       ││
│ │   > logs (3)          ││ │   last: Read         ││
│ │ > dotfiles (22430)    ││ │                     ││
│ │ > local               ││ │                     ││
│ └───────────────────────┘│ └─────────────────────┘│
├─footer (1 row)───────────────────────────────────┤
│ j/k: nav  Enter: focus  Space: toggle  q: quit   │
└──────────────────────────────────────────────────┘
```

At narrow widths (<60 cols), the detail panel hides and the tree fills the body.
At very narrow widths (<30 cols), status badges shrink to single-character icons.
Block borders consume 2 columns each, which matters in the 25-40 column range: consider `Padding::ZERO` and minimal borders for the compact tier.

## Sources

- [tui-tree-widget GitHub (EdJoPaTo)](https://github.com/EdJoPaTo/tui-rs-tree-widget)
- [tui-tree-widget crates.io](https://crates.io/crates/tui-tree-widget)
- [tui-tree-widget Tree struct docs](https://docs.rs/tui-tree-widget/0.24.0/tui_tree_widget/struct.Tree.html)
- [tui-tree-widget TreeItem docs](https://docs.rs/tui-tree-widget/0.24.0/tui_tree_widget/struct.TreeItem.html)
- [Ratatui Built-in Widgets Showcase](https://ratatui.rs/showcase/widgets/)
- [Ratatui Widgets Module docs](https://docs.rs/ratatui/latest/ratatui/widgets/index.html)
- [Ratatui Style Module docs](https://docs.rs/ratatui/latest/ratatui/style/)
- [Ratatui Stylize Trait docs](https://docs.rs/ratatui/latest/ratatui/style/trait.Stylize.html)
- [Ratatui Color enum docs](https://docs.rs/ratatui/latest/ratatui/style/enum.Color.html)
- [Ratatui Styling Text Recipe](https://ratatui.rs/recipes/render/style-text/)
- [Ratatui Block Widget docs](https://docs.rs/ratatui/latest/ratatui/widgets/struct.Block.html)
- [Ratatui Scrollbar docs](https://docs.rs/ratatui/latest/ratatui/widgets/struct.Scrollbar.html)
- [Ratatui Third-Party Widgets Showcase](https://ratatui.rs/showcase/third-party-widgets/)
- [Ratatui Examples](https://ratatui.rs/examples/)
- [Ratatui Templates](https://ratatui.rs/templates/)
- [Ratatui Component Template: Project Structure](https://ratatui.rs/templates/component/project-structure/)
- [ratatui-macros GitHub](https://github.com/ratatui/ratatui-macros)
- [ratatui-macros docs](https://docs.rs/ratatui-macros/latest/ratatui_macros/)
- [Catppuccin Rust crate](https://github.com/catppuccin/rust)
- [Catppuccin docs.rs](https://docs.rs/catppuccin)
- [tui-scrollview GitHub](https://github.com/joshka/tui-scrollview)
- [tui-widget-list GitHub](https://github.com/preiter93/tui-widget-list)
- [tui-widgets collection (ratatui org)](https://github.com/ratatui/tui-widgets)
- [awesome-ratatui: curated app/library list](https://github.com/ratatui/awesome-ratatui)
- [Yazi file manager](https://github.com/sxyazi/yazi)
- [GitUI terminal git client](https://github.com/gitui-org/gitui)
- [Ratatui Best Practices Discussion](https://github.com/ratatui/ratatui/discussions/220)
