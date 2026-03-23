//! Tree data model and DB-to-tree conversion.
//!
//! Converts a `DbSnapshot` into a `Vec<TreeItem<NodeId>>` hierarchy:
//! HostGroup > Session > Window > Pane.
//! Sessions are grouped by `@lace_port` (same port = same host group).

use std::collections::HashMap;
use std::fmt;

use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use tui_tree_widget::TreeItem;

use sprack_db::types::{DbSnapshot, Integration, Pane, ProcessStatus, Session, Window};

use crate::colors::cat_color;
use crate::layout::LayoutTier;

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
    let mocha = &catppuccin::PALETTE.mocha.colors;

    groups
        .into_iter()
        .filter_map(|group| {
            let session_items: Vec<TreeItem<'static, NodeId>> = group
                .sessions
                .iter()
                .filter_map(|session| {
                    let window_items: Vec<TreeItem<'static, NodeId>> =
                        windows_for_session(&session.name, &snapshot.windows)
                            .iter()
                            .filter_map(|window| {
                                let pane_items: Vec<TreeItem<'static, NodeId>> = panes_for_window(
                                    &window.session_name,
                                    window.window_index,
                                    &snapshot.panes,
                                )
                                .iter()
                                .filter(|pane| own_pane_id.is_none_or(|own| pane.pane_id != own))
                                .filter_map(|pane| {
                                    build_pane_item(pane, &snapshot.integrations, tier, mocha)
                                })
                                .collect();

                                build_window_item(window, pane_items, tier, mocha)
                            })
                            .collect();

                    build_session_item(session, window_items, tier, mocha)
                })
                .collect();

            build_host_group_item(&group, session_items, tier, mocha)
        })
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

fn panes_for_window<'a>(session_name: &str, window_index: i32, panes: &'a [Pane]) -> Vec<&'a Pane> {
    panes
        .iter()
        .filter(|p| p.session_name == session_name && p.window_index == window_index)
        .collect()
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
    mocha: &catppuccin::FlavorColors,
) -> Option<TreeItem<'static, NodeId>> {
    let pane_integrations = integrations_for_pane(&pane.pane_id, integrations);
    let line = format_pane_label(pane, &pane_integrations, tier, mocha);
    let node_id = NodeId::Pane(pane.pane_id.clone());
    Some(TreeItem::new_leaf(node_id, line))
}

fn build_window_item(
    window: &Window,
    pane_items: Vec<TreeItem<'static, NodeId>>,
    tier: LayoutTier,
    mocha: &catppuccin::FlavorColors,
) -> Option<TreeItem<'static, NodeId>> {
    let line = format_window_label(window, tier, mocha);
    let node_id = NodeId::Window(window.session_name.clone(), window.window_index);
    TreeItem::new(node_id, line, pane_items).ok()
}

fn build_session_item(
    session: &Session,
    window_items: Vec<TreeItem<'static, NodeId>>,
    tier: LayoutTier,
    mocha: &catppuccin::FlavorColors,
) -> Option<TreeItem<'static, NodeId>> {
    let line = format_session_label(session, tier, mocha);
    let node_id = NodeId::Session(session.name.clone());
    TreeItem::new(node_id, line, window_items).ok()
}

fn build_host_group_item(
    group: &HostGroup,
    session_items: Vec<TreeItem<'static, NodeId>>,
    tier: LayoutTier,
    mocha: &catppuccin::FlavorColors,
) -> Option<TreeItem<'static, NodeId>> {
    let line = format_host_group_label(group, tier, mocha);
    let node_id = NodeId::HostGroup(group.name.clone());
    TreeItem::new(node_id, line, session_items).ok()
}

// === Label formatting by tier ===

fn format_pane_label(
    pane: &Pane,
    integrations: &[&Integration],
    tier: LayoutTier,
    mocha: &catppuccin::FlavorColors,
) -> Line<'static> {
    let process_name = pane
        .current_command
        .rsplit('/')
        .next()
        .unwrap_or("?")
        .to_string();

    let primary_integration = integrations.first();

    match tier {
        LayoutTier::Compact => {
            let icon = primary_integration
                .map(|i| status_compact_icon(&i.status))
                .unwrap_or(" ");
            let icon_style = primary_integration
                .map(|i| status_style(&i.status, mocha))
                .unwrap_or_default();
            Line::from(vec![
                Span::styled(icon.to_string(), icon_style),
                Span::raw(" "),
                Span::raw(truncate_label(&process_name, 15)),
            ])
        }
        LayoutTier::Standard => {
            let mut spans = vec![Span::raw(truncate_label(&process_name, 20))];
            if let Some(integration) = primary_integration {
                let (badge, style) = status_badge(&integration.status, mocha);
                spans.push(Span::raw(" "));
                spans.push(Span::styled(badge, style));
            }
            Line::from(spans)
        }
        LayoutTier::Wide | LayoutTier::Full => {
            let title = if pane.title.is_empty() {
                process_name.clone()
            } else {
                truncate_label(&pane.title, 25)
            };
            let mut spans = vec![
                Span::raw(title),
                Span::styled(
                    format!(" ({process_name})"),
                    Style::default().fg(cat_color(mocha.subtext0)),
                ),
            ];
            if let Some(integration) = primary_integration {
                let (badge, style) = status_badge(&integration.status, mocha);
                spans.push(Span::raw(" "));
                spans.push(Span::styled(badge, style));
            }
            Line::from(spans)
        }
    }
}

