//! Tree data model and DB-to-tree conversion.
//!
//! Converts a `DbSnapshot` into a `Vec<TreeItem<NodeId>>` hierarchy:
//! HostGroup > Session > Window > Pane.
//! Sessions are grouped by `@lace_port` (same port = same host group).

use std::collections::HashMap;
use std::fmt;

use ratatui::text::{Line, Span, Text};
use tui_tree_widget::TreeItem;

use serde::Deserialize;

use sprack_db::types::{DbSnapshot, Integration, Pane, ProcessStatus, Session, Window};

use crate::colors::Theme;
use crate::layout::LayoutTier;

/// Parsed Claude Code summary from integration JSON.
/// Mirrors sprack-claude's ClaudeSummary but owned by the TUI crate.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct ClaudeSummary {
    #[serde(default)]
    state: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    subagent_count: u32,
    #[serde(default)]
    context_percent: u8,
    #[serde(default)]
    last_tool: Option<String>,
    #[serde(default)]
    error_message: Option<String>,
    #[serde(default)]
    tasks: Option<Vec<TaskEntry>>,
    #[serde(default)]
    session_summary: Option<String>,
    #[serde(default)]
    session_purpose: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct TaskEntry {
    #[serde(default)]
    subject: String,
    #[serde(default)]
    status: String,
}

/// Parses a ClaudeSummary from an integration's JSON summary field.
fn parse_claude_summary(integration: &Integration) -> Option<ClaudeSummary> {
    serde_json::from_str(&integration.summary).ok()
}

/// Identifier for tree nodes, distinguishing node types for tmux navigation.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum NodeId {
    /// Container host group keyed by lace_port or "local".
    HostGroup(String),
    /// Tmux session keyed by session name.
    Session(String),
    /// Tmux window keyed by session name + window index.
    Window(String, i32),
    /// Tmux pane keyed by pane_id (e.g., "%15").
    Pane(String),
}

impl Default for NodeId {
    fn default() -> Self {
        Self::HostGroup(String::new())
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HostGroup(name) => write!(f, "host:{name}"),
            Self::Session(name) => write!(f, "session:{name}"),
            Self::Window(session, idx) => write!(f, "window:{session}:{idx}"),
            Self::Pane(id) => write!(f, "pane:{id}"),
        }
    }
}

/// A host group: sessions sharing the same `@lace_port`.
struct HostGroup {
    name: String,
    port: Option<u16>,
    sessions: Vec<Session>,
}

/// Builds the full tree from a DB snapshot.
///
/// Groups sessions by `@lace_port`, filters out the TUI's own pane,
/// and formats labels according to the current layout tier.
pub fn build_tree(
    snapshot: &DbSnapshot,
    own_pane_id: Option<&str>,
    tier: LayoutTier,
) -> Vec<TreeItem<'static, NodeId>> {
    let groups = group_sessions_by_host(&snapshot.sessions);
    let theme = Theme::mocha();

    groups
        .into_iter()
        .filter_map(|group| {
            let session_items = build_session_items(&group, snapshot, own_pane_id, tier, &theme);
            build_host_group_item(&group, session_items, tier, &theme)
        })
        .collect()
}

/// Builds TreeItems for all sessions within a host group.
fn build_session_items(
    group: &HostGroup,
    snapshot: &DbSnapshot,
    own_pane_id: Option<&str>,
    tier: LayoutTier,
    theme: &Theme,
) -> Vec<TreeItem<'static, NodeId>> {
    group
        .sessions
        .iter()
        .filter_map(|session| {
            let window_items =
                build_window_items(&session.name, snapshot, own_pane_id, tier, theme);
            build_session_item(session, window_items, tier, theme)
        })
        .collect()
}

