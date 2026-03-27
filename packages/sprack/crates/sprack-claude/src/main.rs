//! sprack-claude: Claude Code summarizer daemon.
//!
//! Detects Claude Code instances running in tmux panes, reads their JSONL
//! session files via efficient tail-seeking, and writes structured status
//! to the shared SQLite process_integrations table.
//!
//! Local panes are resolved by walking the Linux /proc filesystem from pane PIDs.
//! Container panes are resolved via the sprack devcontainer mount's hook bridge
//! event files, with a fallback to `~/.claude/projects/` directory matching.

mod cache;
mod events;
mod git;
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

/// How often to force a tail_read instead of incremental_read, in poll cycles.
/// At 2-second poll intervals, 5 cycles = ~10 seconds. This catches state
/// transitions that incremental reading missed (e.g., stale stop_reason: null).
const TAIL_READ_REFRESH_INTERVAL: u32 = 5;

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

    // Open session cache DB. Non-fatal: if it fails, proceed without cache enrichment.
    let cache_connection = match cache::open_cache_db(None) {
        Ok(conn) => Some(conn),
        Err(error) => {
            eprintln!("sprack-claude: failed to open session cache DB: {error}");
            None
        }
    };

    loop {
        run_poll_cycle(
            &db_connection,
            &mut session_cache,
            &claude_home,
            cache_connection.as_ref(),
        );

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
    cache_connection: Option<&rusqlite::Connection>,
) {
    let snapshot = match sprack_db::read::read_full_state(db_connection) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            eprintln!("sprack-claude: failed to read DB state: {error}");
            return;
        }
    };

    let candidate_panes = resolver::find_candidate_panes(&snapshot);
    let container_sessions = resolver::build_container_session_map(&snapshot.sessions);
    let mut active_pane_ids: Vec<String> = Vec::new();

    for pane in &candidate_panes {
        active_pane_ids.push(pane.pane_id.clone());
        let container_session = container_sessions.get(&pane.session_name);
        process_claude_pane(
            db_connection,
            pane,
            session_cache,
            claude_home,
            container_session,
            cache_connection,
        );
    }

    clean_stale_integrations(db_connection, &active_pane_ids);

    // Evict cache entries for panes no longer running Claude.
    session_cache.retain(|pane_id, _| active_pane_ids.contains(pane_id));
}

