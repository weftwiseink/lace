//! /proc filesystem interaction for process tree walking.
//!
//! Resolves pane shell PIDs to Claude Code process PIDs by recursively
//! walking the process tree via /proc/<pid>/children and /proc/<pid>/cmdline.
//!
//! The `ProcFs` trait abstracts filesystem access for testability.
//! `RealProcFs` reads the real `/proc` filesystem.
//! Tests can use `MockProcFs` to simulate arbitrary process trees.

use std::path::{Path, PathBuf};

/// Maximum depth for recursive process tree walk.
const MAX_RECURSION_DEPTH: u32 = 5;

/// Abstraction over `/proc` filesystem access.
///
/// Enables testing of process tree walking without real `/proc`.
pub trait ProcFs {
    /// Returns child PIDs of the given process.
    fn children(&self, pid: u32) -> Option<Vec<u32>>;
    /// Returns the cmdline string of the given process.
    fn cmdline(&self, pid: u32) -> Option<String>;
    /// Returns the current working directory of the given process.
    fn cwd(&self, pid: u32) -> Option<PathBuf>;
}

/// Real `/proc` filesystem implementation.
///
/// Reads process information from the Linux procfs.
pub struct RealProcFs;

impl ProcFs for RealProcFs {
    fn children(&self, pid: u32) -> Option<Vec<u32>> {
        // Primary: /proc/{pid}/children
        let children_string = std::fs::read_to_string(format!("/proc/{pid}/children"))
            .or_else(|_| {
                // Fallback: /proc/{pid}/task/{pid}/children
                // Some kernel configurations only expose children via the task subdirectory.
                std::fs::read_to_string(format!("/proc/{pid}/task/{pid}/children"))
            })
            .ok()?;

        let pids: Vec<u32> = children_string
            .split_whitespace()
            .filter_map(|s| s.parse().ok())
            .collect();
        Some(pids)
    }

    fn cmdline(&self, pid: u32) -> Option<String> {
        let cmdline_bytes = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
        Some(String::from_utf8_lossy(&cmdline_bytes).to_string())
    }

    fn cwd(&self, pid: u32) -> Option<PathBuf> {
        std::fs::read_link(format!("/proc/{pid}/cwd")).ok()
    }
}

/// Finds a process by walking the process tree from a starting PID.
///
/// Reads children recursively via the `ProcFs` implementation, checking each
/// child's cmdline against the provided matcher predicate.
/// Returns the first match in depth-first order.
pub fn find_process_pid(
    procfs: &impl ProcFs,
    shell_pid: u32,
    matcher: impl Fn(&str) -> bool,
) -> Option<u32> {
    find_process_pid_recursive(procfs, shell_pid, &matcher, 0)
}

fn find_process_pid_recursive(
    procfs: &impl ProcFs,
    pid: u32,
    matcher: &impl Fn(&str) -> bool,
    depth: u32,
) -> Option<u32> {
    if depth > MAX_RECURSION_DEPTH {
        return None;
    }

    let children = procfs.children(pid)?;

    for child_pid in children {
        if let Some(cmdline) = procfs.cmdline(child_pid) {
            if matcher(&cmdline) {
                return Some(child_pid);
            }
        }

        if let Some(found) = find_process_pid_recursive(procfs, child_pid, matcher, depth + 1) {
            return Some(found);
        }
    }

    None
}

/// Convenience wrapper: finds a Claude Code process using the real `/proc` filesystem.
pub fn find_claude_pid(shell_pid: u32) -> Option<u32> {
    find_process_pid(&RealProcFs, shell_pid, |cmdline| cmdline.contains("claude"))
}

/// Reads the current working directory of a process.
///
/// Uses the provided `ProcFs` implementation.
pub fn read_process_cwd_with(procfs: &impl ProcFs, pid: u32) -> Option<PathBuf> {
    procfs.cwd(pid)
}

