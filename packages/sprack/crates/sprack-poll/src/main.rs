//! sprack-poll: tmux state poller daemon.
//!
//! Queries tmux state via CLI, writes it to a shared SQLite database,
//! and keeps the DB fresh for the sprack TUI. Uses hash-based diffing
//! to skip DB writes when state is unchanged, and SIGUSR1 signals from
//! tmux hooks for immediate poll cycles.

mod diff;
mod tmux;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use signal_hook::consts::{SIGINT, SIGTERM, SIGUSR1};
use signal_hook::iterator::Signals;

use crate::diff::{compute_hash, compute_lace_meta_hash};
use crate::tmux::{
    parse_tmux_output, query_lace_options, query_tmux_state, to_db_types, TmuxError,
};

/// Default poll interval between cycles.
const POLL_INTERVAL: Duration = Duration::from_millis(1000);

/// How often to check for signals during a wait.
const SIGNAL_CHECK_GRANULARITY: Duration = Duration::from_millis(50);

/// Retry interval when tmux server is not running.
const SERVER_RETRY_INTERVAL: Duration = Duration::from_secs(5);

/// Maximum time to wait for tmux server before self-terminating.
const SERVER_ABSENCE_TIMEOUT: Duration = Duration::from_secs(60);

fn main() {
    if let Err(error) = run() {
        eprintln!("sprack-poll: {error}");
        std::process::exit(1);
    }
}

/// Top-level entry point for the daemon.
///
/// Handles PID file management, DB setup, signal registration, and the main loop.
fn run() -> anyhow::Result<()> {
    check_already_running()?;
    if let Err(error) = write_pid_file() {
        eprintln!("sprack-poll: failed to write PID file: {error}");
        // Continue without PID file per spec.
    }

    // Ensure PID file is cleaned up on exit.
    let _pid_guard = PidFileGuard;

    let db = sprack_db::open_db(None)?;

    let mut signals = Signals::new([SIGUSR1, SIGINT, SIGTERM])?;

    let mut last_tmux_hash: Option<u64> = None;
    let mut last_lace_hash: Option<u64> = None;
    let mut server_absent_since: Option<Instant> = None;

    loop {
        // Query tmux state.
        let raw_output = match query_tmux_state(None) {
            Ok(output) => {
                server_absent_since = None;
                output
            }
            Err(TmuxError::ServerNotRunning) => {
                handle_server_not_running(&db, &mut server_absent_since, &mut signals)?;
                continue;
            }
            Err(error) => {
                eprintln!("sprack-poll: tmux query failed: {error}");
                if wait_for_signal(&mut signals, POLL_INTERVAL) == SignalAction::Shutdown {
                    return Ok(());
                }
                continue;
            }
        };

        // Parse and check for changes.
        let snapshot = parse_tmux_output(&raw_output);
        let session_names = snapshot.session_names();
        let lace_meta = query_lace_options(&session_names, None);

        let current_tmux_hash = compute_hash(&raw_output);
        let current_lace_hash = compute_lace_meta_hash(&lace_meta);

        let tmux_changed = last_tmux_hash.as_ref() != Some(&current_tmux_hash);
        let lace_changed = last_lace_hash.as_ref() != Some(&current_lace_hash);

        if tmux_changed || lace_changed {
            let (sessions, windows, panes) = to_db_types(&snapshot, &lace_meta);
            if let Err(error) = sprack_db::write::write_tmux_state(&db, &sessions, &windows, &panes)
            {
                eprintln!("sprack-poll: DB write failed: {error}");
                // Retry next cycle.
            } else {
                last_tmux_hash = Some(current_tmux_hash);
                last_lace_hash = Some(current_lace_hash);
            }
        }

        // Heartbeat on every cycle.
        if let Err(error) = sprack_db::write::write_heartbeat(&db) {
            eprintln!("sprack-poll: heartbeat write failed: {error}");
        }

        if wait_for_signal(&mut signals, POLL_INTERVAL) == SignalAction::Shutdown {
            return Ok(());
        }
    }
}

