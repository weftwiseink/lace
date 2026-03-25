//! sprack-claude: Claude Code summarizer daemon.
//!
//! Detects Claude Code instances running in tmux panes, reads their JSONL
//! session files via efficient tail-seeking, and writes structured status
//! to the shared SQLite process_integrations table.
//!
//! Local panes are resolved by walking the Linux /proc filesystem from pane PIDs.
//! Container panes (lace devcontainer sessions) are resolved via the `~/.claude`
//! bind mount using workspace prefix matching and mtime heuristics.

mod cache;
mod events;
mod jsonl;
mod proc_walk;
mod resolver;
mod session;
mod status;

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use signal_hook::consts::{SIGINT, SIGTERM};
use signal_hook::iterator::Signals;

use crate::session::SessionFileState;
use crate::status::ClaudeSummary;

/// Integration kind identifier for process_integrations table.
const INTEGRATION_KIND: &str = "claude_code";

/// Poll interval between cycles.
const POLL_INTERVAL: Duration = Duration::from_millis(2000);

/// How often to check for signals during a wait.
const SIGNAL_CHECK_GRANULARITY: Duration = Duration::from_millis(50);

fn main() {
    if let Err(error) = run() {
        eprintln!("sprack-claude: {error}");
        std::process::exit(1);
    }
}

/// Top-level entry point for the daemon.
///
/// Handles PID file management, DB setup, signal registration, and the main loop.
fn run() -> anyhow::Result<()> {
    check_already_running()?;
    if let Err(error) = write_pid_file() {
        eprintln!("sprack-claude: failed to write PID file: {error}");
    }

    let _pid_guard = PidFileGuard;

    let db_connection = sprack_db::open_db(None)?;
    let mut signals = Signals::new([SIGINT, SIGTERM])?;
    let mut session_cache: HashMap<String, SessionFileState> = HashMap::new();

    let home = std::env::var("HOME")
        .map_err(|_| anyhow::anyhow!("HOME environment variable not set"))?;
    let claude_home = PathBuf::from(&home).join(".claude");

    loop {
        run_poll_cycle(&db_connection, &mut session_cache, &claude_home);

        if wait_for_shutdown_signal(&mut signals, POLL_INTERVAL) {
            return Ok(());
        }
    }
}

/// Executes a single poll cycle: find Claude panes, resolve sessions, write status.
fn run_poll_cycle(
    db_connection: &rusqlite::Connection,
    session_cache: &mut HashMap<String, SessionFileState>,
    claude_home: &std::path::Path,
) {
    let snapshot = match sprack_db::read::read_full_state(db_connection) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            eprintln!("sprack-claude: failed to read DB state: {error}");
            return;
        }
    };

    let candidate_panes = resolver::find_candidate_panes(&snapshot);
    let lace_sessions = resolver::build_lace_session_map(&snapshot.sessions);
    let mut active_pane_ids: Vec<String> = Vec::new();

    for pane in &candidate_panes {
        active_pane_ids.push(pane.pane_id.clone());
        let lace_session = lace_sessions.get(&pane.session_name);
        process_claude_pane(
            db_connection,
            pane,
            session_cache,
            claude_home,
            lace_session,
        );
    }

    clean_stale_integrations(db_connection, &active_pane_ids);

    // Evict cache entries for panes no longer running Claude.
    session_cache.retain(|pane_id, _| active_pane_ids.contains(pane_id));
}