/// Processes a single Claude pane: resolve session, read entries, write status.
///
/// Dispatches to `LocalResolver` or container resolution based on pane context.
///
/// For panes with "claude" in `current_command`, tries local `/proc` resolution
/// first (the process is running on the host). Falls back to container resolution
/// for container sessions if local resolution fails. For non-claude panes in
/// container sessions, uses container resolution directly.
fn process_claude_pane(
    db_connection: &rusqlite::Connection,
    pane: &sprack_db::types::Pane,
    session_cache: &mut HashMap<String, SessionFileState>,
    claude_home: &std::path::Path,
    container_session: Option<&sprack_db::types::Session>,
    cache_connection: Option<&rusqlite::Connection>,
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
                container_session.and_then(|session| {
                    resolver::resolve_container_pane(session, claude_home, &pane.current_path)
                })
            })
        } else if let Some(session) = container_session {
            resolver::resolve_container_pane(session, claude_home, &pane.current_path)
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

    // Read new entries. Periodically force a full tail_read to catch state
    // transitions that incremental reading may have missed (e.g., stale
    // stop_reason: null cached in last_entries when no new data arrives).
    session_state.poll_cycle_count += 1;
    let force_tail_read = session_state.poll_cycle_count % TAIL_READ_REFRESH_INTERVAL == 0;

    let entries = if session_state.file_position == 0 || force_tail_read {
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
        // Ingest new entries into the session cache DB for aggregated metrics.
        // Pass the current file_position as the byte offset for deduplication:
        // on restart, tail_read re-reads entries already ingested, so the cache
        // checks the stored offset and skips entries that were already counted.
        if let Some(cache_conn) = cache_connection {
            let file_path_str = session_state
                .session_file
                .to_str()
                .unwrap_or("unknown");
            // Derive project_path from session file: parent of the JSONL file's parent dir.
            let project_path_str = session_state
                .session_file
                .parent()
                .and_then(|p| p.to_str())
                .unwrap_or("unknown");
            if let Err(error) = cache::ingest_new_entries_at(
                cache_conn,
                file_path_str,
                project_path_str,
                &entries,
                Some(session_state.file_position),
            ) {
                eprintln!("sprack-claude: cache ingestion failed: {error}");
            }
        }

        session_state.last_entries = entries;
    }

    if session_state.last_entries.is_empty() {
        write_error_integration(db_connection, &pane.pane_id, "no parseable session entries");
        return;
    }

    let mut summary = status::build_summary(
        &session_state.last_entries,
        session_state.session_name.as_deref(),
    );

    // Read hook events and merge into summary (graceful: no-op if no event files exist).
    // Search all event directories: per-project mounts first, then legacy flat directory.
    let event_file = {
        let dirs = events::event_dirs();
        let mut found: Option<PathBuf> = None;
        for event_dir in &dirs {
            // Prefer session_id-based lookup when a previous SessionStart provided one.
            // Falls back to cwd-based scan for the initial discovery.
            found = session_state
                .hook_session_id
                .as_deref()
                .and_then(|sid| events::find_event_file_by_session_id(event_dir, sid))
                .or_else(|| events::find_event_file(event_dir, &pane.current_path));
            if found.is_some() {
                break;
            }
        }
        found
    };

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
                    summary = status::build_summary(
                        &session_state.last_entries,
                        session_state.session_name.as_deref(),
                    );
                }
            }

            session_state.cached_hook_events.extend(hook_events);
        }
        events::merge_hook_events(&mut summary, &session_state.cached_hook_events);

        // If a SessionEnd event has been seen, the Claude session has exited.
        // Clear the integration and evict the cache entry so the pane is no
        // longer tracked. This is the primary exit detection for container panes
        // where current_command cannot distinguish Claude from the container shell.
        if has_session_end(&session_state.cached_hook_events) {
            delete_integration(db_connection, &pane.pane_id);
            session_cache.remove(&pane.pane_id);
            return;
        }
    }

    // Enrich summary with cached session data (turn counts, tool usage, context trend).
    if let Some(cache_conn) = cache_connection {
        let session_id = session_state
            .hook_session_id
            .as_deref()
            .or_else(|| {
                session_state
                    .last_entries
                    .iter()
                    .find_map(|e| e.session_id.as_deref())
            });
        if let Some(sid) = session_id {
            if let Some(cached) = cache::read_session_summary(cache_conn, sid) {
                summary.user_turns = Some(cached.user_turns);
                summary.assistant_turns = Some(cached.assistant_turns);
                if !cached.tool_counts.is_empty() {
                    summary.tool_counts = Some(cached.tool_counts);
                }
                summary.context_trend = cached.context_trend;
            }
        }
    }

    // Resolve git state: local panes via pane cwd, container panes via mount metadata.
    match &session_state.cache_key {
        session::CacheKey::Pid(_) => {
            resolve_git_state(session_state, &pane.current_path, &mut summary);
        }
        session::CacheKey::ContainerSession(_) => {
            if let Some(ref session) = container_session {
                resolve_container_git_state(session, &mut summary);
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
    pane: &sprack_db::types::Pane,
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
            // Guard against PID reuse: if the pane's command is no longer
            // "claude", the cached session belongs to a previous process.
            if !pane.current_command.contains("claude") {
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
        git_dir: None,
        git_head_mtime: None,
        git_branch: None,
        git_commit_short: None,
        git_worktrees_mtime: None,
        git_worktree_branches: None,
        poll_cycle_count: 0,
    })
}

/// Resolves git state for a pane and populates the summary fields.
///
/// Uses mtime-based caching: only re-reads `.git/HEAD` when its mtime changes.
/// The git_dir is resolved once (on first call or when None) and cached on
/// `SessionFileState` to avoid re-walking parent directories each cycle.
///
/// Worktree enumeration uses a separate mtime cache on the `worktrees/` directory.
fn resolve_git_state(
    session_state: &mut SessionFileState,
    pane_cwd: &str,
    summary: &mut ClaudeSummary,
) {
    let cwd = std::path::Path::new(pane_cwd);

    // Resolve git_dir once if not cached.
    if session_state.git_dir.is_none() {
        session_state.git_dir = git::resolve_git_dir(cwd);
    }

    let git_dir = match &session_state.git_dir {
        Some(dir) => dir.clone(),
        None => return,
    };

    // Check HEAD mtime to avoid re-reading unchanged state.
    let head_path = git_dir.join("HEAD");
    let current_mtime = std::fs::metadata(&head_path)
        .and_then(|m| m.modified())
        .ok();

    let needs_refresh = match (&session_state.git_head_mtime, &current_mtime) {
        (Some(cached), Some(current)) => cached != current,
        (None, Some(_)) => true,
        _ => false,
    };

    if needs_refresh {
        session_state.git_head_mtime = current_mtime;
        session_state.git_branch = git::read_git_branch(&git_dir);
        session_state.git_commit_short = session_state
            .git_branch
            .as_deref()
            .and_then(|branch| git::read_commit_short(&git_dir, branch));
    }

    // Enumerate worktrees with mtime-based caching on the worktrees directory.
    if let Some(ref branch) = session_state.git_branch {
        let worktrees_dir = git::worktrees_dir_path(&git_dir);
        let wt_mtime = worktrees_dir
            .as_ref()
            .and_then(|d| std::fs::metadata(d).and_then(|m| m.modified()).ok());

        let wt_needs_refresh = match (&session_state.git_worktrees_mtime, &wt_mtime) {
            (Some(cached), Some(current)) => cached != current,
            (None, Some(_)) => true,
            (Some(_), None) => true, // Directory disappeared: clear cache.
            (None, None) => false,
        };

        if wt_needs_refresh {
            session_state.git_worktrees_mtime = wt_mtime;
            let branches = git::enumerate_worktrees(&git_dir, branch);
            session_state.git_worktree_branches = if branches.is_empty() {
                None
            } else {
                Some(branches)
            };
        }
    }

    // Populate summary from cached git state.
    summary.git_branch = session_state.git_branch.clone();
    summary.git_commit_short = session_state.git_commit_short.clone();
    summary.git_worktree_branches = session_state.git_worktree_branches.clone();
}

/// Metadata read from a sprack mount's `state.json` file.
///
/// Written by the optional metadata writer in the sprack devcontainer feature.
/// Located at `~/.local/share/sprack/lace/<project>/metadata/state.json` on the host.
#[derive(Debug, serde::Deserialize)]
struct ContainerGitMetadata {
    #[serde(default)]
    container_name: Option<String>,
    #[serde(default)]
    git_branch: Option<String>,
    #[serde(default)]
    git_commit_short: Option<String>,
}

/// Resolves git state for a container pane using the sprack mount metadata.
///
/// Primary path: reads `state.json` from per-project mount directories and matches
/// by `container_name`. Falls back to `podman exec git` if the metadata file is
/// not available.
fn resolve_container_git_state(
    session: &sprack_db::types::Session,
    summary: &mut ClaudeSummary,
) {
    let container_name = match &session.container_name {
        Some(name) => name,
        None => return,
    };

    // Primary: read from sprack mount metadata.
    if resolve_container_git_via_metadata(container_name, summary) {
        return;
    }

    // Fallback: podman exec git commands.
    if let Some(workspace) = &session.container_workspace {
        resolve_container_git_via_exec(container_name, workspace, summary);
    }
}

/// Reads container git state from the sprack mount metadata file.
///
/// Scans `~/.local/share/sprack/lace/*/metadata/state.json` for a file whose
/// `container_name` field matches the target container. Returns `true` if git
/// state was populated.
fn resolve_container_git_via_metadata(
    container_name: &str,
    summary: &mut ClaudeSummary,
) -> bool {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return false,
    };

    let container_mounts_dir = PathBuf::from(&home).join(".local/share/sprack/lace");
    let entries = match std::fs::read_dir(&container_mounts_dir) {
        Ok(e) => e,
        Err(_) => return false,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let metadata_path = entry.path().join("metadata/state.json");
        if let Ok(content) = std::fs::read_to_string(&metadata_path) {
            if let Ok(meta) = serde_json::from_str::<ContainerGitMetadata>(&content) {
                // Match by container_name field inside the metadata file.
                let matches = meta
                    .container_name
                    .as_deref()
                    .is_some_and(|name| name == container_name);
                if matches {
                    summary.git_branch = meta.git_branch;
                    summary.git_commit_short = meta.git_commit_short;
                    return true;
                }
            }
        }
    }

    false
}