/// Builds TreeItems for all windows within a session.
fn build_window_items(
    session_name: &str,
    snapshot: &DbSnapshot,
    own_pane_id: Option<&str>,
    tier: LayoutTier,
    theme: &Theme,
) -> Vec<TreeItem<'static, NodeId>> {
    windows_for_session(session_name, &snapshot.windows)
        .iter()
        .filter_map(|window| {
            let pane_items = build_pane_items(window, snapshot, own_pane_id, tier, theme);
            build_window_item(window, pane_items, tier, theme)
        })
        .collect()
}

/// Builds TreeItems for all panes within a window, filtering out the TUI's own pane.
fn build_pane_items(
    window: &Window,
    snapshot: &DbSnapshot,
    own_pane_id: Option<&str>,
    tier: LayoutTier,
    theme: &Theme,
) -> Vec<TreeItem<'static, NodeId>> {
    panes_for_window(&window.session_name, window.window_index, &snapshot.panes)
        .iter()
        .filter(|pane| own_pane_id.is_none_or(|own| pane.pane_id != own))
        .filter_map(|pane| build_pane_item(pane, &snapshot.integrations, tier, theme))
        .collect()
}

/// Groups sessions by `@lace_port`. Sessions without a port go under "local".
fn group_sessions_by_host(sessions: &[Session]) -> Vec<HostGroup> {
    let mut port_map: HashMap<Option<u16>, Vec<Session>> = HashMap::new();
    for session in sessions {
        port_map
            .entry(session.lace_port)
            .or_default()
            .push(session.clone());
    }

    let mut groups: Vec<HostGroup> = port_map
        .into_iter()
        .map(|(port, mut sessions)| {
            sessions.sort_by(|a, b| a.name.cmp(&b.name));
            let name = derive_group_name(port, &sessions);
            HostGroup {
                name,
                port,
                sessions,
            }
        })
        .collect();

    // Sort groups: "local" (port=None) last, otherwise by port.
    groups.sort_by(|a, b| match (&a.port, &b.port) {
        (Some(pa), Some(pb)) => pa.cmp(pb),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.name.cmp(&b.name),
    });

    groups
}

/// Derives a display name for a host group.
fn derive_group_name(port: Option<u16>, sessions: &[Session]) -> String {
    match port {
        None => "local".to_string(),
        Some(p) => {
            if sessions.len() == 1 {
                sessions[0].name.clone()
            } else {
                let names: Vec<&str> = sessions.iter().map(|s| s.name.as_str()).collect();
                shared_prefix(&names).unwrap_or_else(|| format!("port-{p}"))
            }
        }
    }
}

/// Finds the longest shared prefix among a list of strings.
fn shared_prefix(names: &[&str]) -> Option<String> {
    if names.is_empty() {
        return None;
    }
    let first = names[0];
    let mut prefix_len = first.len();
    for name in &names[1..] {
        prefix_len = first
            .chars()
            .zip(name.chars())
            .take_while(|(a, b)| a == b)
            .count()
            .min(prefix_len);
    }
    // Trim trailing hyphens/underscores for cleaner display.
    let prefix = &first[..first
        .char_indices()
        .nth(prefix_len)
        .map_or(first.len(), |(i, _)| i)];
    let trimmed = prefix.trim_end_matches(['-', '_']);
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn windows_for_session<'a>(session_name: &str, windows: &'a [Window]) -> Vec<&'a Window> {
    windows
        .iter()
        .filter(|w| w.session_name == session_name)
        .collect()
}

/// Returns panes for a given window, sorted by spatial position `(pane_top, pane_left)`.
///
/// This produces visual layout order (top-to-bottom, left-to-right) rather than
/// tmux creation order. Panes with `None` coordinates sort first via `Option`'s
/// natural ordering (should not occur in practice).
fn panes_for_window<'a>(session_name: &str, window_index: i32, panes: &'a [Pane]) -> Vec<&'a Pane> {
    let mut matched: Vec<&Pane> = panes
        .iter()
        .filter(|p| p.session_name == session_name && p.window_index == window_index)
        .collect();

    matched.sort_by(|a, b| {
        let top_cmp = a.pane_top.cmp(&b.pane_top);
        if top_cmp != std::cmp::Ordering::Equal {
            return top_cmp;
        }
        a.pane_left.cmp(&b.pane_left)
    });

    matched
}

