//! Catppuccin color conversion and centralized theme styles.
//!
//! Bridges catppuccin v2 colors to ratatui v0.29 colors via RGB values.
//! The catppuccin crate's `From` impl targets `ratatui-core` v0.1 which is
//! incompatible with our ratatui version, so we convert manually.
//!
//! All semantic styles for the TUI are defined here. `render.rs` and `tree.rs`
//! reference named styles rather than constructing them inline.

use ratatui::style::{Modifier, Style};

use sprack_db::types::ProcessStatus;

/// Converts a catppuccin color to a ratatui color via its RGB components.
pub fn cat_color(color: catppuccin::Color) -> ratatui::style::Color {
    let rgb = color.rgb;
    ratatui::style::Color::Rgb(rgb.r, rgb.g, rgb.b)
}

/// Centralized theme derived from catppuccin mocha.
///
/// Constructed once per frame via `Theme::mocha()`, then passed to rendering
/// and tree-building functions. Avoids repeated `Style::default().fg(cat_color(...))`
/// construction scattered across modules.
pub struct Theme {
    // === Base surfaces ===
    pub base_bg: Style,

    // === Text hierarchy (only styles referenced by tree/render) ===
    pub subtext0: Style,
    pub surface2_fg: Style,

    // === Semantic: tree node styles ===
    pub host_group_header: Style,
    pub session_attached: Style,
    pub session_detached: Style,
    pub window_active: Style,
    pub window_inactive: Style,

    // === Semantic: tree highlight ===
    pub tree_highlight: Style,

    // === Semantic: status bar ===
    pub status_bar_bg: Style,
    pub status_healthy: Style,
    pub status_unhealthy: Style,
    pub status_separator: Style,
    pub status_help: Style,

    // === Semantic: detail panel ===
    pub detail_border: Style,
    pub detail_kind_label: Style,
    pub detail_summary: Style,
    pub detail_metadata: Style,
    pub detail_empty: Style,

    // === Process status styles ===
    pub process_thinking: Style,
    pub process_tool_use: Style,
    pub process_idle: Style,
    pub process_error: Style,
    pub process_waiting: Style,
    pub process_complete: Style,
}

impl Theme {
    /// Constructs the mocha theme. Called once per frame.
    pub fn mocha() -> Self {
        let mocha = &catppuccin::PALETTE.mocha.colors;

        Self {
            // Base surfaces.
            base_bg: Style::default().bg(cat_color(mocha.base)),

            // Text hierarchy (only styles actively used by tree/render).
            subtext0: Style::default().fg(cat_color(mocha.subtext0)),
            surface2_fg: Style::default().fg(cat_color(mocha.surface2)),

            // Tree node styles.
            host_group_header: Style::default()
                .fg(cat_color(mocha.blue))
                .add_modifier(Modifier::BOLD),
            session_attached: Style::default().fg(cat_color(mocha.text)),
            session_detached: Style::default()
                .fg(cat_color(mocha.overlay1))
                .add_modifier(Modifier::DIM),
            window_active: Style::default().fg(cat_color(mocha.text)),
            window_inactive: Style::default().fg(cat_color(mocha.subtext0)),

            // Tree highlight.
            tree_highlight: Style::default()
                .fg(cat_color(mocha.text))
                .bg(cat_color(mocha.surface0))
                .add_modifier(Modifier::BOLD),

            // Status bar.
            status_bar_bg: Style::default().bg(cat_color(mocha.mantle)),
            status_healthy: Style::default().fg(cat_color(mocha.green)),
            status_unhealthy: Style::default()
                .fg(cat_color(mocha.red))
                .add_modifier(Modifier::BOLD),
            status_separator: Style::default().fg(cat_color(mocha.surface2)),
            status_help: Style::default().fg(cat_color(mocha.overlay1)),

            // Detail panel.
            detail_border: Style::default().fg(cat_color(mocha.surface1)),
            detail_kind_label: Style::default()
                .fg(cat_color(mocha.text))
                .add_modifier(Modifier::BOLD),
            detail_summary: Style::default().fg(cat_color(mocha.subtext1)),
            detail_metadata: Style::default().fg(cat_color(mocha.overlay0)),
            detail_empty: Style::default().fg(cat_color(mocha.overlay0)),

            // Process status styles.
            process_thinking: Style::default()
                .fg(cat_color(mocha.yellow))
                .add_modifier(Modifier::BOLD),
            process_tool_use: Style::default()
                .fg(cat_color(mocha.teal))
                .add_modifier(Modifier::BOLD),
            process_idle: Style::default().fg(cat_color(mocha.green)),
            process_error: Style::default()
                .fg(cat_color(mocha.red))
                .add_modifier(Modifier::BOLD),
            process_waiting: Style::default().fg(cat_color(mocha.text)),
            process_complete: Style::default()
                .fg(cat_color(mocha.overlay0))
                .add_modifier(Modifier::DIM),
        }
    }

    /// Returns the style for a given process status.
    pub fn status_style(&self, status: &ProcessStatus) -> Style {
        match status {
            ProcessStatus::Thinking => self.process_thinking,
            ProcessStatus::ToolUse => self.process_tool_use,
            ProcessStatus::Idle => self.process_idle,
            ProcessStatus::Error => self.process_error,
            ProcessStatus::Waiting => self.process_waiting,
            ProcessStatus::Complete => self.process_complete,
        }
    }

    /// Returns the bracketed badge text and style for a process status (standard+ tiers).
    pub fn status_badge(&self, status: &ProcessStatus) -> (&'static str, Style) {
        match status {
            ProcessStatus::Thinking => ("[thinking]", self.process_thinking),
            ProcessStatus::ToolUse => ("[tool]", self.process_tool_use),
            ProcessStatus::Idle => ("[idle]", self.process_idle),
            ProcessStatus::Error => ("[error]", self.process_error),
            ProcessStatus::Waiting => ("[waiting]", self.process_waiting),
            ProcessStatus::Complete => ("[done]", self.process_complete),
        }
    }

    /// Returns the single-char icon for compact tier.
    pub fn status_compact_icon(&self, status: &ProcessStatus) -> &'static str {
        match status {
            ProcessStatus::Thinking => "*",
            ProcessStatus::ToolUse => "T",
            ProcessStatus::Idle => ".",
            ProcessStatus::Error => "!",
            ProcessStatus::Waiting => "?",
            ProcessStatus::Complete => "-",
        }
    }

    /// Returns the detail panel status text and style (bracketed, with ellipsis for thinking).
    pub fn detail_status(&self, status: &ProcessStatus) -> (&'static str, Style) {
        match status {
            ProcessStatus::Thinking => ("[thinking...]", self.process_thinking),
            ProcessStatus::ToolUse => ("[tool use]", self.process_tool_use),
            ProcessStatus::Idle => ("[idle]", self.process_idle),
            ProcessStatus::Error => ("[error]", self.process_error),
            ProcessStatus::Waiting => ("[waiting]", self.process_waiting),
            ProcessStatus::Complete => ("[complete]", self.process_complete),
        }
    }
}