/// Processes a single Claude pane: resolve session, read entries, write status.
///
/// Dispatches to `LocalResolver` or `LaceContainerResolver` based on pane context.
///
/// For panes with "claude" in `current_command`, tries local `/proc` resolution
/// first (the process is running on the host). Falls back to container resolution
/// for lace sessions if local resolution fails. For non-claude panes in lace
/// sessions (e.g., ssh tunnels), uses container resolution directly.
fn process_claude_pane(
    db_connection: &rusqlite::Connection,
    pane: &sprack_db::types::Pane,
    session_cache: &mut HashMap<String, SessionFileState>,
    claude_home: &std::path::Path,
    lace_session: Option<&sprack_db::types::Session>,
) {
    // Check if we have a cached session and whether it's still valid.
    let is_cache_valid = is_session_cache_valid(pane, session_cache.get(&pane.pane_id));

    if !is_cache_valid {
        session_cache.remove(&pane.pane_id);

        // Resolve session file. Local claude panes (current_command contains "claude")
        // try proc-walk first since the process runs on the host, even within lace
        // sessions. Non-claude panes in lace sessions (e.g., ssh tunnels) go directly
        // to container resolution.
        let is_local_claude = pane.current_command.contains("claude");

        let resolved = if is_local_claude {
            resolve_session_for_pane(pane, claude_home).or_else(|| {
                lace_session.and_then(|session| {
                    resolver::resolve_container_pane(session, claude_home)
                })
            })
        } else if let Some(session) = lace_session {
            resolver::resolve_container_pane(session, claude_home)
        } else {
            None
        };

        match resolved {
            Some(state) => {
                session_cache.insert(pane.pane_id.clone(), state);
            }
            None => {
                write_error_integration(db_connection, &pane.pane_id, "no session file found");
                return;
            }
        }
    }

    let session_state = match session_cache.get_mut(&pane.pane_id) {
        Some(state) => state,
        None => return,
    };

    // Read new entries.
    let entries = if session_state.file_position == 0 {
        let entries = jsonl::tail_read(&session_state.session_file, jsonl::default_tail_bytes());
        session_state.file_position = std::fs::metadata(&session_state.session_file)
            .map(|m| m.len())
            .unwrap_or(0);
        entries
    } else {
        jsonl::incremental_read(
            &session_state.session_file,
            &mut session_state.file_position,
        )
    };

    // Merge with previously cached entries if we got new ones.
    if !entries.is_empty() {
        session_state.last_entries = entries;
    }

    if session_state.last_entries.is_empty() {
        write_error_integration(db_connection, &pane.pane_id, "no parseable session entries");
        return;
    }

    let mut summary = status::build_summary(&session_state.last_entries);

    // Override session_name with customTitle from sessions-index.json if available.
    // customTitle is the user-set name via `/rename`, preferred over the auto-generated slug.
    if let Some(ref custom_title) = session_state.session_name {
        summary.session_name = Some(custom_title.clone());
    }

    // Read hook events and merge into summary (graceful: no-op if no event files exist).
    if let Some(event_dir) = events::default_event_dir() {
        if event_dir.is_dir() {
            // Prefer session_id-based lookup when a previous SessionStart provided one.
            // Falls back to cwd-based scan for the initial discovery.
            let event_file = session_state
                .hook_session_id
                .as_deref()
                .and_then(|sid| events::find_event_file_by_session_id(&event_dir, sid))
                .or_else(|| events::find_event_file(&event_dir, &pane.current_path));

            if let Some(event_file) = event_file {
                let hook_events =
                    events::read_events(&event_file, &mut session_state.event_file_position);
                if !hook_events.is_empty() {
                    // Extract session_id and transcript_path from SessionStart events.
                    for event in &hook_events {
                        if let events::HookEvent::SessionStart {
                            session_id,
                            transcript_path,
                            ..
                        } = event
                        {
                            session_state.hook_session_id = Some(session_id.clone());

                            if let Some(tp) = transcript_path {
                                let tp_path = PathBuf::from(tp);
                                // Only use transcript_path if the file exists on the host.
                                // Container-internal paths (e.g., /home/node/.claude/...)
                                // won't resolve and should be ignored.
                                if tp_path.is_file() {
                                    session_state.hook_transcript_path = Some(tp_path);
                                }
                            }
                        }
                    }

                    // If hook provided a transcript_path that differs from the current
                    // session_file, switch to it and reset file_position to re-read.
                    if let Some(ref hook_path) = session_state.hook_transcript_path {
                        if *hook_path != session_state.session_file {
                            session_state.session_file = hook_path.clone();
                            session_state.file_position = 0;
                            session_state.last_entries.clear();

                            // Re-read from the correct file.
                            let entries = jsonl::tail_read(
                                &session_state.session_file,
                                jsonl::default_tail_bytes(),
                            );
                            session_state.file_position =
                                std::fs::metadata(&session_state.session_file)
                                    .map(|m| m.len())
                                    .unwrap_or(0);
                            if !entries.is_empty() {
                                session_state.last_entries = entries;
                            }

                            // Rebuild summary from the correct file's entries.
                            summary = status::build_summary(&session_state.last_entries);
                            if let Some(ref custom_title) = session_state.session_name {
                                summary.session_name = Some(custom_title.clone());
                            }
                        }
                    }

                    session_state.cached_hook_events.extend(hook_events);
                }
                events::merge_hook_events(&mut summary, &session_state.cached_hook_events);
            }
        }
    }

    let process_status = status::summary_to_process_status(&summary);
    let summary_json = match serde_json::to_string(&summary) {
        Ok(json) => json,
        Err(error) => {
            eprintln!("sprack-claude: failed to serialize summary: {error}");
            return;
        }
    };

    write_integration_with_retry(db_connection, &pane.pane_id, &summary_json, &process_status);
}