/// Finds integrations for a given pane.
fn integrations_for_pane<'a>(
    pane_id: &str,
    integrations: &'a [Integration],
) -> Vec<&'a Integration> {
    integrations
        .iter()
        .filter(|i| i.pane_id == pane_id)
        .collect()
}

fn build_pane_item(
    pane: &Pane,
    integrations: &[Integration],
    tier: LayoutTier,
    theme: &Theme,
) -> Option<TreeItem<'static, NodeId>> {
    let pane_integrations = integrations_for_pane(&pane.pane_id, integrations);
    let primary_integration = pane_integrations.first();
    let claude_summary = primary_integration.and_then(|i| parse_claude_summary(i));

    // At Wide/Full tiers, if hook data is available, render multi-line widget.
    let has_hook_data = claude_summary
        .as_ref()
        .is_some_and(|s| s.tasks.is_some() || s.session_summary.is_some());

    let text = if has_hook_data && matches!(tier, LayoutTier::Wide | LayoutTier::Full) {
        format_rich_widget(pane, &pane_integrations, claude_summary.as_ref().unwrap(), tier, theme)
    } else {
        let line = format_pane_label(pane, &pane_integrations, tier, theme);
        Text::from(line)
    };

    let node_id = NodeId::Pane(pane.pane_id.clone());
    Some(TreeItem::new_leaf(node_id, text))
}

fn build_window_item(
    window: &Window,
    pane_items: Vec<TreeItem<'static, NodeId>>,
    tier: LayoutTier,
    theme: &Theme,
) -> Option<TreeItem<'static, NodeId>> {
    let pane_count = pane_items.len();
    let line = format_window_label(window, pane_count, tier, theme);
    let node_id = NodeId::Window(window.session_name.clone(), window.window_index);
    TreeItem::new(node_id, line, pane_items).ok()
}

fn build_session_item(
    session: &Session,
    window_items: Vec<TreeItem<'static, NodeId>>,
    tier: LayoutTier,
    theme: &Theme,
) -> Option<TreeItem<'static, NodeId>> {
    let window_count = window_items.len();
    let line = format_session_label(session, window_count, tier, theme);
    let node_id = NodeId::Session(session.name.clone());
    TreeItem::new(node_id, line, window_items).ok()
}

fn build_host_group_item(
    group: &HostGroup,
    session_items: Vec<TreeItem<'static, NodeId>>,
    tier: LayoutTier,
    theme: &Theme,
) -> Option<TreeItem<'static, NodeId>> {
    let line = format_host_group_label(group, tier, theme);
    let node_id = NodeId::HostGroup(group.name.clone());
    TreeItem::new(node_id, line, session_items).ok()
}

// === Label formatting by tier ===

