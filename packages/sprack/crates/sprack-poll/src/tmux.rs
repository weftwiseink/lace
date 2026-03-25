//! tmux CLI interaction, format string definition, and output parsing.
//!
//! Runs `tmux list-panes -a -F` with a unit-separator-delimited format string
//! to fetch all panes across all sessions. Also reads per-session lace metadata
//! via `tmux show-options`.

use std::collections::HashMap;
use std::fmt;
use std::process::Command;

/// Errors from tmux CLI interaction.
#[derive(Debug)]
pub enum TmuxError {
    /// tmux binary not found on PATH.
    NotFound,
    /// tmux server is not running.
    ServerNotRunning,
    /// tmux command failed with an error message.
    CommandFailed(String),
}

impl fmt::Display for TmuxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => write!(f, "tmux binary not found on PATH"),
            Self::ServerNotRunning => write!(f, "tmux server not running"),
            Self::CommandFailed(message) => write!(f, "tmux command failed: {message}"),
        }
    }
}

impl std::error::Error for TmuxError {}

/// Format string for `tmux list-panes -a -F`.
///
/// Fields are delimited by `||` (double pipe) because tmux 3.3a converts
/// non-printable characters (including `\x1f`) to underscores.
/// Double pipe is extremely unlikely to appear in session names, paths, or titles.
/// Each line of output represents one pane.
const TMUX_FORMAT: &str = "\
#{session_name}||\
#{session_attached}||\
#{window_index}||\
#{window_name}||\
#{window_active}||\
#{pane_id}||\
#{pane_title}||\
#{pane_current_command}||\
#{pane_current_path}||\
#{pane_pid}||\
#{pane_active}||\
#{pane_dead}";

/// Expected number of fields per line of tmux output.
const EXPECTED_FIELD_COUNT: usize = 12;

