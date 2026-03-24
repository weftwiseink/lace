//! Frame rendering functions.
//!
//! Renders the tree widget, detail panel, and status bar using
//! the centralized catppuccin mocha theme from `colors.rs`.

use ratatui::layout::Rect;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;
use tui_tree_widget::Tree;

use sprack_db::types::Integration;

use crate::app::App;
use crate::colors::Theme;
use crate::layout::{body_layout, frame_layout, layout_tier, LayoutTier};
use crate::tree::NodeId;

/// Renders a complete frame: tree, optional detail panel, and status bar.
pub fn render_frame(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let tier = layout_tier(area.width);
    let theme = Theme::mocha();

    let (body_area, status_area) = frame_layout(area);
    let (tree_area, detail_area) = body_layout(body_area, tier);

    render_tree(frame, app, tree_area, &theme);

    if let Some(detail_rect) = detail_area {
        render_detail_panel(frame, app, detail_rect, tier, &theme);
    }

    render_status_bar(frame, app, status_area, &theme);
}

/// Renders the tree widget.
fn render_tree(frame: &mut Frame, app: &mut App, area: Rect, theme: &Theme) {
    let tree_widget = Tree::new(&app.tree_items)
        .expect("tree items should have unique sibling identifiers")
        .block(Block::default().borders(Borders::NONE).style(theme.base_bg))
        .highlight_style(theme.tree_highlight)
        .highlight_symbol("> ")
        .node_closed_symbol("\u{25b6} ")
        .node_open_symbol("\u{25bc} ")
        .node_no_children_symbol("  ");

    frame.render_stateful_widget(tree_widget, area, &mut app.tree_state);
}

/// Renders the detail panel showing integration info for the selected pane.
fn render_detail_panel(frame: &mut Frame, app: &App, area: Rect, tier: LayoutTier, theme: &Theme) {
    let block = Block::default()
        .borders(Borders::LEFT)
        .border_style(theme.detail_border)
        .style(theme.base_bg);

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let selected_pane_id = find_selected_pane_id(app);
    let snapshot = match &app.last_snapshot {
        Some(s) => s,
        None => {
            render_empty_detail(frame, inner, theme);
            return;
        }
    };

    let pane_id = match &selected_pane_id {
        Some(id) => id.as_str(),
        None => {
            render_empty_detail(frame, inner, theme);
            return;
        }
    };

    let integrations: Vec<&Integration> = snapshot
        .integrations
        .iter()
        .filter(|i| i.pane_id == pane_id)
        .collect();

    if integrations.is_empty() {
        render_empty_detail(frame, inner, theme);
        return;
    }

    let lines = build_detail_lines(&integrations, tier, theme);
    let detail_text = Paragraph::new(lines).wrap(Wrap { trim: true });
    frame.render_widget(detail_text, inner);
}

/// Finds the pane_id of the currently selected node, if it is a pane.
fn find_selected_pane_id(app: &App) -> Option<String> {
    let selected = app.tree_state.selected();
    selected.last().and_then(|node_id| match node_id {
        NodeId::Pane(id) => Some(id.clone()),
        _ => None,
    })
}

/// Renders placeholder text when no detail is available.
fn render_empty_detail(frame: &mut Frame, area: Rect, theme: &Theme) {
    let text = Paragraph::new(Line::from(Span::styled(
        "Select a pane to view details",
        theme.detail_empty,
    )));
    frame.render_widget(text, area);
}

/// Builds detail panel lines for the selected pane's integrations.
fn build_detail_lines<'a>(
    integrations: &[&Integration],
    tier: LayoutTier,
    theme: &Theme,
) -> Vec<Line<'a>> {
    let mut lines = Vec::new();

    for integration in integrations {
        let (status_text, status_style) = theme.detail_status(&integration.status);

        // Integration kind + status.
        lines.push(Line::from(vec![
            Span::styled(integration.kind.clone(), theme.detail_kind_label),
            Span::raw(" "),
            Span::styled(status_text.to_string(), status_style),
        ]));

        // Summary line.
        if !integration.summary.is_empty() {
            lines.push(Line::from(Span::styled(
                format!("  {}", integration.summary),
                theme.detail_summary,
            )));
        }

        // Full tier shows additional metadata.
        if tier == LayoutTier::Full {
            lines.push(Line::from(Span::styled(
                format!("  updated: {}", integration.updated_at),
                theme.detail_metadata,
            )));
        }

        lines.push(Line::default());
    }

    lines
}

/// Renders the status bar at the bottom of the frame.
fn render_status_bar(frame: &mut Frame, app: &App, area: Rect, theme: &Theme) {
    let mut spans = Vec::new();

    // Poller health indicator.
    if app.poller_healthy {
        spans.push(Span::styled(" [poller: ok]", theme.status_healthy));
    } else {
        let stale_text = match &app.last_heartbeat {
            Some(ts) => format!(" [poller: stale ({ts})]"),
            None => " [poller: not started]".to_string(),
        };
        spans.push(Span::styled(stale_text, theme.status_unhealthy));
    }

    // Separator.
    spans.push(Span::styled(" | ", theme.status_separator));

    // Help hints.
    spans.push(Span::styled(
        "j/k:nav  h/l:collapse  enter:focus  q:quit",
        theme.status_help,
    ));

    let status_line = Line::from(spans);
    let status_bar = Paragraph::new(status_line).style(theme.status_bar_bg);
    frame.render_widget(status_bar, area);
}
