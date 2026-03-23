//! Keyboard and mouse event handling.
//!
//! Maps crossterm events to tree state navigation and application commands.

use crossterm::event::{KeyCode, KeyEvent, MouseButton, MouseEvent, MouseEventKind};

use crate::app::App;
use crate::tmux;

/// Handles a keyboard event, updating app state accordingly.
pub fn handle_key(app: &mut App, key: KeyEvent) {
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
            // Single click selects the node at the click position.
            app.tree_state
                .click_at(ratatui::layout::Position::new(mouse.column, mouse.row));
        }
        _ => {}
    }
}