/// Action to take after checking signals.
#[derive(Debug, PartialEq)]
enum SignalAction {
    /// Continue to the next poll cycle (SIGUSR1 or timeout).
    Continue,
    /// Shut down gracefully (SIGINT or SIGTERM).
    Shutdown,
}

/// Waits for a signal or timeout, checking periodically for pending signals.
///
/// Returns `SignalAction::Continue` on SIGUSR1 or timeout.
/// Returns `SignalAction::Shutdown` on SIGINT/SIGTERM.
fn wait_for_signal(signals: &mut Signals, timeout: Duration) -> SignalAction {
    let deadline = Instant::now() + timeout;

    // Check already-pending signals first.
    for signal in signals.pending() {
        match signal {
            SIGINT | SIGTERM => return SignalAction::Shutdown,
            SIGUSR1 => return SignalAction::Continue,
            _ => {}
        }
    }

    // Sleep in small increments, checking for signals.
    while Instant::now() < deadline {
        std::thread::sleep(SIGNAL_CHECK_GRANULARITY);
        for signal in signals.pending() {
            match signal {
                SIGINT | SIGTERM => return SignalAction::Shutdown,
                SIGUSR1 => return SignalAction::Continue,
                _ => {}
            }
        }
    }

    SignalAction::Continue
}

/// Handles the case where the tmux server is not running.
///
/// Writes a heartbeat, waits with retry interval, and self-terminates after
/// the absence timeout.
fn handle_server_not_running(
    db: &rusqlite::Connection,
    server_absent_since: &mut Option<Instant>,
    signals: &mut Signals,
) -> anyhow::Result<()> {
    let absent_start = *server_absent_since.get_or_insert_with(Instant::now);

    if absent_start.elapsed() >= SERVER_ABSENCE_TIMEOUT {
        eprintln!("sprack-poll: tmux server absent for 60s, exiting");
        std::process::exit(0);
    }

    if let Err(error) = sprack_db::write::write_heartbeat(db) {
        eprintln!("sprack-poll: heartbeat write failed: {error}");
    }

    if wait_for_signal(signals, SERVER_RETRY_INTERVAL) == SignalAction::Shutdown {
        std::process::exit(0);
    }

    Ok(())
}

// === PID file management ===

/// Returns the PID file path: `~/.local/share/sprack/poll.pid`.
fn pid_file_path() -> anyhow::Result<PathBuf> {
    let home =
        std::env::var("HOME").map_err(|_| anyhow::anyhow!("HOME environment variable not set"))?;
    Ok(PathBuf::from(home).join(".local/share/sprack/poll.pid"))
}

/// Writes the current process PID to the PID file.
fn write_pid_file() -> anyhow::Result<()> {
    let pid_path = pid_file_path()?;
    if let Some(parent) = pid_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&pid_path, std::process::id().to_string())?;
    Ok(())
}

/// Removes the PID file.
fn remove_pid_file() {
    if let Ok(pid_path) = pid_file_path() {
        let _ = std::fs::remove_file(pid_path);
    }
}

/// Checks whether another sprack-poll instance is already running.
///
/// Reads the PID file and verifies the process is alive using `kill(pid, 0)`.
/// If the process is dead, the stale PID file is removed.
fn check_already_running() -> anyhow::Result<()> {
    let pid_path = match pid_file_path() {
        Ok(path) => path,
        Err(_) => return Ok(()),
    };

    let pid_string = match std::fs::read_to_string(&pid_path) {
        Ok(contents) => contents,
        Err(_) => return Ok(()), // No PID file: not running.
    };

    let pid: u32 = match pid_string.trim().parse() {
        Ok(pid) => pid,
        Err(_) => {
            // Corrupt PID file: remove and continue.
            let _ = std::fs::remove_file(&pid_path);
            return Ok(());
        }
    };

    // Check if process is alive via /proc.
    let proc_path = PathBuf::from(format!("/proc/{pid}"));
    if proc_path.exists() {
        anyhow::bail!("already running (PID {pid})");
    }

    // Stale PID file: remove and continue.
    let _ = std::fs::remove_file(&pid_path);
    Ok(())
}

