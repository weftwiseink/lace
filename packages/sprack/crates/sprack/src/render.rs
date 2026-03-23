//! Frame rendering functions.
//!
//! Renders the tree widget, detail panel, and status bar using
//! catppuccin mocha colors.

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;
use tui_tree_widget::Tree;

use sprack_db::types::{Integration, ProcessStatus};

use crate::app::App;
use crate::colors::cat_color;
use crate::layout::{body_layout, frame_layout, layout_tier, LayoutTier};
use crate::tree::NodeId;

/// Renders a complete frame: tree, optional detail panel, and status bar.
pub fn render_frame(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let tier = layout_tier(area.width);
    let mocha = &catppuccin::PALETTE.mocha.colors;

    let (body_area, status_area) = frame_layout(area);
    let (tree_area, detail_area) = body_layout(body_area, tier);

    render_tree(frame, app, tree_area, mocha);

    if let Some(detail_rect) = detail_area {
        render_detail_panel(frame, app, detail_rect, tier, mocha);
    }

    render_status_bar(frame, app, status_area, mocha);
}

/// Renders the tree widget.
fn render_tree(frame: &mut Frame, app: &mut App, area: Rect, mocha: &catppuccin::FlavorColors) {
    let highlight_style = Style::default()
        .fg(cat_color(mocha.text))
        .bg(cat_color(mocha.surface0))
        .add_modifier(Modifier::BOLD);

    let tree_widget = Tree::new(&app.tree_items)
        .expect("tree items should have unique sibling identifiers")
        .block(
            Block::default()
                .borders(Borders::NONE)
                .style(Style::default().bg(cat_color(mocha.base))),
        )
        .highlight_style(highlight_style)
        .highlight_symbol("> ")
        .node_closed_symbol("\u{25b6} ") // right-pointing triangle
        .node_open_symbol("\u{25bc} ") // down-pointing triangle
        .node_no_children_symbol("  ");

    frame.render_stateful_widget(tree_widget, area, &mut app.tree_state);
}

/// Renders the detail panel showing integration info for the selected pane.
fn render_detail_panel(
    frame: &mut Frame,
    app: &App,
    area: Rect,
    tier: LayoutTier,
    mocha: &catppuccin::FlavorColors,
) {
    let block = Block::default()
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(cat_color(mocha.surface1)))
        .style(Style::default().bg(cat_color(mocha.base)));

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let selected_pane_id = find_selected_pane_id(app);
    let snapshot = match &app.last_snapshot {
        Some(s) => s,
        None => {
            render_empty_detail(frame, inner, mocha);
            return;
        }
    };

    let pane_id = match &selected_pane_id {
        Some(id) => id.as_str(),
        None => {
            render_empty_detail(frame, inner, mocha);
            return;
        }
    };

    let integrations: Vec<&Integration> = snapshot
        .integrations
        .iter()
        .filter(|i| i.pane_id == pane_id)
        .collect();

    if integrations.is_empty() {
        render_empty_detail(frame, inner, mocha);
        return;
    }

    let lines = build_detail_lines(&integrations, tier, mocha);
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
fn render_empty_detail(frame: &mut Frame, area: Rect, mocha: &catppuccin::FlavorColors) {
    let text = Paragraph::new(Line::from(Span::styled(
        "Select a pane to view details",
        Style::default().fg(cat_color(mocha.overlay0)),
    )));
    frame.render_widget(text, area);
}

/// Builds detail panel lines for the selected pane's integrations.
fn build_detail_lines<'a>(
    integrations: &[&Integration],
    tier: LayoutTier,
    mocha: &catppuccin::FlavorColors,
) -> Vec<Line<'a>> {
    let mut lines = Vec::new();

    for integration in integrations {
        let (status_text, status_style) = format_detail_status(&integration.status, mocha);

        // Integration kind + status.
        lines.push(Line::from(vec![
            Span::styled(
                integration.kind.clone(),
                Style::default()
                    .fg(cat_color(mocha.text))
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(status_text, status_style),
        ]));

        // Summary line.
        if !integration.summary.is_empty() {
            lines.push(Line::from(Span::styled(
                format!("  {}", integration.summary),
                Style::default().fg(cat_color(mocha.subtext1)),
            )));
        }

        // Full tier shows additional metadata.
        if tier == LayoutTier::Full {
            lines.push(Line::from(Span::styled(
                format!("  updated: {}", integration.updated_at),
                Style::default().fg(cat_color(mocha.overlay0)),
            )));
        }

        lines.push(Line::default());
    }

    lines
}

/// Formats a process status for the detail panel.
fn format_detail_status(
    status: &ProcessStatus,
    mocha: &catppuccin::FlavorColors,
) -> (String, Style) {
    match status {
        ProcessStatus::Thinking => (
            "[thinking...]".to_string(),
            Style::default()
                .fg(cat_color(mocha.yellow))
                .add_modifier(Modifier::BOLD),
        ),
        ProcessStatus::ToolUse => (
            "[tool use]".to_string(),
            Style::default()
                .fg(cat_color(mocha.teal))
                .add_modifier(Modifier::BOLD),
        ),
        ProcessStatus::Idle => (
            "[idle]".to_string(),
            Style::default().fg(cat_color(mocha.green)),
        ),
        ProcessStatus::Error => (
            "[error]".to_string(),
            Style::default()
                .fg(cat_color(mocha.red))
                .add_modifier(Modifier::BOLD),
        ),
        ProcessStatus::Waiting => (
            "[waiting]".to_string(),
            Style::default().fg(cat_color(mocha.text)),
        ),
        ProcessStatus::Complete => (
            "[complete]".to_string(),
            Style::default()
                .fg(cat_color(mocha.overlay0))
                .add_modifier(Modifier::DIM),
        ),
    }
}

/// Renders the status bar at the bottom of the frame.
fn render_status_bar(frame: &mut Frame, app: &App, area: Rect, mocha: &catppuccin::FlavorColors) {
    let mut spans = Vec::new();

    // Poller health indicator.
    if app.poller_healthy {
        spans.push(Span::styled(
            " [poller: ok]",
            Style::default().fg(cat_color(mocha.green)),
        ));
    } else {
        let stale_text = match &app.last_heartbeat {
            Some(ts) => format!(" [poller: stale ({ts})]"),
            None => " [poller: not started]".to_string(),
        };
        spans.push(Span::styled(
            stale_text,
            Style::default()
                .fg(cat_color(mocha.red))
                .add_modifier(Modifier::BOLD),
        ));
    }

    // Separator.
    spans.push(Span::styled(
        " | ",
        Style::default().fg(cat_color(mocha.surface2)),
    ));

    // Help hints.
    spans.push(Span::styled(
        "j/k:nav  h/l:collapse  enter:focus  q:quit",
        Style::default().fg(cat_color(mocha.overlay1)),
    ));

    let status_line = Line::from(spans);
    let status_bar =
        Paragraph::new(status_line).style(Style::default().bg(cat_color(mocha.mantle)));
    frame.render_widget(status_bar, area);
}