/// Convenience wrapper: reads CWD via the real `/proc` filesystem.
pub fn read_process_cwd(pid: u32) -> Option<PathBuf> {
    read_process_cwd_with(&RealProcFs, pid)
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
    use std::collections::HashMap;

    /// In-memory mock of `/proc` for testing process tree walking.
    pub struct MockProcFs {
        pub processes: HashMap<u32, MockProcess>,
    }

    pub struct MockProcess {
        pub children: Vec<u32>,
        pub cmdline: String,
        pub cwd: PathBuf,
    }

    impl ProcFs for MockProcFs {
        fn children(&self, pid: u32) -> Option<Vec<u32>> {
            self.processes.get(&pid).map(|p| p.children.clone())
        }

        fn cmdline(&self, pid: u32) -> Option<String> {
            self.processes.get(&pid).map(|p| p.cmdline.clone())
        }

        fn cwd(&self, pid: u32) -> Option<PathBuf> {
            self.processes.get(&pid).map(|p| p.cwd.clone())
        }
    }

    impl MockProcFs {
        fn new() -> Self {
            Self {
                processes: HashMap::new(),
            }
        }

        fn add_process(&mut self, pid: u32, cmdline: &str, cwd: &str, children: Vec<u32>) {
            self.processes.insert(
                pid,
                MockProcess {
                    children,
                    cmdline: cmdline.to_string(),
                    cwd: PathBuf::from(cwd),
                },
            );
        }
    }

    // === Existing tests ===

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

    // === ProcFs trait smoke tests ===

    #[test]
    fn find_process_pid_finds_direct_child() {
        let mut mock = MockProcFs::new();
        mock.add_process(100, "bash", "/home", vec![200]);
        mock.add_process(200, "claude\0--session\0abc", "/workspaces/lace", vec![]);

        let result = find_process_pid(&mock, 100, |cmdline| cmdline.contains("claude"));
        assert_eq!(result, Some(200));
    }

    #[test]
    fn find_process_pid_finds_grandchild() {
        let mut mock = MockProcFs::new();
        mock.add_process(100, "bash", "/home", vec![200]);
        mock.add_process(200, "node", "/home", vec![300]);
        mock.add_process(300, "claude\0--model\0opus", "/workspaces", vec![]);

        let result = find_process_pid(&mock, 100, |cmdline| cmdline.contains("claude"));
        assert_eq!(result, Some(300));
    }

    #[test]
    fn find_process_pid_returns_none_on_no_match() {
        let mut mock = MockProcFs::new();
        mock.add_process(100, "bash", "/home", vec![200]);
        mock.add_process(200, "vim", "/home", vec![]);

        let result = find_process_pid(&mock, 100, |cmdline| cmdline.contains("claude"));
        assert_eq!(result, None);
    }

    #[test]
    fn find_process_pid_returns_none_for_unknown_pid() {
        let mock = MockProcFs::new();
        let result = find_process_pid(&mock, 999, |cmdline| cmdline.contains("claude"));
        assert_eq!(result, None);
    }

    #[test]
    fn find_process_pid_respects_custom_predicate() {
        let mut mock = MockProcFs::new();
        mock.add_process(100, "bash", "/home", vec![200, 300]);
        mock.add_process(200, "python3\0server.py", "/app", vec![]);
        mock.add_process(300, "node\0index.js", "/app", vec![]);

        let result = find_process_pid(&mock, 100, |cmdline| cmdline.contains("python"));
        assert_eq!(result, Some(200));

        let result = find_process_pid(&mock, 100, |cmdline| cmdline.contains("node"));
        assert_eq!(result, Some(300));
    }

    #[test]
    fn read_process_cwd_with_mock() {
        let mut mock = MockProcFs::new();
        mock.add_process(100, "claude", "/workspaces/lace/main", vec![]);

        let cwd = read_process_cwd_with(&mock, 100);
        assert_eq!(cwd, Some(PathBuf::from("/workspaces/lace/main")));
    }

    #[test]
    fn read_process_cwd_unknown_pid() {
        let mock = MockProcFs::new();
        let cwd = read_process_cwd_with(&mock, 999);
        assert_eq!(cwd, None);
    }
}
