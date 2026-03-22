---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T19:30:00-07:00
task_list: terminal-management/sprack-tui
type: report
state: live
status: review_ready
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T20:15:00-07:00
  round: 1
tags: [ratatui, tui, responsive_layout, rust]
---

# Ratatui Responsive Layout Patterns for sprack

> BLUF: Ratatui has no built-in breakpoint system, but its constraint solver, `Flex` layout, and `Rect` geometry provide the primitives to build responsive UIs.
> The core pattern is: check `area.width` at render time, select constraints and content density accordingly, and use `Min`/`Max`/`Fill` to absorb size variation within each mode.
> For sprack's 28-col sidebar to full-width range, a two-mode approach (narrow/wide with a breakpoint around 40-45 columns) combined with `tui-tree-widget` and manual text truncation covers the requirements.
> Mouse support via crossterm is straightforward: `tui-tree-widget` provides `click_at()` and `rendered_at()` for hit testing.

## 1. Constraint System

Ratatui's layout engine is powered by the Cassowary constraint solver (via the `kasuari` crate).
Six constraint types control how space is allocated:

| Constraint | Behavior | Responsive use |
|---|---|---|
| `Length(n)` | Fixed `n` cells | Headers, borders, fixed chrome |
| `Min(n)` | At least `n` cells, expands to fill | Content areas with a floor |
| `Max(n)` | At most `n` cells | Preventing over-expansion |
| `Percentage(p)` | `p%` of parent | Proportional splits |
| `Ratio(a, b)` | `a/b` of parent | Fractional splits (more precise than %) |
| `Fill(weight)` | Absorbs excess space proportionally | Flexible content regions |

Priority order when constraints conflict: `Min` > `Max` > `Length` > `Percentage` > `Ratio` > `Fill`.

### Key behaviors for responsive design

`Min` and `Max` are the most important for responsive layouts because they set bounds without dictating exact sizes.
`Fill` is the flex-grow equivalent: it absorbs whatever space remains after higher-priority constraints are satisfied.

```rust
// Sidebar + main content: sidebar has a floor and ceiling, content fills the rest
let [sidebar, main] = Layout::horizontal([
    Constraint::Min(25),   // sidebar never narrower than 25
    Constraint::Fill(1),   // main content takes everything else
]).areas(frame.area());
```

When `Min` and `Max` are combined on the same slot, they create a bounded range:

```rust
// Sidebar: 25-40 cols, main: everything else
let layout = Layout::horizontal([
    Constraint::Min(25),
    Constraint::Fill(1),
]);
// The sidebar will get 25 cols. To cap it, nest with Max:
let [sidebar_bounded, _] = Layout::horizontal([
    Constraint::Max(40),
    Constraint::Fill(1),
]).areas(sidebar);
```

> NOTE(opus/sprack-tui): A single constraint slot cannot express both min and max simultaneously.
> Nesting layouts or using explicit width-checks is necessary for bounded ranges.

## 2. Flex Layout

The `Flex` enum controls how excess space distributes when constraints do not fill the entire area.
This was added in ratatui v0.26.0.

| Variant | Behavior |
|---|---|
| `Flex::Start` | Pack items to the start (default) |
| `Flex::End` | Pack items to the end |
| `Flex::Center` | Center items |
| `Flex::SpaceBetween` | Equal gaps between items |
| `Flex::SpaceAround` | Equal gaps around items |
| `Flex::SpaceEvenly` | Uniform spacing throughout |
| `Flex::Legacy` | Old behavior: last item stretches to fill |

For sprack, `Flex::Start` (the default) is the right choice for tree content.
`Flex::Center` is useful for centering a dialog or popup within a region.

### Spacing

`Layout::spacing(n)` inserts `n` cells between each split region:

```rust
Layout::horizontal([Length(15), Length(15), Length(15)])
    .spacing(1)  // 1-cell gap between buttons
    .flex(Flex::Center)
```

Spacing is ignored for `SpaceBetween`, `SpaceAround`, and `SpaceEvenly` (those variants control spacing themselves).

### The `areas` helper

`Layout::areas::<N>(rect)` returns a fixed-size array of `Rect`, which is ergonomic when the number of splits is known at compile time:

```rust
let [header, body, footer] = Layout::vertical([
    Constraint::Length(1),
    Constraint::Fill(1),
    Constraint::Length(1),
]).areas(frame.area());
```

## 3. Responsive Patterns: Width-Based Conditional Rendering

Ratatui has no built-in breakpoint or media-query system.
The community pattern is to check `area.width` (or `area.height`) and branch rendering logic.

### Pattern: width-mode enum

Define rendering modes and select based on available width:

```rust
enum LayoutMode {
    Narrow,  // ~25-40 cols (sidebar)
    Wide,    // 41+ cols (full panel or wide sidebar)
}

fn layout_mode(width: u16) -> LayoutMode {
    if width <= 40 {
        LayoutMode::Narrow
    } else {
        LayoutMode::Wide
    }
}

fn render(frame: &mut Frame, area: Rect, state: &AppState) {
    match layout_mode(area.width) {
        LayoutMode::Narrow => render_narrow(frame, area, state),
        LayoutMode::Wide => render_wide(frame, area, state),
    }
}
```

### Pattern: conditional constraints

Vary the constraint list itself based on width:

```rust
fn tree_layout(area: Rect) -> [Rect; 2] {
    let constraints = if area.width > 60 {
        // Wide: tree + detail panel
        [Constraint::Percentage(40), Constraint::Fill(1)]
    } else {
        // Narrow: tree only, full width
        [Constraint::Fill(1), Constraint::Length(0)]
    };
    Layout::horizontal(constraints).areas(area)
}
```

### Pattern: conditional content density

Render different amounts of detail based on width:

```rust
fn render_pane_line(pane: &Pane, width: u16) -> Line<'_> {
    if width >= 50 {
        // Full: icon + name + command + pid
        Line::from(vec![
            Span::raw(&pane.icon),
            Span::raw(" "),
            Span::styled(&pane.title, Style::default().bold()),
            Span::raw(" "),
            Span::raw(&pane.command),
            Span::raw(format!(" [{}]", pane.pid)),
        ])
    } else if width >= 30 {
        // Medium: icon + name + command
        Line::from(vec![
            Span::raw(&pane.icon),
            Span::raw(" "),
            Span::styled(&pane.title, Style::default().bold()),
            Span::raw(" "),
            Span::raw(truncate_with_ellipsis(&pane.command, width as usize - 15)),
        ])
    } else {
        // Narrow: icon + truncated name
        Line::from(vec![
            Span::raw(&pane.icon),
            Span::raw(" "),
            Span::raw(truncate_with_ellipsis(&pane.title, width as usize - 4)),
        ])
    }
}
```

### Pattern: hide/show optional panels

Show a preview or detail pane only when there is enough room:

```rust
fn render_main(frame: &mut Frame, area: Rect, state: &AppState) {
    if area.width >= 80 {
        let [tree_area, preview_area] = Layout::horizontal([
            Constraint::Min(30),
            Constraint::Fill(1),
        ]).areas(area);
        render_tree(frame, tree_area, state);
        render_preview(frame, preview_area, state);
    } else {
        render_tree(frame, area, state);
    }
}
```

## 4. Text Truncation and Ellipsis

Ratatui does not have a built-in truncation-with-ellipsis API (a PR for an `Overflow` type targeting v0.31+ is in progress but not merged).
You must implement truncation manually.

### Manual truncation with unicode-width

The `unicode-width` crate (already a transitive dependency of ratatui) provides `UnicodeWidthStr::width()` for correct display-width measurement:

```rust
use unicode_width::UnicodeWidthStr;

fn truncate_with_ellipsis(s: &str, max_width: usize) -> String {
    if s.width() <= max_width {
        return s.to_string();
    }
    if max_width <= 1 {
        return "\u{2026}".to_string(); // just the ellipsis
    }
    let target = max_width - 1; // reserve 1 col for ellipsis
    let mut width = 0;
    let mut end = 0;
    for (idx, ch) in s.char_indices() {
        let cw = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(0);
        if width + cw > target {
            break;
        }
        width += cw;
        end = idx + ch.len_utf8();
    }
    format!("{}\u{2026}", &s[..end])
}
```

> NOTE(opus/sprack-tui): CJK characters are 2 cells wide.
> The char-by-char approach above handles this correctly because `UnicodeWidthChar::width()` returns 2 for wide characters.
> Grapheme cluster iteration (via `unicode-segmentation`) is more correct for emoji sequences but adds complexity; char-level iteration is sufficient for typical terminal content (process names, paths).

### Buffer-level truncation

Ratatui's `Buffer::set_stringn()` writes at most `max_width` characters.
This truncates without an ellipsis indicator.
For widgets using the `Widget` trait, the render area `Rect` naturally clips: content written beyond the rect boundary is silently dropped.

### Paragraph wrapping vs. truncation

`Paragraph` supports wrapping via `.wrap(Wrap { trim: true })`.
Without `.wrap()`, lines are truncated at the widget boundary.
For tree nodes, truncation (not wrapping) is the right behavior: a single tree line should not wrap to multiple rows.

## 5. Tree Widget: `tui-tree-widget`