/// Maximum age for a container session file to be considered "still active".
/// Container panes have no PID to check, so staleness relies on file mtime.
const CONTAINER_SESSION_MAX_AGE: Duration = Duration::from_secs(60);

/// Checks whether the cached session state is still valid for a pane.
fn is_session_cache_valid(
    _pane: &sprack_db::types::Pane,
    cached_state: Option<&SessionFileState>,
) -> bool {
    let state = match cached_state {
        Some(state) => state,
        None => return false,
    };

    // Check if session file still exists.
    if !state.session_file.exists() {
        return false;
    }

    match &state.cache_key {
        session::CacheKey::Pid(pid) => {
            // Local pane: check if the Claude process is still alive.
            let proc_path = format!("/proc/{pid}");
            if !std::path::Path::new(&proc_path).exists() {
                return false;
            }
        }
        session::CacheKey::ContainerSession(_path) => {
            // Container pane: check that the session file has been modified recently.
            // No PID to check across PID namespace boundaries.
            if let Ok(metadata) = std::fs::metadata(&state.session_file) {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(elapsed) = modified.elapsed() {
                        if elapsed > CONTAINER_SESSION_MAX_AGE {
                            return false;
                        }
                    }
                }
            } else {
                return false;
            }
        }
    }

    true
}

/// Resolves a pane to its Claude Code session file via /proc.
///
/// `claude_home` is the base path to the Claude Code data directory (typically `$HOME/.claude`).
fn resolve_session_for_pane(
    pane: &sprack_db::types::Pane,
    claude_home: &std::path::Path,
) -> Option<SessionFileState> {
    let shell_pid = pane.pane_pid?;
    let claude_pid = proc_walk::find_claude_pid(shell_pid)?;
    let process_cwd = proc_walk::read_process_cwd(claude_pid)?;
    let encoded_path = proc_walk::encode_project_path(&process_cwd);

    let project_dir = claude_home.join("projects").join(&encoded_path);

    let resolved = session::find_session_file(&project_dir)?;

    Some(SessionFileState {
        cache_key: session::CacheKey::Pid(claude_pid),
        session_file: resolved.path,
        file_position: 0,
        last_entries: Vec::new(),
        event_file_position: 0,
        cached_hook_events: Vec::new(),
        session_name: resolved.custom_title,
        hook_transcript_path: None,
        hook_session_id: None,
    })
}

/// Writes an integration with a single retry on failure.
fn write_integration_with_retry(
    db_connection: &rusqlite::Connection,
    pane_id: &str,
    summary_json: &str,
    process_status: &sprack_db::types::ProcessStatus,
) {
    if let Err(first_error) = sprack_db::write::write_integration(
        db_connection,
        pane_id,
        INTEGRATION_KIND,
        summary_json,
        process_status,
    ) {
        eprintln!("sprack-claude: DB write failed (retrying): {first_error}");
        std::thread::sleep(Duration::from_millis(100));

        if let Err(retry_error) = sprack_db::write::write_integration(
            db_connection,
            pane_id,
            INTEGRATION_KIND,
            summary_json,
            process_status,
        ) {
            eprintln!("sprack-claude: DB write retry failed: {retry_error}");
        }
    }
}