/// Runs a tmux command and returns stdout as a string.
///
/// When `socket` is `Some`, passes `-L <socket>` to target an isolated tmux server.
/// Maps IO errors to `TmuxError::NotFound` (tmux not on PATH)
/// and "no server running" / "no current client" stderr to `TmuxError::ServerNotRunning`.
fn tmux_command(args: &[&str], socket: Option<&str>) -> Result<String, TmuxError> {
    let mut cmd = Command::new("tmux");
    if let Some(socket_name) = socket {
        cmd.args(["-L", socket_name]);
    }
    let output = cmd
        .args(args)
        .output()
        .map_err(|_| TmuxError::NotFound)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("no server running") || stderr.contains("no current client") {
            return Err(TmuxError::ServerNotRunning);
        }
        return Err(TmuxError::CommandFailed(stderr.to_string()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Queries all tmux panes across all sessions via `tmux list-panes -a -F`.
///
/// When `socket` is `Some`, targets an isolated tmux server (for testing).
/// Returns the raw output string for hashing before parsing.
pub fn query_tmux_state(socket: Option<&str>) -> Result<String, TmuxError> {
    tmux_command(&["list-panes", "-a", "-F", TMUX_FORMAT], socket)
}

/// Hierarchical snapshot of tmux state.
#[derive(Debug, Clone, PartialEq)]
pub struct TmuxSnapshot {
    pub sessions: Vec<TmuxSession>,
}

impl TmuxSnapshot {
    /// Returns a list of unique session names.
    pub fn session_names(&self) -> Vec<String> {
        self.sessions.iter().map(|s| s.name.clone()).collect()
    }
}

/// A tmux session with its child windows.
#[derive(Debug, Clone, PartialEq)]
pub struct TmuxSession {
    pub name: String,
    pub attached: bool,
    pub windows: Vec<TmuxWindow>,
}

/// A tmux window with its child panes.
#[derive(Debug, Clone, PartialEq)]
pub struct TmuxWindow {
    pub window_index: u32,
    pub name: String,
    pub active: bool,
    pub panes: Vec<TmuxPane>,
}

/// A single tmux pane.
#[derive(Debug, Clone, PartialEq)]
pub struct TmuxPane {
    pub pane_id: String,
    pub title: String,
    pub current_command: String,
    pub current_path: String,
    pub pane_pid: u32,
    pub active: bool,
    pub dead: bool,
}

/// Parses raw `tmux list-panes -a -F` output into a hierarchical `TmuxSnapshot`.
///
/// Lines with the wrong number of fields are skipped (logged but not fatal).
/// Groups panes into sessions and windows based on session_name and window_index.
pub fn parse_tmux_output(raw: &str) -> TmuxSnapshot {
    // Collect parsed lines, skipping malformed ones.
    let mut parsed_lines: Vec<ParsedLine> = Vec::new();
    for line in raw.lines() {
        if line.is_empty() {
            continue;
        }
        match parse_single_line(line) {
            Some(parsed) => parsed_lines.push(parsed),
            None => {
                eprintln!("sprack-poll: skipping malformed tmux line: {line}");
            }
        }
    }

    // Group into hierarchical structure.
    build_snapshot(parsed_lines)
}

/// Lace metadata for a single session, read from tmux user options.
#[derive(Debug, Clone, PartialEq)]
pub struct LaceMeta {
    pub port: Option<u16>,
    pub user: Option<String>,
    pub workspace: Option<String>,
}

/// Reads lace-specific tmux user options for each session.
///
/// Calls `tmux show-options -qvt $session @lace_port/user/workspace` per session.
/// When `socket` is `Some`, targets an isolated tmux server (for testing).
/// Missing options produce `None` values, not errors.
pub fn query_lace_options(session_names: &[String], socket: Option<&str>) -> HashMap<String, LaceMeta> {
    let mut result = HashMap::new();
    for session_name in session_names {
        let port = read_lace_option(session_name, "@lace_port", socket)
            .and_then(|value| value.parse::<u16>().ok());
        let user = read_lace_option(session_name, "@lace_user", socket);
        let workspace = read_lace_option(session_name, "@lace_workspace", socket);

        result.insert(
            session_name.clone(),
            LaceMeta {
                port,
                user,
                workspace,
            },
        );
    }
    result
}

/// Reads a single lace tmux user option for a session.
///
/// Returns `None` if the option is not set or the command fails.
fn read_lace_option(session_name: &str, option_name: &str, socket: Option<&str>) -> Option<String> {
    let output = tmux_command(&["show-options", "-qvt", session_name, option_name], socket).ok()?;
    parse_lace_option(&output)
}

/// Parses the output of `tmux show-options -qv`.
///
/// Returns `Some(value)` for non-empty output, `None` for empty/whitespace-only.
pub fn parse_lace_option(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Converts a `TmuxSnapshot` and lace metadata into sprack-db types.
///
/// Flattens the hierarchical snapshot into three separate vectors matching
/// the sprack-db schema.
pub fn to_db_types(
    snapshot: &TmuxSnapshot,
    lace_meta: &HashMap<String, LaceMeta>,
) -> (
    Vec<sprack_db::types::Session>,
    Vec<sprack_db::types::Window>,
    Vec<sprack_db::types::Pane>,
) {
    let mut sessions = Vec::new();
    let mut windows = Vec::new();
    let mut panes = Vec::new();

    let timestamp = sprack_db::write::now_iso8601();

    for tmux_session in &snapshot.sessions {
        let meta = lace_meta.get(&tmux_session.name);
        sessions.push(sprack_db::types::Session {
            name: tmux_session.name.clone(),
            attached: tmux_session.attached,
            lace_port: meta.and_then(|m| m.port),
            lace_user: meta.and_then(|m| m.user.clone()),
            lace_workspace: meta.and_then(|m| m.workspace.clone()),
            updated_at: timestamp.clone(),
        });

        for tmux_window in &tmux_session.windows {
            windows.push(sprack_db::types::Window {
                session_name: tmux_session.name.clone(),
                window_index: tmux_window.window_index as i32,
                name: tmux_window.name.clone(),
                active: tmux_window.active,
            });

            for tmux_pane in &tmux_window.panes {
                panes.push(sprack_db::types::Pane {
                    pane_id: tmux_pane.pane_id.clone(),
                    session_name: tmux_session.name.clone(),
                    window_index: tmux_window.window_index as i32,
                    title: tmux_pane.title.clone(),
                    current_command: tmux_pane.current_command.clone(),
                    current_path: tmux_pane.current_path.clone(),
                    pane_pid: Some(tmux_pane.pane_pid),
                    active: tmux_pane.active,
                    dead: tmux_pane.dead,
                });
            }
        }
    }

    (sessions, windows, panes)
}

// === Private helpers ===

/// Intermediate parsed line before grouping into hierarchy.
struct ParsedLine {
    session_name: String,
    session_attached: bool,
    window_index: u32,
    window_name: String,
    window_active: bool,
    pane_id: String,
    pane_title: String,
    pane_current_command: String,
    pane_current_path: String,
    pane_pid: u32,
    pane_active: bool,
    pane_dead: bool,
}

/// Parses a single `||`-delimited line into a `ParsedLine`.
///
/// Returns `None` if the field count is wrong or numeric fields fail to parse.
fn parse_single_line(line: &str) -> Option<ParsedLine> {
    let fields: Vec<&str> = line.split("||").collect();
    if fields.len() != EXPECTED_FIELD_COUNT {
        return None;
    }

    Some(ParsedLine {
        session_name: fields[0].to_string(),
        session_attached: fields[1] == "1",
        window_index: fields[2].parse().ok()?,
        window_name: fields[3].to_string(),
        window_active: fields[4] == "1",
        pane_id: fields[5].to_string(),
        pane_title: fields[6].to_string(),
        pane_current_command: fields[7].to_string(),
        pane_current_path: fields[8].to_string(),
        pane_pid: fields[9].parse().ok()?,
        pane_active: fields[10] == "1",
        pane_dead: fields[11] == "1",
    })
}

/// Groups parsed lines into a hierarchical `TmuxSnapshot`.
///
/// Deduplicates sessions and windows based on name/index, preserving insertion order.
fn build_snapshot(lines: Vec<ParsedLine>) -> TmuxSnapshot {
    let mut sessions: Vec<TmuxSession> = Vec::new();
    let mut session_index_map: HashMap<String, usize> = HashMap::new();

    for line in lines {
        let session_idx = if let Some(&idx) = session_index_map.get(&line.session_name) {
            // Update attached status in case lines disagree (use OR: attached if any line says so).
            sessions[idx].attached = sessions[idx].attached || line.session_attached;
            idx
        } else {
            let idx = sessions.len();
            session_index_map.insert(line.session_name.clone(), idx);
            sessions.push(TmuxSession {
                name: line.session_name.clone(),
                attached: line.session_attached,
                windows: Vec::new(),
            });
            idx
        };

        let session = &mut sessions[session_idx];

        // Find or create window within this session.
        let window_position = session
            .windows
            .iter()
            .position(|w| w.window_index == line.window_index);

        let window = if let Some(window_pos) = window_position {
            &mut session.windows[window_pos]
        } else {
            session.windows.push(TmuxWindow {
                window_index: line.window_index,
                name: line.window_name,
                active: line.window_active,
                panes: Vec::new(),
            });
            session.windows.last_mut().unwrap()
        };

        window.panes.push(TmuxPane {
            pane_id: line.pane_id,
            title: line.pane_title,
            current_command: line.pane_current_command,
            current_path: line.pane_current_path,
            pane_pid: line.pane_pid,
            active: line.pane_active,
            dead: line.pane_dead,
        });
    }

    TmuxSnapshot { sessions }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: builds a single-pane tmux output line.
    fn make_tmux_line(
        session_name: &str,
        session_attached: &str,
        window_index: &str,
        window_name: &str,
        window_active: &str,
        pane_id: &str,
        pane_title: &str,
        pane_command: &str,
        pane_path: &str,
        pane_pid: &str,
        pane_active: &str,
        pane_dead: &str,
    ) -> String {
        [
            session_name,
            session_attached,
            window_index,
            window_name,
            window_active,
            pane_id,
            pane_title,
            pane_command,
            pane_path,
            pane_pid,
            pane_active,
            pane_dead,
        ]
        .join("||")
    }

    #[test]
    fn test_parse_single_pane() {
        let line = make_tmux_line(
            "dev",
            "1",
            "0",
            "main",
            "1",
            "%0",
            "my title",
            "bash",
            "/home/user",
            "1234",
            "1",
            "0",
        );
        let snapshot = parse_tmux_output(&line);

        assert_eq!(snapshot.sessions.len(), 1);
        let session = &snapshot.sessions[0];
        assert_eq!(session.name, "dev");
        assert!(session.attached);
        assert_eq!(session.windows.len(), 1);

        let window = &session.windows[0];
        assert_eq!(window.window_index, 0);
        assert_eq!(window.name, "main");
        assert!(window.active);
        assert_eq!(window.panes.len(), 1);

        let pane = &window.panes[0];
        assert_eq!(pane.pane_id, "%0");
        assert_eq!(pane.title, "my title");
        assert_eq!(pane.current_command, "bash");
        assert_eq!(pane.current_path, "/home/user");
        assert_eq!(pane.pane_pid, 1234);
        assert!(pane.active);
        assert!(!pane.dead);
    }

    #[test]
    fn test_parse_multi_session() {
        let lines = [
            make_tmux_line(
                "dev",
                "1",
                "0",
                "editor",
                "1",
                "%0",
                "",
                "nvim",
                "/home/user/code",
                "1000",
                "1",
                "0",
            ),
            make_tmux_line(
                "dev",
                "1",
                "0",
                "editor",
                "1",
                "%1",
                "",
                "bash",
                "/home/user/code",
                "1001",
                "0",
                "0",
            ),
            make_tmux_line(
                "dev",
                "1",
                "1",
                "terminal",
                "0",
                "%2",
                "",
                "bash",
                "/home/user",
                "1002",
                "1",
                "0",
            ),
            make_tmux_line(
                "prod", "0", "0", "logs", "1", "%3", "", "tail", "/var/log", "2000", "1", "0",
            ),
        ]
        .join("\n");

        let snapshot = parse_tmux_output(&lines);

        assert_eq!(snapshot.sessions.len(), 2);

        // Session "dev": 2 windows, 3 panes total.
        let dev = &snapshot.sessions[0];
        assert_eq!(dev.name, "dev");
        assert!(dev.attached);
        assert_eq!(dev.windows.len(), 2);
        assert_eq!(dev.windows[0].panes.len(), 2);
        assert_eq!(dev.windows[1].panes.len(), 1);

        // Session "prod": 1 window, 1 pane.
        let prod = &snapshot.sessions[1];
        assert_eq!(prod.name, "prod");
        assert!(!prod.attached);
        assert_eq!(prod.windows.len(), 1);
        assert_eq!(prod.windows[0].panes.len(), 1);
    }

    #[test]
    fn test_parse_empty_output() {
        let snapshot = parse_tmux_output("");
        assert!(snapshot.sessions.is_empty());
    }

    #[test]
    fn test_parse_malformed_line() {
        let lines = [
            "only||five||fields||here||wrong".to_string(),
            make_tmux_line(
                "good", "0", "0", "main", "1", "%0", "", "bash", "/home", "999", "1", "0",
            ),
        ]
        .join("\n");

        let snapshot = parse_tmux_output(&lines);

        // Malformed line skipped, good line parsed.
        assert_eq!(snapshot.sessions.len(), 1);
        assert_eq!(snapshot.sessions[0].name, "good");
    }

    #[test]
    fn test_parse_special_characters() {
        let line = make_tmux_line(
            "my session",
            "1",
            "0",
            "window: test",
            "1",
            "%42",
            "title with spaces & unicode \u{1f600}",
            "python3",
            "/home/user/my project/src",
            "5678",
            "1",
            "0",
        );

        let snapshot = parse_tmux_output(&line);

        assert_eq!(snapshot.sessions.len(), 1);
        let session = &snapshot.sessions[0];
        assert_eq!(session.name, "my session");

        let window = &session.windows[0];
        assert_eq!(window.name, "window: test");

        let pane = &window.panes[0];
        assert_eq!(pane.title, "title with spaces & unicode \u{1f600}");
        assert_eq!(pane.current_path, "/home/user/my project/src");
        assert_eq!(pane.pane_id, "%42");
    }

    #[test]
    fn test_lace_options_parsing() {
        assert_eq!(parse_lace_option("2222\n"), Some("2222".to_string()));
        assert_eq!(parse_lace_option("node\n"), Some("node".to_string()));
        assert_eq!(
            parse_lace_option("/workspace\n"),
            Some("/workspace".to_string())
        );
        // Whitespace-only is treated as missing.
        assert_eq!(parse_lace_option("  \n"), None);
    }

    #[test]
    fn test_lace_options_missing() {
        assert_eq!(parse_lace_option(""), None);
        assert_eq!(parse_lace_option("\n"), None);
        assert_eq!(parse_lace_option("   "), None);
    }

    #[test]
    fn test_to_db_types_maps_correctly() {
        let snapshot = TmuxSnapshot {
            sessions: vec![TmuxSession {
                name: "dev".to_string(),
                attached: true,
                windows: vec![TmuxWindow {
                    window_index: 0,
                    name: "editor".to_string(),
                    active: true,
                    panes: vec![TmuxPane {
                        pane_id: "%0".to_string(),
                        title: "my pane".to_string(),
                        current_command: "nvim".to_string(),
                        current_path: "/home/user".to_string(),
                        pane_pid: 1234,
                        active: true,
                        dead: false,
                    }],
                }],
            }],
        };

        let mut lace_meta = HashMap::new();
        lace_meta.insert(
            "dev".to_string(),
            LaceMeta {
                port: Some(2222),
                user: Some("node".to_string()),
                workspace: Some("/workspace".to_string()),
            },
        );

        let (sessions, windows, panes) = to_db_types(&snapshot, &lace_meta);

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].name, "dev");
        assert!(sessions[0].attached);
        assert_eq!(sessions[0].lace_port, Some(2222));
        assert_eq!(sessions[0].lace_user.as_deref(), Some("node"));
        assert_eq!(sessions[0].lace_workspace.as_deref(), Some("/workspace"));

        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].session_name, "dev");
        assert_eq!(windows[0].window_index, 0);
        assert_eq!(windows[0].name, "editor");
        assert!(windows[0].active);

        assert_eq!(panes.len(), 1);
        assert_eq!(panes[0].pane_id, "%0");
        assert_eq!(panes[0].session_name, "dev");
        assert_eq!(panes[0].window_index, 0);
        assert_eq!(panes[0].title, "my pane");
        assert_eq!(panes[0].current_command, "nvim");
        assert_eq!(panes[0].current_path, "/home/user");
        assert_eq!(panes[0].pane_pid, Some(1234));
        assert!(panes[0].active);
        assert!(!panes[0].dead);
    }

    #[test]
    fn test_to_db_types_without_lace_meta() {
        let snapshot = TmuxSnapshot {
            sessions: vec![TmuxSession {
                name: "local".to_string(),
                attached: false,
                windows: vec![TmuxWindow {
                    window_index: 3,
                    name: "shell".to_string(),
                    active: false,
                    panes: vec![TmuxPane {
                        pane_id: "%5".to_string(),
                        title: "".to_string(),
                        current_command: "bash".to_string(),
                        current_path: "/tmp".to_string(),
                        pane_pid: 9999,
                        active: true,
                        dead: false,
                    }],
                }],
            }],
        };

        let lace_meta = HashMap::new();
        let (sessions, windows, panes) = to_db_types(&snapshot, &lace_meta);

        assert_eq!(sessions[0].lace_port, None);
        assert_eq!(sessions[0].lace_user, None);
        assert_eq!(sessions[0].lace_workspace, None);
        // Window index u32 -> i32 conversion.
        assert_eq!(windows[0].window_index, 3);
        // Pane pid u32 -> Option<u32>.
        assert_eq!(panes[0].pane_pid, Some(9999));
    }

    #[test]
    fn test_snapshot_session_names() {
        let snapshot = TmuxSnapshot {
            sessions: vec![
                TmuxSession {
                    name: "alpha".to_string(),
                    attached: true,
                    windows: vec![],
                },
                TmuxSession {
                    name: "beta".to_string(),
                    attached: false,
                    windows: vec![],
                },
            ],
        };

        let names = snapshot.session_names();
        assert_eq!(names, vec!["alpha".to_string(), "beta".to_string()]);
    }
}
