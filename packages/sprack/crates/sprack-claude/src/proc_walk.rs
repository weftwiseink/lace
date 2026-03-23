//! /proc filesystem interaction for process tree walking.
//!
//! Resolves pane shell PIDs to Claude Code process PIDs by recursively
//! walking the process tree via /proc/<pid>/children and /proc/<pid>/cmdline.

use std::path::{Path, PathBuf};

/// Maximum depth for recursive process tree walk.
const MAX_RECURSION_DEPTH: u32 = 5;

/// Finds a Claude Code process PID by walking the process tree from a shell PID.
///
/// Reads /proc/<pid>/children recursively, checking each child's cmdline
/// for the string "claude". Returns the first match in depth-first order.
pub fn find_claude_pid(shell_pid: u32) -> Option<u32> {
    find_claude_pid_recursive(shell_pid, 0)
}

fn find_claude_pid_recursive(pid: u32, depth: u32) -> Option<u32> {
    if depth > MAX_RECURSION_DEPTH {
        return None;
    }

    let children_path = format!("/proc/{pid}/children");
    let children_string = std::fs::read_to_string(children_path).ok()?;

    for child_string in children_string.split_whitespace() {
        let child_pid: u32 = match child_string.parse() {
            Ok(pid) => pid,
            Err(_) => continue,
        };

        // Check if this child is a Claude process.
        let cmdline_path = format!("/proc/{child_pid}/cmdline");
        if let Ok(cmdline_bytes) = std::fs::read(&cmdline_path) {
            let cmdline = String::from_utf8_lossy(&cmdline_bytes);
            if cmdline.contains("claude") {
                return Some(child_pid);
            }
        }

        // Recurse into child's children.
        if let Some(found) = find_claude_pid_recursive(child_pid, depth + 1) {
            return Some(found);
        }
    }

    None
}

/// Reads the current working directory of a process via /proc/<pid>/cwd.
pub fn read_process_cwd(pid: u32) -> Option<PathBuf> {
    let link_path = format!("/proc/{pid}/cwd");
    std::fs::read_link(link_path).ok()
}

/// Encodes a project path by replacing all `/` with `-`.
///
/// This matches Claude Code's project directory encoding scheme.
/// For example: `/workspaces/lace/main` becomes `-workspaces-lace-main`.
pub fn encode_project_path(cwd: &Path) -> String {
    let path_string = cwd.to_string_lossy();
    path_string.replace('/', "-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_project_path() {
        let path = Path::new("/workspaces/lace/main");
        assert_eq!(encode_project_path(path), "-workspaces-lace-main");
    }

    #[test]
    fn test_encode_root_path() {
        let path = Path::new("/");
        assert_eq!(encode_project_path(path), "-");
    }

    #[test]
    fn test_encode_home_path() {
        let path = Path::new("/home/user/project");
        assert_eq!(encode_project_path(path), "-home-user-project");
    }
}
