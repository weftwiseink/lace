//! Keyboard and mouse event handling.
//!
//! Maps crossterm events to tree state navigation and application commands.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};

use crate::app::App;
use crate::tmux;
use crate::tree::NodeId;

/// Handles a keyboard event, updating app state accordingly.
pub fn handle_key(app: &mut App, key: KeyEvent) {
    // Ctrl+C quits regardless of other keybindings.
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        app.should_quit = true;
        return;
    }

    match key.code {
        KeyCode::Char('q') => app.should_quit = true,

        // Navigation: vim keys and arrow key aliases.
        KeyCode::Char('j') | KeyCode::Down => {
            app.tree_state.key_down();
        }
        KeyCode::Char('k') | KeyCode::Up => {
            app.tree_state.key_up();
        }
        KeyCode::Char('h') | KeyCode::Left => {
            app.tree_state.key_left();
        }
        KeyCode::Char('l') | KeyCode::Right => {
            app.tree_state.key_right();
        }

        // Collapse/expand toggle.
        KeyCode::Char(' ') => {
            app.tree_state.toggle_selected();
        }

        // Focus selected node in tmux.
        KeyCode::Enter => {
            if let Some(snapshot) = &app.last_snapshot {
                let selected = app.tree_state.selected();
                if let Some(node_id) = selected.last() {
                    let _ = tmux::focus_node(node_id, snapshot);
                }
            }
        }

        // Select first/last node.
        KeyCode::Char('g') => {
            app.tree_state.select_first();
        }
        KeyCode::Char('G') => {
            app.tree_state.select_last();
        }

        _ => {}
    }
}

/// Handles a mouse event, updating tree state accordingly.
pub fn handle_mouse(app: &mut App, mouse: MouseEvent) {
    match mouse.kind {
        MouseEventKind::ScrollUp => {
            app.tree_state.scroll_up(3);
        }
        MouseEventKind::ScrollDown => {
            app.tree_state.scroll_down(3);
        }
        MouseEventKind::Down(MouseButton::Left) => {
            let position = ratatui::layout::Position::new(mouse.column, mouse.row);

            // Check what node lives at the click position.
            let is_non_leaf = app
                .tree_state
                .rendered_at(position)
                .and_then(|ids| ids.last())
                .is_some_and(|id| !matches!(id, NodeId::Pane(_)));

            if is_non_leaf {
                // Non-leaf nodes (session, window, host group): select and
                // always toggle expand/collapse on single click.
                let ids = app
                    .tree_state
                    .rendered_at(position)
                    .unwrap()
                    .to_vec();
                app.tree_state.select(ids.clone());
                app.tree_state.toggle(ids);
            } else {
                // Leaf nodes (panes): default click_at behavior (select, or
                // toggle if already selected).
                app.tree_state.click_at(position);
            }
        }
        _ => {}
    }
}