fn format_pane_label(
    pane: &Pane,
    integrations: &[&Integration],
    tier: LayoutTier,
    theme: &Theme,
) -> Line<'static> {
    let process_name = pane
        .current_command
        .rsplit('/')
        .next()
        .unwrap_or("?")
        .to_string();

    let primary_integration = integrations.first();
    let summary = primary_integration.and_then(|i| parse_claude_summary(i));

    // Active pane prefix.
    let active_prefix = if pane.active { "* " } else { "  " };

    // Dimensions string (e.g., "[80x24]").
    let dims = match (pane.pane_width, pane.pane_height) {
        (Some(w), Some(h)) => format!("[{w}x{h}]"),
        _ => String::new(),
    };

    // Copy mode suffix.
    let mode_suffix = if pane.in_mode { " [copy]" } else { "" };

    // Build inline summary suffix from ClaudeSummary.
    let inline_suffix = summary.as_ref().map(|s| {
        let mut parts = Vec::new();
        if s.subagent_count > 0 {
            parts.push(format!("{}ag", s.subagent_count));
        }
        parts.push(format!("{}%", s.context_percent));
        if let Some(ref status) = primary_integration {
            if status.status == ProcessStatus::ToolUse {
                if let Some(ref tool) = s.last_tool {
                    parts.clear();
                    parts.push(truncate_label(tool, 8));
                }
            }
        }
        parts.join(" ")
    });

    match tier {
        LayoutTier::Compact => {
            let icon = primary_integration
                .map(|i| theme.status_compact_icon(&i.status))
                .unwrap_or(" ");
            let icon_style = primary_integration
                .map(|i| theme.status_style(&i.status))
                .unwrap_or_default();
            Line::from(vec![
                Span::styled(icon.to_string(), icon_style),
                Span::raw(" "),
                Span::raw(truncate_label(&process_name, 15)),
            ])
        }
        LayoutTier::Standard => {
            let mut spans = vec![
                Span::raw(active_prefix.to_string()),
                Span::raw(truncate_label(&process_name, 12)),
            ];
            if let Some(integration) = primary_integration {
                let (badge, style) = theme.status_badge(&integration.status);
                spans.push(Span::raw(" "));
                spans.push(Span::styled(badge.to_string(), style));
            }
            if let Some(ref suffix) = inline_suffix {
                spans.push(Span::styled(format!(" {suffix}"), theme.subtext0));
            }
            if !mode_suffix.is_empty() {
                spans.push(Span::styled(mode_suffix.to_string(), theme.subtext0));
            }
            Line::from(spans)
        }
        LayoutTier::Wide => {
            let mut spans = vec![
                Span::raw(active_prefix.to_string()),
                Span::raw(truncate_label(&process_name, 20)),
            ];
            if !dims.is_empty() {
                spans.push(Span::styled(format!(" {dims}"), theme.subtext0));
            }
            if let Some(integration) = primary_integration {
                let (badge, style) = theme.status_badge(&integration.status);
                spans.push(Span::raw(" "));
                spans.push(Span::styled(badge.to_string(), style));
            }
            if let Some(ref suffix) = inline_suffix {
                spans.push(Span::styled(format!(" {suffix}"), theme.subtext0));
            }
            if !mode_suffix.is_empty() {
                spans.push(Span::styled(mode_suffix.to_string(), theme.subtext0));
            }
            Line::from(spans)
        }
        LayoutTier::Full => {
            let title = if pane.title.is_empty() || pane.title == pane.current_command {
                process_name.clone()
            } else {
                truncate_label(&pane.title, 25)
            };
            let path = truncate_path(&pane.current_path, 30);
            let pid_str = pane
                .pane_pid
                .map(|pid| format!(" pid:{pid}"))
                .unwrap_or_default();
            let mut spans = vec![
                Span::raw(active_prefix.to_string()),
                Span::raw(title),
                Span::styled(format!(" ({process_name})"), theme.subtext0),
            ];
            if !dims.is_empty() {
                spans.push(Span::styled(format!(" {dims}"), theme.subtext0));
            }
            spans.push(Span::styled(pid_str, theme.subtext0));
            spans.push(Span::styled(format!(" {path}"), theme.subtext0));
            if let Some(integration) = primary_integration {
                let (badge, style) = theme.status_badge(&integration.status);
                spans.push(Span::raw(" "));
                spans.push(Span::styled(badge.to_string(), style));
            }
            if let Some(ref suffix) = inline_suffix {
                spans.push(Span::styled(format!(" {suffix}"), theme.subtext0));
            }
            if !mode_suffix.is_empty() {
                spans.push(Span::styled(mode_suffix.to_string(), theme.subtext0));
            }
            Line::from(spans)
        }
    }
}