/// Resolves container git state by executing `git` commands inside the container.
///
/// Adds ~50ms per call for subprocess overhead. Used as a fallback when the
/// sprack devcontainer feature's metadata writer is not installed.
fn resolve_container_git_via_exec(
    container_name: &str,
    workspace: &str,
    summary: &mut ClaudeSummary,
) {
    // git rev-parse --abbrev-ref HEAD
    if let Ok(output) = std::process::Command::new("podman")
        .args([
            "exec",
            "--workdir",
            workspace,
            container_name,
            "git",
            "rev-parse",
            "--abbrev-ref",
            "HEAD",
        ])
        .output()
    {
        if output.status.success() {
            let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !branch.is_empty() {
                summary.git_branch = Some(branch);
            }
        }
    }

    // git rev-parse --short HEAD
    if let Ok(output) = std::process::Command::new("podman")
        .args([
            "exec",
            "--workdir",
            workspace,
            container_name,
            "git",
            "rev-parse",
            "--short",
            "HEAD",
        ])
        .output()
    {
        if output.status.success() {
            let commit = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !commit.is_empty() {
                summary.git_commit_short = Some(commit);
            }
        }
    }
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
        user_turns: None,
        assistant_turns: None,
        tool_counts: None,
        context_trend: None,
        git_branch: None,
        git_commit_short: None,
        git_worktree_branches: None,
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

/// Checks whether any SessionEnd event exists in the accumulated hook events.
fn has_session_end(events: &[events::HookEvent]) -> bool {
    events
        .iter()
        .any(|e| matches!(e, events::HookEvent::SessionEnd { .. }))
}

/// Deletes the integration row for a specific pane.
fn delete_integration(db_connection: &rusqlite::Connection, pane_id: &str) {
    if let Err(error) = db_connection.execute(
        "DELETE FROM process_integrations WHERE pane_id = ?1 AND kind = ?2",
        rusqlite::params![pane_id, INTEGRATION_KIND],
    ) {
        eprintln!("sprack-claude: failed to delete integration for {pane_id}: {error}");
    }
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
