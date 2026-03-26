//! Frame rendering functions.
//!
//! Renders the tree widget, detail panel, and status bar using
//! the centralized catppuccin mocha theme from `colors.rs`.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;
use tui_tree_widget::Tree;

use sprack_db::types::Integration;

use crate::app::App;
use crate::colors::Theme;
use crate::layout::{body_layout, frame_layout, layout_tier, LayoutTier};
use crate::tree::{self, NodeId};

/// Renders a complete frame: tree, optional detail panel, and status bar.
pub fn render_frame(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let tier = layout_tier(area.width);
    let theme = Theme::mocha();

    // Rebuild tree items when the layout tier changes so labels match the viewport width.
    if tier != app.last_tier {
        app.last_tier = tier;
        if let Some(snapshot) = &app.last_snapshot {
            app.tree_items = tree::build_tree(snapshot, app.own_pane_id.as_deref(), tier);
        }
    }

    let (body_area, status_area) = frame_layout(area);
    let (tree_area, detail_area) = body_layout(body_area, tier);

    render_tree(frame, app, tree_area, &theme);

    if let Some(detail_rect) = detail_area {
        render_detail_panel(frame, app, detail_rect, tier, &theme);
    }

    render_status_bar(frame, app, status_area, &theme);
}

/// Renders a dump frame: tree only, no detail panel, no status bar.
///
/// Used by `--dump-rendered-tree` to produce a clean full-hierarchy output.
pub fn render_dump_frame(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let theme = Theme::mocha();

    render_tree(frame, app, area, &theme);
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
        if integration.kind == "claude_code" {
            build_claude_detail_lines(&mut lines, integration, tier, theme);
        } else {
            build_generic_detail_lines(&mut lines, integration, tier, theme);
        }
    }

    lines
}

/// Renders a structured detail view for Claude Code integrations.
fn build_claude_detail_lines<'a>(
    lines: &mut Vec<Line<'a>>,
    integration: &Integration,
    tier: LayoutTier,
    theme: &Theme,
) {
    let summary = match tree::parse_claude_summary(integration) {
        Some(s) => s,
        None => {
            build_generic_detail_lines(lines, integration, tier, theme);
            return;
        }
    };

    let (status_text, status_style) = theme.detail_status(&integration.status);

    // Header: model + state.
    let model_label = summary.model.as_deref().unwrap_or("unknown");
    lines.push(Line::from(vec![
        Span::styled(model_label.to_string(), theme.detail_kind_label),
        Span::raw(" "),
        Span::styled(status_text.to_string(), status_style),
    ]));

    // Context + subagents.
    let context_display = match (summary.tokens_used, summary.tokens_max) {
        (Some(used), Some(max)) => {
            use crate::tree::format_token_count;
            format!("{}/{} ({}%)", format_token_count(used), format_token_count(max), summary.context_percent)
        }
        _ => format!("{}%", summary.context_percent),
    };
    let mut info_spans = vec![
        Span::styled("  ctx: ", theme.detail_metadata),
        Span::styled(context_display, theme.detail_summary),
    ];
    if summary.subagent_count > 0 {
        info_spans.push(Span::styled(
            format!("  agents: {}", summary.subagent_count),
            theme.detail_summary,
        ));
    }
    lines.push(Line::from(info_spans));

    // Last tool.
    if let Some(ref tool) = summary.last_tool {
        lines.push(Line::from(vec![
            Span::styled("  tool: ", theme.detail_metadata),
            Span::styled(tool.clone(), theme.detail_summary),
        ]));
    }

    // Error message.
    if let Some(ref error) = summary.error_message {
        lines.push(Line::from(Span::styled(
            format!("  error: {error}"),
            theme.status_unhealthy,
        )));
    }

    // Tasks list (from hook events).
    if let Some(ref tasks) = summary.tasks {
        lines.push(Line::from(Span::styled(
            format!("  tasks: {}", tasks.len()),
            theme.detail_metadata,
        )));
        for task in tasks {
            let marker = if task.status == "completed" { "x" } else { " " };
            lines.push(Line::from(Span::styled(
                format!("    [{marker}] {}", task.subject),
                theme.detail_summary,
            )));
        }
    }

    // Session summary (from hook compact events).
    if let Some(ref session_summary) = summary.session_summary {
        lines.push(Line::default());
        lines.push(Line::from(Span::styled(
            session_summary.clone(),
            theme.detail_summary,
        )));
    }

    // Updated timestamp (full tier only).
    if tier == LayoutTier::Full {
        lines.push(Line::from(Span::styled(
            format!("  updated: {}", integration.updated_at),
            theme.detail_metadata,
        )));
    }

    lines.push(Line::default());
}

/// Renders a generic detail view for non-Claude integrations.
fn build_generic_detail_lines<'a>(
    lines: &mut Vec<Line<'a>>,
    integration: &Integration,
    tier: LayoutTier,
    theme: &Theme,
) {
    let (status_text, status_style) = theme.detail_status(&integration.status);

    lines.push(Line::from(vec![
        Span::styled(integration.kind.clone(), theme.detail_kind_label),
        Span::raw(" "),
        Span::styled(status_text.to_string(), status_style),
    ]));

    if !integration.summary.is_empty() {
        lines.push(Line::from(Span::styled(
            format!("  {}", integration.summary),
            theme.detail_summary,
        )));
    }

    if tier == LayoutTier::Full {
        lines.push(Line::from(Span::styled(
            format!("  updated: {}", integration.updated_at),
            theme.detail_metadata,
        )));
    }

    lines.push(Line::default());
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
        "j/k:nav  h/l:collapse  enter:focus  q/^C:quit",
        theme.status_help,
    ));

    let status_line = Line::from(spans);
    let status_bar = Paragraph::new(status_line).style(theme.status_bar_bg);
    frame.render_widget(status_bar, area);
}

/// Converts a ratatui Buffer to a plain-text string.
///
/// Each row becomes one line with trailing whitespace trimmed.
/// Used by `--dump-rendered-tree` and snapshot tests.
pub fn buffer_to_string(buffer: &Buffer) -> String {
    let area = buffer.area;
    let mut output = String::new();
    for y in area.y..area.y + area.height {
        for x in area.x..area.x + area.width {
            let cell = &buffer[(x, y)];
            output.push_str(cell.symbol());
        }
        let trimmed = output.trim_end();
        output.truncate(trimmed.len());
        output.push('\n');
    }
    output
}