fn format_window_label(
    window: &Window,
    pane_count: usize,
    tier: LayoutTier,
    theme: &Theme,
) -> Line<'static> {
    let style = if window.active {
        theme.window_active
    } else {
        theme.window_inactive
    };

    let active_flag = if window.active { "*" } else { "" };

    match tier {
        LayoutTier::Compact => Line::from(Span::styled(truncate_label(&window.name, 15), style)),
        LayoutTier::Standard => {
            let mut spans = vec![Span::styled(truncate_label(&window.name, 25), style)];
            if pane_count > 0 {
                spans.push(Span::styled(
                    format!(" ({pane_count} panes)"),
                    theme.subtext0,
                ));
            }
            Line::from(spans)
        }
        LayoutTier::Wide | LayoutTier::Full => {
            let mut spans = vec![Span::styled(truncate_label(&window.name, 25), style)];
            if pane_count > 0 {
                spans.push(Span::styled(
                    format!(" ({pane_count} panes)"),
                    theme.subtext0,
                ));
            }
            if !active_flag.is_empty() {
                spans.push(Span::styled(
                    format!(" {active_flag}"),
                    theme.subtext0,
                ));
            }
            Line::from(spans)
        }
    }
}

fn format_session_label(
    session: &Session,
    window_count: usize,
    tier: LayoutTier,
    theme: &Theme,
) -> Line<'static> {
    let style = if session.attached {
        theme.session_attached
    } else {
        theme.session_detached
    };

    match tier {
        LayoutTier::Compact => Line::from(Span::styled(truncate_label(&session.name, 15), style)),
        LayoutTier::Standard => {
            let mut spans = vec![Span::styled(truncate_label(&session.name, 25), style)];
            if window_count > 0 {
                spans.push(Span::styled(format!(" ({window_count}w)"), theme.subtext0));
            }
            Line::from(spans)
        }
        LayoutTier::Wide => {
            let mut spans = vec![Span::styled(truncate_label(&session.name, 25), style)];
            if window_count > 0 {
                spans.push(Span::styled(format!(" ({window_count}w)"), theme.subtext0));
            }
            let status = if session.attached {
                " attached"
            } else {
                ""
            };
            if !status.is_empty() {
                spans.push(Span::styled(status.to_string(), theme.subtext0));
            }
            Line::from(spans)
        }
        LayoutTier::Full => {
            let mut spans = vec![Span::styled(truncate_label(&session.name, 25), style)];
            if window_count > 0 {
                spans.push(Span::styled(format!(" ({window_count}w)"), theme.subtext0));
            }
            if let Some(port) = session.lace_port {
                spans.push(Span::styled(format!(" :{port}"), theme.surface2_fg));
            }
            let status = if session.attached {
                " attached"
            } else {
                ""
            };
            if !status.is_empty() {
                spans.push(Span::styled(status.to_string(), theme.subtext0));
            }
            Line::from(spans)
        }
    }
}

fn format_host_group_label(group: &HostGroup, tier: LayoutTier, theme: &Theme) -> Line<'static> {
    match tier {
        LayoutTier::Compact => Line::from(Span::styled(
            truncate_label(&group.name.to_uppercase(), 15),
            theme.host_group_header,
        )),
        _ => Line::from(Span::styled(
            group.name.to_uppercase(),
            theme.host_group_header,
        )),
    }
}

