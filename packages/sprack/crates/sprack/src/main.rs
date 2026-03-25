//! sprack: TUI entry point for the sprack tmux sidecar.
//!
//! Renders a responsive collapsible tree of tmux sessions, windows, and panes
//! with real-time process integration status from a local SQLite database.

use std::io::{self, Stdout};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use crossterm::event::{DisableMouseCapture, EnableMouseCapture};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::{CrosstermBackend, TestBackend};
use ratatui::Terminal;

mod app;
mod colors;
mod daemon;
mod input;
mod layout;
mod render;
#[cfg(test)]
mod test_render;
mod tmux;
mod tree;

/// Parsed command-line arguments.
struct CliArgs {
    db_path: Option<PathBuf>,
    dump_rendered_tree: bool,
    cols: u16,
    rows: u16,
}

fn main() -> Result<()> {
    let cli = parse_args();

    if cli.dump_rendered_tree {
        return run_dump_rendered_tree(&cli);
    }

    // Install panic hook that restores the terminal before printing the panic.
    install_panic_hook();

    // Ensure the DB exists, starting daemons if needed.
    let db = open_or_wait_for_db(cli.db_path.as_deref())?;

    // Read $TMUX_PANE for self-filtering.
    let own_pane_id = std::env::var("TMUX_PANE").ok();

    // Set up the terminal.
    let mut terminal = setup_terminal()?;

    // Run the application.
    let mut app = app::App::new(db, own_pane_id);
    let run_result = app.run(&mut terminal);

    // Always restore the terminal, even if the app errored.
    restore_terminal(&mut terminal)?;

    run_result
}

/// Parses command-line arguments.
fn parse_args() -> CliArgs {
    let args: Vec<String> = std::env::args().collect();
    let mut cli = CliArgs {
        db_path: None,
        dump_rendered_tree: false,
        cols: 120,
        rows: 40,
    };

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--db-path" => {
                cli.db_path = args.get(i + 1).map(PathBuf::from);
                i += 2;
            }
            "--dump-rendered-tree" => {
                cli.dump_rendered_tree = true;
                i += 1;
            }
            "--cols" => {
                if let Some(val) = args.get(i + 1) {
                    cli.cols = val.parse().unwrap_or(120);
                }
                i += 2;
            }
            "--rows" => {
                if let Some(val) = args.get(i + 1) {
                    cli.rows = val.parse().unwrap_or(40);
                }
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }

    cli
}

/// Renders a single frame to stdout and exits.
///
/// No raw mode, no alternate screen, no event loop. Creates a TestBackend
/// at the specified dimensions, refreshes from DB, renders one frame,
/// prints the buffer text, and returns.
fn run_dump_rendered_tree(cli: &CliArgs) -> Result<()> {
    let db = open_or_wait_for_db(cli.db_path.as_deref())?;
    let own_pane_id = std::env::var("TMUX_PANE").ok();

    let mut app = app::App::new(db, own_pane_id);
    app.refresh_from_db()?;

    let backend = TestBackend::new(cli.cols, cli.rows);
    let mut terminal = Terminal::new(backend)?;
    terminal.draw(|frame| {
        render::render_frame(frame, &mut app);
    })?;

    let output = render::buffer_to_string(terminal.backend().buffer());
    print!("{output}");

    Ok(())
}

/// Installs a panic hook that restores the terminal before printing the panic.
fn install_panic_hook() {
    let default_panic = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen, DisableMouseCapture);
        default_panic(info);
    }));
}

/// Opens the database, starting sprack-poll and waiting if the DB doesn't exist.
fn open_or_wait_for_db(db_path: Option<&std::path::Path>) -> Result<rusqlite::Connection> {
    // If a custom path was given, try to open it directly.
    if let Some(path) = db_path {
        return sprack_db::open_db_readonly(Some(path))
            .context("failed to open database at specified path");
    }

    // Try the default path.
    let default_path = daemon::default_db_path()?;
    if default_path.exists() {
        match sprack_db::open_db_readonly(None) {
            Ok(conn) => return Ok(conn),
            Err(sprack_db::SprackDbError::UnsupportedSchemaVersion(v)) => {
                // DB was created by an older binary. Delete it so the poller
                // recreates it with the current schema.
                eprintln!("sprack: schema version {v} is outdated, recreating database...");
                let _ = std::fs::remove_file(&default_path);
                // Also remove WAL/SHM files.
                let _ = std::fs::remove_file(default_path.with_extension("db-wal"));
                let _ = std::fs::remove_file(default_path.with_extension("db-shm"));
                // Kill the old poller so we can restart with the new binary.
                daemon::stop_poller();
            }
            Err(_) => {}
        }
    }

    // DB doesn't exist or was just removed: try to start the poller daemon.
    if !daemon::is_poller_running() {
        eprintln!("sprack-poll not running, attempting to start...");
        if let Err(err) = daemon::start_sprack_poll() {
            eprintln!("warning: could not start sprack-poll: {err}");
        }
    }

    // Wait up to 5 seconds for the DB to appear with the correct schema.
    // The poller needs time to: start up, connect to tmux, query state,
    // create the DB, run init_schema, and write the first snapshot.
    let max_wait = Duration::from_secs(5);
    let poll_interval = Duration::from_millis(200);
    let mut waited = Duration::ZERO;
    let mut saw_wrong_version = false;

    while waited < max_wait {
        thread::sleep(poll_interval);
        waited += poll_interval;

        if default_path.exists() {
            match sprack_db::open_db_readonly(None) {
                Ok(conn) => return Ok(conn),
                Err(sprack_db::SprackDbError::UnsupportedSchemaVersion(_)) => {
                    saw_wrong_version = true;
                    continue;
                }
                Err(_) => continue,
            }
        }
    }

    // Show poller log if it exists (helps diagnose startup failures).
    if let Ok(data_dir) = daemon::sprack_data_dir() {
        let log_path = data_dir.join("poll.log");
        if let Ok(log_content) = std::fs::read_to_string(&log_path) {
            let log_content = log_content.trim();
            if !log_content.is_empty() {
                eprintln!("sprack-poll log:\n{log_content}");
            }
        }
    }

    if saw_wrong_version {
        bail!(
            "sprack-poll is creating a database with an outdated schema.\n\
             The sprack-poll binary is stale. Rebuild all binaries:\n  \
             cargo build && cargo run -p sprack"
        );
    }

    bail!(
        "Database not found at {}. Is sprack-poll running?\nTry: cargo build && cargo run -p sprack",
        default_path.display()
    );
}

/// Sets up the terminal: raw mode, alternate screen, mouse capture.
fn setup_terminal() -> Result<Terminal<CrosstermBackend<Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let terminal = Terminal::new(backend)?;
    Ok(terminal)
}

/// Restores the terminal: disable raw mode, leave alternate screen, show cursor.
fn restore_terminal(terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;
    Ok(())
}