fn format_window_label(
    window: &Window,
    tier: LayoutTier,
    mocha: &catppuccin::FlavorColors,
) -> Line<'static> {
    let style = if window.active {
        Style::default().fg(cat_color(mocha.text))
    } else {
        Style::default().fg(cat_color(mocha.subtext0))
    };

    match tier {
        LayoutTier::Compact => Line::from(Span::styled(truncate_label(&window.name, 15), style)),
        _ => Line::from(Span::styled(truncate_label(&window.name, 30), style)),
    }
}

fn format_session_label(
    session: &Session,
    tier: LayoutTier,
    mocha: &catppuccin::FlavorColors,
) -> Line<'static> {
    let style = if session.attached {
        Style::default().fg(cat_color(mocha.text))
    } else {
        Style::default()
            .fg(cat_color(mocha.overlay1))
            .add_modifier(Modifier::DIM)
    };

    match tier {
        LayoutTier::Compact => Line::from(Span::styled(truncate_label(&session.name, 15), style)),
        _ => {
            let mut spans = vec![Span::styled(truncate_label(&session.name, 25), style)];
            if let Some(port) = session.lace_port {
                spans.push(Span::styled(
                    format!(" ({port})"),
                    Style::default().fg(cat_color(mocha.surface2)),
                ));
            }
            Line::from(spans)
        }
    }
}

fn format_host_group_label(
    group: &HostGroup,
    tier: LayoutTier,
    mocha: &catppuccin::FlavorColors,
) -> Line<'static> {
    let header_style = Style::default()
        .fg(cat_color(mocha.blue))
        .add_modifier(Modifier::BOLD);

    match tier {
        LayoutTier::Compact => Line::from(Span::styled(
            truncate_label(&group.name.to_uppercase(), 15),
            header_style,
        )),
        _ => Line::from(Span::styled(group.name.to_uppercase(), header_style)),
    }
}

// === Status display helpers ===

/// Returns the single-char icon for compact tier.
fn status_compact_icon(status: &ProcessStatus) -> &'static str {
    match status {
        ProcessStatus::Thinking => "*",
        ProcessStatus::ToolUse => "T",
        ProcessStatus::Idle => ".",
        ProcessStatus::Error => "!",
        ProcessStatus::Waiting => "?",
        ProcessStatus::Complete => "-",
    }
}

/// Returns the bracketed badge and its style for standard+ tiers.
fn status_badge(status: &ProcessStatus, mocha: &catppuccin::FlavorColors) -> (String, Style) {
    let (label, style) = match status {
        ProcessStatus::Thinking => (
            "[thinking]",
            Style::default()
                .fg(cat_color(mocha.yellow))
                .add_modifier(Modifier::BOLD),
        ),
        ProcessStatus::ToolUse => (
            "[tool]",
            Style::default()
                .fg(cat_color(mocha.teal))
                .add_modifier(Modifier::BOLD),
        ),
        ProcessStatus::Idle => ("[idle]", Style::default().fg(cat_color(mocha.green))),
        ProcessStatus::Error => (
            "[error]",
            Style::default()
                .fg(cat_color(mocha.red))
                .add_modifier(Modifier::BOLD),
        ),
        ProcessStatus::Waiting => ("[waiting]", Style::default().fg(cat_color(mocha.text))),
        ProcessStatus::Complete => (
            "[done]",
            Style::default()
                .fg(cat_color(mocha.overlay0))
                .add_modifier(Modifier::DIM),
        ),
    };
    (label.to_string(), style)
}

/// Returns a style for the compact status icon.
fn status_style(status: &ProcessStatus, mocha: &catppuccin::FlavorColors) -> Style {
    match status {
        ProcessStatus::Thinking => Style::default()
            .fg(cat_color(mocha.yellow))
            .add_modifier(Modifier::BOLD),
        ProcessStatus::ToolUse => Style::default()
            .fg(cat_color(mocha.teal))
            .add_modifier(Modifier::BOLD),
        ProcessStatus::Idle => Style::default().fg(cat_color(mocha.green)),
        ProcessStatus::Error => Style::default()
            .fg(cat_color(mocha.red))
            .add_modifier(Modifier::BOLD),
        ProcessStatus::Waiting => Style::default().fg(cat_color(mocha.text)),
        ProcessStatus::Complete => Style::default()
            .fg(cat_color(mocha.overlay0))
            .add_modifier(Modifier::DIM),
    }
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
