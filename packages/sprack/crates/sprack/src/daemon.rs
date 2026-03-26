//! PID file management and daemon spawning.
//!
//! Handles auto-starting sprack-poll when the TUI launches and
//! no daemon is running.

use std::fs;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context, Result};

/// Returns the sprack data directory: `~/.local/share/sprack/`.
pub fn sprack_data_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME environment variable not set")?;
    Ok(PathBuf::from(home).join(".local/share/sprack"))
}

/// Returns the path to the sprack-poll PID file.
fn poll_pid_path() -> Result<PathBuf> {
    Ok(sprack_data_dir()?.join("poll.pid"))
}

/// Returns the path to the sprack-claude PID file.
fn claude_pid_path() -> Result<PathBuf> {
    Ok(sprack_data_dir()?.join("claude.pid"))
}

/// Checks whether the sprack-poll daemon is running by validating its PID file.
pub fn is_poller_running() -> bool {
    let pid_path = match poll_pid_path() {
        Ok(p) => p,
        Err(_) => return false,
    };
    is_process_running(&pid_path)
}

/// Validates a PID file: checks that the file exists, contains a valid PID,
/// and the process is alive.
fn is_process_running(pid_file: &Path) -> bool {
    let contents = match fs::read_to_string(pid_file) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let pid: u32 = match contents.trim().parse() {
        Ok(p) => p,
        Err(_) => return false,
    };

    // Check if process exists via kill(pid, 0).
    // SAFETY: signal 0 does not actually send a signal; it checks process existence.
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

/// Starts the sprack-poll daemon as a detached background process.
///
/// The daemon is spawned with `setsid()` to prevent signal propagation
/// from the TUI's process group. stdin/stdout/stderr are redirected to /dev/null.
///
/// Resolves the sprack-poll binary as a sibling of the current executable first,
/// falling back to PATH lookup. This ensures `./target/debug/sprack` finds
/// `./target/debug/sprack-poll` without requiring PATH configuration.
pub fn start_sprack_poll() -> Result<()> {
    let data_dir = sprack_data_dir()?;
    fs::create_dir_all(&data_dir)?;

    let pid_path = poll_pid_path()?;

    // Remove stale PID file if it exists.
    if pid_path.exists() && !is_process_running(&pid_path) {
        let _ = fs::remove_file(&pid_path);
    }

    let poll_binary = resolve_sibling_binary("sprack-poll");

    // Log file for daemon stderr (helps diagnose startup failures).
    let log_path = data_dir.join("poll.log");
    let log_file = fs::File::create(&log_path)
        .context("failed to create sprack-poll log file")?;

    // Spawn sprack-poll as a detached daemon.
    // NOTE(opus/sprack): Do not write the PID file here. sprack-poll manages
    // its own PID file on startup. Writing it from the parent causes a race:
    // sprack-poll's check_already_running() would see its own PID and exit.
    let _child = unsafe {
        Command::new(&poll_binary)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::from(log_file))
            .pre_exec(|| {
                libc::setsid();
                Ok(())
            })
            .spawn()
    }
    .context("failed to spawn sprack-poll daemon")?;

    Ok(())
}

/// Resolves a binary name by looking for it as a sibling of the current executable.
///
/// If the current executable is `/path/to/target/debug/sprack`, looks for
/// `/path/to/target/debug/<name>`. Falls back to the bare name (PATH lookup)
/// if the sibling path doesn't exist or the current exe can't be determined.
fn resolve_sibling_binary(name: &str) -> PathBuf {
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let sibling = exe_dir.join(name);
            if sibling.exists() {
                return sibling;
            }
        }
    }
    PathBuf::from(name)
}

/// Stops the sprack-poll daemon by sending SIGTERM to its PID.
///
/// Best-effort: logs to stderr on failure but does not return an error.
pub fn stop_poller() {
    let pid_path = match poll_pid_path() {
        Ok(p) => p,
        Err(_) => return,
    };
    let contents = match fs::read_to_string(&pid_path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let pid: i32 = match contents.trim().parse() {
        Ok(p) => p,
        Err(_) => return,
    };
    // SAFETY: SIGTERM is a standard termination signal.
    unsafe {
        libc::kill(pid, libc::SIGTERM);
    }
    // Remove stale PID file.
    let _ = fs::remove_file(&pid_path);
}

/// Checks whether the sprack-claude daemon is running by validating its PID file.
pub fn is_claude_running() -> bool {
    let pid_path = match claude_pid_path() {
        Ok(p) => p,
        Err(_) => return false,
    };
    is_process_running(&pid_path)
}

/// Starts the sprack-claude daemon as a detached background process.
///
/// Uses the same sibling-binary resolution and setsid() daemonization as
/// `start_sprack_poll`. sprack-claude reads the shared state.db populated
/// by sprack-poll and writes Claude Code integration data.
pub fn start_sprack_claude() -> Result<()> {
    let data_dir = sprack_data_dir()?;
    fs::create_dir_all(&data_dir)?;

    let pid_path = claude_pid_path()?;

    // Remove stale PID file if it exists.
    if pid_path.exists() && !is_process_running(&pid_path) {
        let _ = fs::remove_file(&pid_path);
    }

    let claude_binary = resolve_sibling_binary("sprack-claude");

    let log_path = data_dir.join("claude.log");
    let log_file = fs::File::create(&log_path)
        .context("failed to create sprack-claude log file")?;

    let _child = unsafe {
        Command::new(&claude_binary)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::from(log_file))
            .pre_exec(|| {
                libc::setsid();
                Ok(())
            })
            .spawn()
    }
    .context("failed to spawn sprack-claude daemon")?;

    Ok(())
}

/// Returns the default DB path for existence checks.
pub fn default_db_path() -> Result<PathBuf> {
    Ok(sprack_data_dir()?.join("state.db"))
}