The [`tui-tree-widget`](https://crates.io/crates/tui-tree-widget) crate (v0.24.0, MIT, actively maintained) is the standard tree widget for ratatui.

### Core types

**`TreeItem<'text, Identifier>`**: a node with text, children, and a generic identifier.

```rust
use tui_tree_widget::{Tree, TreeItem, TreeState};

let items = vec![
    TreeItem::new("lace", "lace (22425)", vec![
        TreeItem::new("editor", "editor", vec![
            TreeItem::new_leaf("shell", "shell (nvim)"),
        ])?,
        TreeItem::new_leaf("terminal", "terminal (2)"),
    ])?,
    TreeItem::new_leaf("local", "local"),
];
```

Identifiers must implement `Clone + PartialEq + Eq + Hash` and need only be unique among siblings (like filenames in a directory).

**`TreeState<Identifier>`**: tracks selection, scroll offset, and expanded nodes.

### Navigation methods on `TreeState`

| Method | Behavior |
|---|---|
| `key_up()` | Move up in current depth or to parent |
| `key_down()` | Move down in current depth or into child |
| `key_left()` | Close selected node, or move to parent |
| `key_right()` | Open (expand) selected node |
| `toggle_selected()` | Toggle open/close on selected |
| `select_first()` | Select root |
| `select_last()` | Select last visible node |
| `scroll_up(n)` / `scroll_down(n)` | Scroll viewport |

All methods return `bool` indicating whether state changed, which is useful for conditional re-rendering.

### Mouse support

`TreeState` has built-in mouse support:

- **`click_at(position: Position) -> bool`**: selects or toggles the node at the given terminal position. This handles hit testing internally.
- **`rendered_at(position: Position) -> Option<&[Identifier]>`**: returns the identifier path of the node rendered at a position, for custom click handling.

These work because `TreeState::flatten()` tracks rendered positions during `render_stateful_widget`.

### Rendering

```rust
let tree_widget = Tree::new(&items)
    .expect("unique identifiers")
    .block(Block::bordered().title("Sessions"))
    .highlight_style(Style::default().bold().reversed());

frame.render_stateful_widget(tree_widget, tree_area, &mut tree_state);
```

### sprack implications

`tui-tree-widget` maps well to sprack's needs:
- Session/window/pane hierarchy maps to `TreeItem` nesting.
- Identifier can be a tmux ID string (e.g., `"$3"` for session, `"@7"` for window, `"%15"` for pane).
- `key_left`/`key_right` provide collapse/expand for free.
- `click_at` handles mouse clicks with no additional plumbing.

The main gap: `tui-tree-widget` renders each node as `Text` (which can be styled with `Span`s), but does not do width-aware truncation.
Truncation must happen when constructing the `TreeItem` text, not inside the widget.

## 6. Mouse Support via Crossterm

Mouse events come from crossterm, not ratatui.
Ratatui is render-only; the application's event loop handles input.

### Enabling mouse capture

```rust
use crossterm::event::{EnableMouseCapture, DisableMouseCapture};
use crossterm::execute;

// On startup
execute!(std::io::stdout(), EnableMouseCapture)?;

// On cleanup
execute!(std::io::stdout(), DisableMouseCapture)?;
```

> NOTE(opus/sprack-tui): `ratatui::init()` does NOT enable mouse capture by default.
> You must enable it explicitly.

### MouseEvent structure

```rust
// crossterm::event::MouseEvent
pub struct MouseEvent {
    pub kind: MouseEventKind,
    pub column: u16,
    pub row: u16,
    pub modifiers: KeyModifiers,
}
```

### MouseEventKind variants

| Variant | Description |
|---|---|
| `Down(MouseButton)` | Button pressed |
| `Up(MouseButton)` | Button released |
| `Drag(MouseButton)` | Move while button held |
| `Moved` | Move without button |
| `ScrollDown` | Scroll wheel down |
| `ScrollUp` | Scroll wheel up |
| `ScrollLeft` | Horizontal scroll left |
| `ScrollRight` | Horizontal scroll right |

`MouseButton` has `Left`, `Right`, and `Middle` variants.

> NOTE(opus/sprack-tui): Some terminals do not reliably report which button is involved in `Up` and `Drag` events, defaulting to `Left`.

### Hit testing pattern

For widgets that do not have built-in mouse support (unlike `tui-tree-widget`), use `Rect::contains()`:

```rust
use ratatui::layout::Position;

fn handle_mouse(event: MouseEvent, button_area: Rect) {
    let pos = Position { x: event.column, y: event.row };
    if button_area.contains(pos) {
        match event.kind {
            MouseEventKind::Down(MouseButton::Left) => { /* handle click */ }
            _ => {}
        }
    }
}
```

The pattern requires storing rendered `Rect` values from the layout phase and checking them in the event-handling phase.
This is the standard approach: ratatui discussions explicitly rejected adding interaction methods to `Rect` itself, keeping it as pure geometry.

### Scroll events for tree navigation

Map scroll events to tree navigation:

```rust
match event.kind {
    MouseEventKind::ScrollUp => { tree_state.scroll_up(3); }
    MouseEventKind::ScrollDown => { tree_state.scroll_down(3); }
    MouseEventKind::Down(MouseButton::Left) => {
        let pos = Position { x: event.column, y: event.row };
        tree_state.click_at(pos);
    }
    _ => {}
}
```

## 7. Practical Guidance for sprack

### Breakpoint strategy

sprack operates in a tmux pane that can range from ~25 columns (narrow sidebar) to full terminal width.
A two-mode approach is sufficient:

| Mode | Width | Content strategy |
|---|---|---|
| Narrow | 25-40 cols | Tree only. Short labels. Icon + truncated name. No detail column. |
| Wide | 41+ cols | Tree with richer labels. Optional detail/preview panel at 80+ cols. |

```rust
fn render(frame: &mut Frame, area: Rect, state: &mut AppState) {
    let [header, body, footer] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Fill(1),
        Constraint::Length(1),
    ]).areas(area);

    render_header(frame, header, state);
    render_footer(frame, footer, state);

    match layout_mode(body.width) {
        LayoutMode::Narrow => {
            render_tree(frame, body, state, body.width);
        }
        LayoutMode::Wide => {
            if body.width >= 80 {
                let [tree_area, detail_area] = Layout::horizontal([
                    Constraint::Min(30),
                    Constraint::Fill(1),
                ]).areas(body);
                render_tree(frame, tree_area, state, tree_area.width);
                render_detail(frame, detail_area, state);
            } else {
                render_tree(frame, body, state, body.width);
            }
        }
    }
}
```

### Tree node text construction

Build `TreeItem` text with width awareness at construction time:

```rust
fn build_pane_item<'a>(
    pane: &'a PaneInfo,
    available_width: u16,
) -> TreeItem<'a, String> {
    let indent = 4; // tui-tree-widget uses 2 per depth level
    let usable = (available_width as usize).saturating_sub(indent + 2);

    let label = if usable >= 25 {
        format!("{} {} ({})", pane.icon, pane.title, pane.command)
    } else {
        format!("{} {}", pane.icon, truncate_with_ellipsis(&pane.title, usable.saturating_sub(2)))
    };

    TreeItem::new_leaf(pane.id.clone(), label)
}
```

### Handling terminal resize

Crossterm emits `Event::Resize(cols, rows)` when the terminal (or tmux pane) resizes.
On resize, clear any cached layout state and re-render:

```rust
match crossterm::event::read()? {
    Event::Resize(_, _) => {
        // Terminal has been resized. Next render call will use new frame.area().
        // No special handling needed if you recompute layout every frame.
    }
    // ...
}
```

Since ratatui recomputes layout on every `draw()` call, responsive behavior is automatic: the width check in the render function naturally picks the right mode after a resize.

### Performance considerations

Ratatui caches layout results in thread-local storage (keyed on constraints + area), with a default cache of 500 entries.
Re-rendering the same layout at the same size is essentially free.
For sprack's polling loop (50-100ms), this means no-change frames are cheap.

## Sources

- [Ratatui Layout Concepts](https://ratatui.rs/concepts/layout/)
- [Constraint API Docs](https://docs.rs/ratatui/latest/ratatui/layout/enum.Constraint.html)
- [Layout API Docs](https://docs.rs/ratatui/latest/ratatui/layout/struct.Layout.html)
- [Rect API Docs](https://docs.rs/ratatui/latest/ratatui/layout/struct.Rect.html)
- [Flex Layout Example](https://ratatui.rs/examples/layout/flex/)
- [Ratatui v0.26.0 Highlights (Flex introduction)](https://ratatui.rs/highlights/v026/)
- [Event Handling Concepts](https://ratatui.rs/concepts/event-handling/)
- [Custom Widget Example (mouse handling)](https://ratatui.rs/examples/widgets/custom_widget/)
- [Mouse Events on Rect Discussion](https://github.com/ratatui/ratatui/discussions/1051)
- [tui-tree-widget on crates.io](https://crates.io/crates/tui-tree-widget)
- [tui-tree-widget GitHub](https://github.com/EdJoPaTo/tui-rs-tree-widget)
- [TreeState API Docs](https://docs.rs/tui-tree-widget/latest/tui_tree_widget/struct.TreeState.html)
- [TreeItem API Docs](https://docs.rs/tui-tree-widget/latest/tui_tree_widget/struct.TreeItem.html)
- [Crossterm MouseEventKind Docs](https://docs.rs/crossterm/latest/crossterm/event/enum.MouseEventKind.html)
- [Text Truncation PR (draft, v0.31+)](https://github.com/ratatui/ratatui/pull/2002)
- [Unicode Width Fix v0.26.3](https://ratatui.rs/highlights/v0263/)
- [Ratatui Layout Recipes](https://ratatui.rs/recipes/layout/)
