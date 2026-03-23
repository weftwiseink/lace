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
pub fn start_sprack_poll() -> Result<()> {
    let data_dir = sprack_data_dir()?;
    fs::create_dir_all(&data_dir)?;

    let pid_path = poll_pid_path()?;

    // Remove stale PID file if it exists.
    if pid_path.exists() && !is_process_running(&pid_path) {
        let _ = fs::remove_file(&pid_path);
    }

    // Spawn sprack-poll as a detached daemon.
    let child = unsafe {
        Command::new("sprack-poll")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .pre_exec(|| {
                libc::setsid();
                Ok(())
            })
            .spawn()
    }
    .context("failed to spawn sprack-poll daemon")?;

    fs::write(&pid_path, child.id().to_string())?;
    Ok(())
}

/// Returns the default DB path for existence checks.
pub fn default_db_path() -> Result<PathBuf> {
    Ok(sprack_data_dir()?.join("state.db"))
}
