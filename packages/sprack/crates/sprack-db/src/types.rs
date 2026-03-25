//! Data types shared across the sprack ecosystem.
//!
//! All types map directly to database tables and are the primary interface
//! between sprack-poll (writer), sprack TUI (reader), and sprack-claude (read+write).

use std::fmt;
use std::str::FromStr;

use crate::error::SprackDbError;

/// A tmux session with optional lace metadata.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Session {
    /// Tmux session name (primary key).
    pub name: String,
    /// Whether a client is currently attached to this session.
    pub attached: bool,
    /// SSH port from the @lace_port tmux option, if this is a lace session.
    pub lace_port: Option<u16>,
    /// Username from the @lace_user tmux option, if this is a lace session.
    pub lace_user: Option<String>,
    /// Workspace path from the @lace_workspace tmux option, if this is a lace session.
    pub lace_workspace: Option<String>,
    /// ISO 8601 timestamp of when this record was last updated.
    pub updated_at: String,
}

/// A tmux window within a session.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Window {
    /// Name of the parent session.
    pub session_name: String,
    /// Window index within the session.
    pub window_index: i32,
    /// Display name of the window.
    pub name: String,
    /// Whether this is the currently active window in its session.
    pub active: bool,
    /// tmux layout string (e.g., "34a1,159x48,0,0{79x48,0,0,0,79x48,80,0,1}").
    pub layout: String,
}

/// A tmux pane within a window.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Pane {
    /// Tmux unique pane ID (e.g., "%42").
    pub pane_id: String,
    /// Name of the parent session.
    pub session_name: String,
    /// Index of the parent window.
    pub window_index: i32,
    /// Pane title.
    pub title: String,
    /// Process currently running in the pane.
    pub current_command: String,
    /// Working directory of the pane.
    pub current_path: String,
    /// PID of the pane's shell process.
    pub pane_pid: Option<u32>,
    /// Whether this is the currently active pane in its window.
    pub active: bool,
    /// Whether the pane's process has exited.
    pub dead: bool,
    /// Pane width in columns.
    pub pane_width: Option<u32>,
    /// Pane height in rows.
    pub pane_height: Option<u32>,
    /// X coordinate of the pane's left edge.
    pub pane_left: Option<u32>,
    /// Y coordinate of the pane's top edge.
    pub pane_top: Option<u32>,
    /// Pane index within its window.
    pub pane_index: Option<u32>,
    /// Whether the pane is in copy/scroll mode.
    pub in_mode: bool,
}

/// A process enrichment written by a summarizer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Integration {
    /// Pane this integration belongs to.
    pub pane_id: String,
    /// Integration type (e.g., "claude_code", "nvim").
    pub kind: String,
    /// Human-readable status string.
    pub summary: String,
    /// Current process status.
    pub status: ProcessStatus,
    /// ISO 8601 timestamp of when this record was last updated.
    pub updated_at: String,
}

/// Status of a monitored process.
///
/// These map to specific visual treatments in the TUI (colors, icons).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ProcessStatus {
    /// Actively generating (yellow).
    Thinking,
    /// Executing a tool call (cyan).
    ToolUse,
    /// Waiting for input (green).
    Idle,
    /// Something went wrong (red).
    Error,
    /// User message sent, awaiting response (white).
    Waiting,
    /// Task finished (dim).
    Complete,
}

impl fmt::Display for ProcessStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let label = match self {
            Self::Thinking => "thinking",
            Self::ToolUse => "tool_use",
            Self::Idle => "idle",
            Self::Error => "error",
            Self::Waiting => "waiting",
            Self::Complete => "complete",
        };
        write!(f, "{label}")
    }
}

impl FromStr for ProcessStatus {
    type Err = SprackDbError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "thinking" => Ok(Self::Thinking),
            "tool_use" => Ok(Self::ToolUse),
            "idle" => Ok(Self::Idle),
            "error" => Ok(Self::Error),
            "waiting" => Ok(Self::Waiting),
            "complete" => Ok(Self::Complete),
            other => Err(SprackDbError::InvalidStatus(other.to_string())),
        }
    }
}

/// Complete database state for tree rendering.
///
/// Named DbSnapshot to avoid collision with tui-tree-widget's TreeState.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbSnapshot {
    /// All tmux sessions.
    pub sessions: Vec<Session>,
    /// All tmux windows across all sessions.
    pub windows: Vec<Window>,
    /// All tmux panes across all windows.
    pub panes: Vec<Pane>,
    /// All process integrations across all panes.
    pub integrations: Vec<Integration>,
}