/// Writes an error integration entry for a pane.
fn write_error_integration(
    db_connection: &rusqlite::Connection,
    pane_id: &str,
    error_message: &str,
) {
    let summary = ClaudeSummary {
        state: "error".to_string(),
        model: None,
        subagent_count: 0,
        context_percent: 0,
        last_tool: None,
        error_message: Some(error_message.to_string()),
        last_activity: None,
        tasks: None,
        session_summary: None,
        session_purpose: None,
        tokens_used: None,
        tokens_max: None,
        session_name: None,
    };

    let summary_json = match serde_json::to_string(&summary) {
        Ok(json) => json,
        Err(error) => {
            eprintln!("sprack-claude: failed to serialize error summary: {error}");
            return;
        }
    };

    write_integration_with_retry(
        db_connection,
        pane_id,
        &summary_json,
        &sprack_db::types::ProcessStatus::Error,
    );
}

/// Deletes process_integrations rows for pane IDs no longer running Claude.
fn clean_stale_integrations(db_connection: &rusqlite::Connection, active_pane_ids: &[String]) {
    // Read existing claude_code integrations.
    let snapshot = match sprack_db::read::read_full_state(db_connection) {
        Ok(snapshot) => snapshot,
        Err(_) => return,
    };

    let stale_pane_ids: Vec<&str> = snapshot
        .integrations
        .iter()
        .filter(|integration| integration.kind == INTEGRATION_KIND)
        .filter(|integration| !active_pane_ids.contains(&integration.pane_id))
        .map(|integration| integration.pane_id.as_str())
        .collect();

    for pane_id in stale_pane_ids {
        if let Err(error) = db_connection.execute(
            "DELETE FROM process_integrations WHERE pane_id = ?1 AND kind = ?2",
            rusqlite::params![pane_id, INTEGRATION_KIND],
        ) {
            eprintln!("sprack-claude: failed to clean stale integration for {pane_id}: {error}");
        }
    }
}

/// Waits for a shutdown signal (SIGINT/SIGTERM) or timeout.
///
/// Returns true if a shutdown signal was received.
fn wait_for_shutdown_signal(signals: &mut Signals, timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;

    // Check already-pending signals.
    for signal in signals.pending() {
        if signal == SIGINT || signal == SIGTERM {
            return true;
        }
    }

    while std::time::Instant::now() < deadline {
        std::thread::sleep(SIGNAL_CHECK_GRANULARITY);
        for signal in signals.pending() {
            if signal == SIGINT || signal == SIGTERM {
                return true;
            }
        }
    }

    false
}

// === PID file management ===

/// Returns the PID file path: `~/.local/share/sprack/claude.pid`.
fn pid_file_path() -> anyhow::Result<PathBuf> {
    let home =
        std::env::var("HOME").map_err(|_| anyhow::anyhow!("HOME environment variable not set"))?;
    Ok(PathBuf::from(home).join(".local/share/sprack/claude.pid"))
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

/// Checks whether another sprack-claude instance is already running.
///
/// Reads the PID file and verifies the process is alive using /proc/<pid>.
/// If the process is dead, the stale PID file is removed.
fn check_already_running() -> anyhow::Result<()> {
    let pid_path = match pid_file_path() {
        Ok(path) => path,
        Err(_) => return Ok(()),
    };

    let pid_string = match std::fs::read_to_string(&pid_path) {
        Ok(contents) => contents,
        Err(_) => return Ok(()),
    };

    let pid: u32 = match pid_string.trim().parse() {
        Ok(pid) => pid,
        Err(_) => {
            let _ = std::fs::remove_file(&pid_path);
            return Ok(());
        }
    };

    let proc_path = PathBuf::from(format!("/proc/{pid}"));
    if proc_path.exists() {
        anyhow::bail!("already running (PID {pid})");
    }

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