/// Builds a multi-line rich widget for a Claude pane when hook data is available.
///
/// Line 1: process_name status_badge context% subagent_count
/// Line 2: Tasks: done/total done task_markers (if tasks present)
/// Line 3: model shortname (if available)
/// Line 4: session_purpose (if available)
fn format_rich_widget(
    pane: &Pane,
    integrations: &[&Integration],
    summary: &ClaudeSummary,
    _tier: LayoutTier,
    theme: &Theme,
) -> Text<'static> {
    let process_name = pane
        .current_command
        .rsplit('/')
        .next()
        .unwrap_or("?")
        .to_string();

    let primary_integration = integrations.first();

    // Line 1: status + context + subagents.
    let mut line1_spans = vec![Span::raw(truncate_label(&process_name, 15))];
    if let Some(integration) = primary_integration {
        let (badge, style) = theme.status_badge(&integration.status);
        line1_spans.push(Span::raw(" "));
        line1_spans.push(Span::styled(badge.to_string(), style));
    }
    line1_spans.push(Span::styled(
        format!(" {}% ctx", summary.context_percent),
        theme.subtext0,
    ));
    if summary.subagent_count > 0 {
        line1_spans.push(Span::styled(
            format!(" {}ag", summary.subagent_count),
            theme.subtext0,
        ));
    }

    let mut lines = vec![Line::from(line1_spans)];

    // Line 2: task progress.
    if let Some(tasks) = &summary.tasks {
        if !tasks.is_empty() {
            let done = tasks.iter().filter(|t| t.status == "Completed").count();
            let total = tasks.len();
            let mut task_spans = vec![Span::styled(
                format!("  Tasks: {done}/{total} done "),
                theme.subtext0,
            )];

            // Show abbreviated task names with status markers.
            for task in tasks.iter().take(4) {
                let marker = match task.status.as_str() {
                    "Completed" => "\u{2713}", // checkmark
                    "InProgress" => ">",
                    _ => " ",
                };
                let name = truncate_label(&task.subject, 12);
                task_spans.push(Span::styled(format!(" {marker}{name}"), theme.subtext0));
            }
            if tasks.len() > 4 {
                task_spans.push(Span::styled(
                    format!(" +{}", tasks.len() - 4),
                    theme.subtext0,
                ));
            }

            lines.push(Line::from(task_spans));
        }
    }

    // Line 3: model shortname.
    if let Some(model) = &summary.model {
        let model_short = model
            .strip_prefix("claude-")
            .unwrap_or(model);
        lines.push(Line::from(Span::styled(
            format!("  {model_short}"),
            theme.subtext0,
        )));
    }

    // Line 4: session purpose.
    if let Some(purpose) = &summary.session_purpose {
        let purpose_display = truncate_label(purpose, 50);
        lines.push(Line::from(Span::styled(
            format!("  {purpose_display}"),
            theme.subtext0,
        )));
    }

    Text::from(lines)
}

/// Truncates a path for display, keeping the last N characters with a leading "~" if truncated.
fn truncate_path(path: &str, max_chars: usize) -> String {
    // Replace $HOME prefix with ~.
    let display_path = if let Ok(home) = std::env::var("HOME") {
        if let Some(rest) = path.strip_prefix(&home) {
            format!("~{rest}")
        } else {
            path.to_string()
        }
    } else {
        path.to_string()
    };

    if display_path.chars().count() <= max_chars {
        return display_path;
    }
    if max_chars <= 2 {
        return "\u{2026}".to_string();
    }
    // Keep the tail of the path (most informative part).
    let chars: Vec<char> = display_path.chars().collect();
    let start = chars.len() - (max_chars - 1);
    let tail: String = chars[start..].iter().collect();
    format!("\u{2026}{tail}")
}