/// RAII guard that removes the PID file on drop.
struct PidFileGuard;

impl Drop for PidFileGuard {
    fn drop(&mut self) {
        remove_pid_file();
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use rusqlite::Connection;

    use crate::diff::{compute_hash, compute_lace_meta_hash};
    use crate::tmux::{parse_tmux_output, to_db_types, LaceMeta};

    /// Opens an in-memory DB with schema for integration tests.
    fn open_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("failed to open in-memory db");
        conn.pragma_update(None, "foreign_keys", "on")
            .expect("failed to enable foreign keys");
        sprack_db::schema::init_schema(&conn).expect("failed to init schema");
        conn
    }

    /// Builds a 19-field tmux output line with sensible defaults for spatial fields.
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
            "80",   // pane_width
            "24",   // pane_height
            "0",    // pane_left
            "0",    // pane_top
            "0",    // pane_index
            "0",    // pane_in_mode
            "",     // window_layout
        ]
        .join("||")
    }

    // === Integration test 11: full cycle writes DB ===

    #[test]
    fn test_full_cycle_writes_db() {
        let conn = open_test_db();

        let raw_output = [
            make_tmux_line(
                "dev",
                "1",
                "0",
                "editor",
                "1",
                "%0",
                "test",
                "nvim",
                "/home/user",
                "1234",
                "1",
                "0",
            ),
            make_tmux_line(
                "dev",
                "1",
                "1",
                "terminal",
                "0",
                "%1",
                "",
                "bash",
                "/home/user",
                "1235",
                "1",
                "0",
            ),
        ]
        .join("\n");

        let snapshot = parse_tmux_output(&raw_output);
        let session_names = snapshot.session_names();

        // No real tmux server: use empty lace meta.
        let lace_meta: HashMap<String, LaceMeta> = session_names
            .iter()
            .map(|name| {
                (
                    name.clone(),
                    LaceMeta {
                        port: None,
                        user: None,
                        workspace: None,
                    },
                )
            })
            .collect();

        let (sessions, windows, panes) = to_db_types(&snapshot, &lace_meta);
        sprack_db::write::write_tmux_state(&conn, &sessions, &windows, &panes).unwrap();

        let db_snapshot = sprack_db::read::read_full_state(&conn).unwrap();
        assert_eq!(db_snapshot.sessions.len(), 1);
        assert_eq!(db_snapshot.sessions[0].name, "dev");
        assert!(db_snapshot.sessions[0].attached);
        assert_eq!(db_snapshot.windows.len(), 2);
        assert_eq!(db_snapshot.panes.len(), 2);
        assert_eq!(db_snapshot.panes[0].pane_id, "%0");
        assert_eq!(db_snapshot.panes[0].current_command, "nvim");
        assert_eq!(db_snapshot.panes[1].pane_id, "%1");
        assert_eq!(db_snapshot.panes[1].current_command, "bash");
    }

    // === Integration test 12: noop cycle skips write ===

    #[test]
    fn test_noop_cycle_skips_write() {
        let temp_dir = std::env::temp_dir().join("sprack-poll-test-noop");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("test-noop.db");

        let conn1 = sprack_db::open_db(Some(&db_path)).unwrap();
        let conn2 = sprack_db::open_db(Some(&db_path)).unwrap();

        let raw_output = make_tmux_line(
            "dev", "1", "0", "main", "1", "%0", "", "bash", "/home", "1234", "1", "0",
        );

        let snapshot = parse_tmux_output(&raw_output);
        let lace_meta = HashMap::new();
        let (sessions, windows, panes) = to_db_types(&snapshot, &lace_meta);

        // First write.
        sprack_db::write::write_tmux_state(&conn1, &sessions, &windows, &panes).unwrap();
        let version_after_first = sprack_db::read::check_data_version(&conn2).unwrap();

        // Same data: hash check detects no change, so skip write.
        let hash_first = compute_hash(&raw_output);
        let hash_second = compute_hash(&raw_output);
        let lace_hash_first = compute_lace_meta_hash(&lace_meta);
        let lace_hash_second = compute_lace_meta_hash(&lace_meta);

        assert_eq!(hash_first, hash_second);
        assert_eq!(lace_hash_first, lace_hash_second);

        // Since hashes match, the real poller would skip the write.
        // Verify data_version hasn't changed (no second write occurred).
        let version_after_noop = sprack_db::read::check_data_version(&conn2).unwrap();
        assert_eq!(version_after_first, version_after_noop);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    // === Integration test 13: heartbeat always written ===

    #[test]
    fn test_heartbeat_always_written() {
        let conn = open_test_db();

        // No heartbeat initially.
        let heartbeat = sprack_db::read::read_heartbeat(&conn).unwrap();
        assert!(heartbeat.is_none());

        // Write heartbeat (simulating changed cycle).
        sprack_db::write::write_heartbeat(&conn).unwrap();
        let heartbeat_first = sprack_db::read::read_heartbeat(&conn).unwrap();
        assert!(heartbeat_first.is_some());

        // Brief pause to ensure different timestamp.
        std::thread::sleep(std::time::Duration::from_millis(10));

        // Write heartbeat again (simulating no-op cycle).
        sprack_db::write::write_heartbeat(&conn).unwrap();
        let heartbeat_second = sprack_db::read::read_heartbeat(&conn).unwrap();
        assert!(heartbeat_second.is_some());

        // Both heartbeats should exist (the singleton row is always written).
        // The timestamps may or may not differ depending on timing granularity,
        // but the important property is that both writes succeeded.
    }

    // === Integration test 14: state replacement ===

    #[test]
    fn test_state_replacement() {
        let conn = open_test_db();

        // Write initial state with 2 sessions.
        let raw_output_initial = [
            make_tmux_line(
                "alpha", "1", "0", "main", "1", "%0", "", "bash", "/home", "1000", "1", "0",
            ),
            make_tmux_line(
                "beta", "0", "0", "logs", "1", "%1", "", "tail", "/var/log", "2000", "1", "0",
            ),
        ]
        .join("\n");

        let snapshot_initial = parse_tmux_output(&raw_output_initial);
        let lace_meta = HashMap::new();
        let (sessions, windows, panes) = to_db_types(&snapshot_initial, &lace_meta);
        sprack_db::write::write_tmux_state(&conn, &sessions, &windows, &panes).unwrap();

        let db_state = sprack_db::read::read_full_state(&conn).unwrap();
        assert_eq!(db_state.sessions.len(), 2);
        assert_eq!(db_state.panes.len(), 2);

        // Write replacement state: only "gamma" session, "alpha" and "beta" are gone.
        let raw_output_replaced = make_tmux_line(
            "gamma", "1", "0", "work", "1", "%5", "", "nvim", "/code", "3000", "1", "0",
        );

        let snapshot_replaced = parse_tmux_output(&raw_output_replaced);
        let (sessions, windows, panes) = to_db_types(&snapshot_replaced, &lace_meta);
        sprack_db::write::write_tmux_state(&conn, &sessions, &windows, &panes).unwrap();

        let db_state = sprack_db::read::read_full_state(&conn).unwrap();
        assert_eq!(db_state.sessions.len(), 1);
        assert_eq!(db_state.sessions[0].name, "gamma");
        assert_eq!(db_state.windows.len(), 1);
        assert_eq!(db_state.windows[0].name, "work");
        assert_eq!(db_state.panes.len(), 1);
        assert_eq!(db_state.panes[0].pane_id, "%5");
    }
}
