//! Tmux CLI commands for navigation.
//!
//! When the user presses Enter on a node, sprack executes tmux commands
//! to focus the corresponding session/window/pane.

use std::process::Command;

use anyhow::Result;

use sprack_db::types::DbSnapshot;

use crate::tree::NodeId;

/// Focuses the tmux entity corresponding to the given node.
pub fn focus_node(node_id: &NodeId, snapshot: &DbSnapshot) -> Result<()> {
    match node_id {
        NodeId::Pane(pane_id) => {
            if let Some(pane) = snapshot.panes.iter().find(|p| &p.pane_id == pane_id) {
                focus_pane(&pane.session_name, pane.window_index, pane_id)?;
            }
        }
        NodeId::Window(session_name, window_index) => {
            focus_window(session_name, *window_index)?;
        }
        NodeId::Session(session_name) => {
            focus_session(session_name)?;
        }
        NodeId::HostGroup(group_name) => {
            // Focus the first session in the group.
            if let Some(session) = snapshot
                .sessions
                .iter()
                .find(|s| s.name == *group_name)
                .or_else(|| snapshot.sessions.first())
            {
                focus_session(&session.name)?;
            }
        }
    }
    Ok(())
}

/// Switches the tmux client to the target pane.
fn focus_pane(session_name: &str, window_index: i32, pane_id: &str) -> Result<()> {
    let window_target = format!("{session_name}:{window_index}");
    Command::new("tmux")
        .args(["switch-client", "-t", session_name])
        .args([";", "select-window", "-t", &window_target])
        .args([";", "select-pane", "-t", pane_id])
        .status()?;
    Ok(())
}

/// Switches the tmux client to the target window.
fn focus_window(session_name: &str, window_index: i32) -> Result<()> {
    let window_target = format!("{session_name}:{window_index}");
    Command::new("tmux")
        .args(["switch-client", "-t", session_name])
        .args([";", "select-window", "-t", &window_target])
        .status()?;
    Ok(())
}

/// Switches the tmux client to the target session.
fn focus_session(session_name: &str) -> Result<()> {
    Command::new("tmux")
        .args(["switch-client", "-t", session_name])
        .status()?;
    Ok(())
}