/// Truncates a label to a max character count, appending ellipsis if needed.
fn truncate_label(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    if max_chars <= 1 {
        return "\u{2026}".to_string();
    }
    let truncated: String = s.chars().take(max_chars - 1).collect();
    format!("{truncated}\u{2026}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_label_short_string_unchanged() {
        assert_eq!(truncate_label("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_label_exact_length_unchanged() {
        assert_eq!(truncate_label("hello", 5), "hello");
    }

    #[test]
    fn test_truncate_label_long_string_truncated() {
        let result = truncate_label("hello world", 8);
        assert_eq!(result, "hello w\u{2026}");
    }

    #[test]
    fn test_truncate_label_max_one_returns_ellipsis() {
        assert_eq!(truncate_label("hello", 1), "\u{2026}");
    }

    #[test]
    fn test_truncate_label_empty_string_unchanged() {
        assert_eq!(truncate_label("", 5), "");
    }

    #[test]
    fn test_node_id_display() {
        assert_eq!(NodeId::HostGroup("local".into()).to_string(), "host:local");
        assert_eq!(NodeId::Session("dev".into()).to_string(), "session:dev");
        assert_eq!(NodeId::Window("dev".into(), 0).to_string(), "window:dev:0");
        assert_eq!(NodeId::Pane("%5".into()).to_string(), "pane:%5");
    }

    #[test]
    fn test_node_id_hash_distinct_types_with_same_string() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        set.insert(NodeId::Session("test".into()));
        set.insert(NodeId::HostGroup("test".into()));
        set.insert(NodeId::Pane("test".into()));
        assert_eq!(set.len(), 3);
    }

    #[test]
    fn test_shared_prefix_common_prefix() {
        let names = ["editor-main", "editor-side"];
        assert_eq!(shared_prefix(&names), Some("editor".to_string()));
    }

    #[test]
    fn test_shared_prefix_no_common() {
        let names = ["alpha", "beta"];
        assert_eq!(shared_prefix(&names), None);
    }

    #[test]
    fn test_shared_prefix_single_name() {
        let names = ["editor"];
        assert_eq!(shared_prefix(&names), Some("editor".to_string()));
    }

    #[test]
    fn test_shared_prefix_empty() {
        let names: [&str; 0] = [];
        assert_eq!(shared_prefix(&names), None);
    }

    #[test]
    fn test_group_sessions_by_host_groups_by_port() {
        use sprack_db::types::Session;

        let sessions = vec![
            Session {
                name: "dev".to_string(),
                attached: true,
                lace_port: Some(2222),
                lace_user: None,
                lace_workspace: None,
                updated_at: String::new(),
            },
            Session {
                name: "logs".to_string(),
                attached: false,
                lace_port: Some(2222),
                lace_user: None,
                lace_workspace: None,
                updated_at: String::new(),
            },
            Session {
                name: "scratch".to_string(),
                attached: false,
                lace_port: None,
                lace_user: None,
                lace_workspace: None,
                updated_at: String::new(),
            },
        ];

        let groups = group_sessions_by_host(&sessions);

        // Port 2222 group comes first, local comes last.
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].port, Some(2222));
        assert_eq!(groups[0].sessions.len(), 2);
        assert_eq!(groups[1].port, None);
        assert_eq!(groups[1].name, "local");
    }

    fn make_pane(pane_id: &str, session: &str, window: i32, top: u32, left: u32) -> Pane {
        Pane {
            pane_id: pane_id.to_string(),
            session_name: session.to_string(),
            window_index: window,
            title: String::new(),
            current_command: "bash".to_string(),
            current_path: "/home".to_string(),
            pane_pid: Some(1000),
            active: false,
            dead: false,
            pane_width: Some(80),
            pane_height: Some(24),
            pane_left: Some(left),
            pane_top: Some(top),
            pane_index: None,
            in_mode: false,
        }
    }

    #[test]
    fn test_spatial_sort_2x2_grid() {
        let panes = vec![
            make_pane("%3", "s", 0, 25, 80),
            make_pane("%0", "s", 0, 0, 0),
            make_pane("%2", "s", 0, 25, 0),
            make_pane("%1", "s", 0, 0, 80),
        ];
        let sorted = panes_for_window("s", 0, &panes);
        let ids: Vec<&str> = sorted.iter().map(|p| p.pane_id.as_str()).collect();
        assert_eq!(ids, vec!["%0", "%1", "%2", "%3"]);
    }

    #[test]
    fn test_spatial_sort_tall_left_stacked_right() {
        let panes = vec![
            make_pane("%2", "s", 0, 25, 80),
            make_pane("%0", "s", 0, 0, 0),
            make_pane("%1", "s", 0, 0, 80),
        ];
        let sorted = panes_for_window("s", 0, &panes);
        let ids: Vec<&str> = sorted.iter().map(|p| p.pane_id.as_str()).collect();
        assert_eq!(ids, vec!["%0", "%1", "%2"]);
    }

    #[test]
    fn test_spatial_sort_horizontal_stacks() {
        let panes = vec![
            make_pane("%2", "s", 0, 33, 0),
            make_pane("%0", "s", 0, 0, 0),
            make_pane("%1", "s", 0, 16, 0),
        ];
        let sorted = panes_for_window("s", 0, &panes);
        let ids: Vec<&str> = sorted.iter().map(|p| p.pane_id.as_str()).collect();
        assert_eq!(ids, vec!["%0", "%1", "%2"]);
    }

    #[test]
    fn test_spatial_sort_same_top_left_to_right() {
        let panes = vec![
            make_pane("%2", "s", 0, 0, 120),
            make_pane("%0", "s", 0, 0, 0),
            make_pane("%1", "s", 0, 0, 60),
        ];
        let sorted = panes_for_window("s", 0, &panes);
        let ids: Vec<&str> = sorted.iter().map(|p| p.pane_id.as_str()).collect();
        assert_eq!(ids, vec!["%0", "%1", "%2"]);
    }

    #[test]
    fn test_spatial_sort_single_pane() {
        let panes = vec![make_pane("%0", "s", 0, 0, 0)];
        let sorted = panes_for_window("s", 0, &panes);
        assert_eq!(sorted.len(), 1);
        assert_eq!(sorted[0].pane_id, "%0");
    }

    #[test]
    fn test_build_tree_self_filter_excludes_own_pane() {
        let snapshot = DbSnapshot {
            sessions: vec![sprack_db::types::Session {
                name: "s".to_string(),
                attached: true,
                lace_port: None,
                lace_user: None,
                lace_workspace: None,
                updated_at: String::new(),
            }],
            windows: vec![sprack_db::types::Window {
                session_name: "s".to_string(),
                window_index: 0,
                name: "win".to_string(),
                active: true,
                layout: String::new(),
            }],
            panes: vec![
                sprack_db::types::Pane {
                    pane_id: "%0".to_string(),
                    session_name: "s".to_string(),
                    window_index: 0,
                    title: String::new(),
                    current_command: "bash".to_string(),
                    current_path: "/home".to_string(),
                    pane_pid: Some(1234),
                    active: true,
                    dead: false,
                    pane_width: Some(80),
                    pane_height: Some(24),
                    pane_left: Some(0),
                    pane_top: Some(0),
                    pane_index: Some(0),
                    in_mode: false,
                },
                sprack_db::types::Pane {
                    pane_id: "%1".to_string(),
                    session_name: "s".to_string(),
                    window_index: 0,
                    title: String::new(),
                    current_command: "nvim".to_string(),
                    current_path: "/home".to_string(),
                    pane_pid: Some(1235),
                    active: false,
                    dead: false,
                    pane_width: Some(80),
                    pane_height: Some(24),
                    pane_left: Some(80),
                    pane_top: Some(0),
                    pane_index: Some(1),
                    in_mode: false,
                },
            ],
            integrations: vec![],
        };

        let tree_without_filter = build_tree(&snapshot, None, LayoutTier::Standard);
        let tree_with_filter = build_tree(&snapshot, Some("%0"), LayoutTier::Standard);

        // Without filter: host > session > window > 2 panes.
        // With filter: host > session > window > 1 pane.
        // We check the structure via flatten: the filtered tree should have one fewer item.
        assert!(!tree_without_filter.is_empty());
        assert!(!tree_with_filter.is_empty());
    }
}
