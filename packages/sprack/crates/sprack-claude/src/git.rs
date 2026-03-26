//! Git state resolution for Claude Code working directories.
//!
//! Reads `.git/HEAD` and ref files directly to extract branch name and
//! short commit hash without spawning `git` subprocesses in the common case.
//! Falls back to `git rev-parse --short HEAD` when the loose ref file is
//! absent (packed refs).

use std::path::{Path, PathBuf};

/// Resolves the `.git` directory for a working directory.
///
/// Handles three cases:
/// 1. Normal repo: `cwd/.git` is a directory, returned directly.
/// 2. Worktree/bare repo: `cwd/.git` is a file containing `gitdir: <path>`.
///    Follows the indirection and returns the resolved path.
/// 3. Not a git repo: returns `None`.
///
/// Walks up parent directories to find the git root, matching git's own behavior.
pub fn resolve_git_dir(cwd: &Path) -> Option<PathBuf> {
    let mut current = cwd.to_path_buf();
    loop {
        let dot_git = current.join(".git");
        if dot_git.is_dir() {
            return Some(dot_git);
        }
        if dot_git.is_file() {
            // Worktree or submodule: `.git` file contains `gitdir: <path>`.
            let content = std::fs::read_to_string(&dot_git).ok()?;
            let gitdir_line = content.trim();
            let path_str = gitdir_line.strip_prefix("gitdir: ")?;
            let gitdir_path = if Path::new(path_str).is_absolute() {
                PathBuf::from(path_str)
            } else {
                current.join(path_str)
            };
            // Canonicalize to resolve any `..` components.
            return std::fs::canonicalize(&gitdir_path).ok();
        }
        if !current.pop() {
            return None;
        }
    }
}

/// Reads the current branch name from a git directory's HEAD file.
///
/// Returns the branch name (e.g., "main", "feat/inline-summaries") when HEAD
/// points to a symbolic ref. Returns `"HEAD"` when HEAD is detached (contains
/// a raw SHA).
pub fn read_git_branch(git_dir: &Path) -> Option<String> {
    let head_path = git_dir.join("HEAD");
    let content = std::fs::read_to_string(&head_path).ok()?;
    let trimmed = content.trim();

    if let Some(ref_path) = trimmed.strip_prefix("ref: refs/heads/") {
        Some(ref_path.to_string())
    } else if trimmed.len() >= 7 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        // Detached HEAD: raw SHA.
        Some("HEAD".to_string())
    } else {
        None
    }
}

/// Reads the short commit hash for a branch from the git directory.
///
/// Tries the loose ref file first (`.git/refs/heads/{branch}`), which avoids
/// subprocess overhead. Falls back to `git rev-parse --short HEAD` when the
/// loose ref is absent (packed refs after `git gc`).
pub fn read_commit_short(git_dir: &Path, branch: &str) -> Option<String> {
    // For detached HEAD, read the SHA directly from HEAD file.
    if branch == "HEAD" {
        let head_path = git_dir.join("HEAD");
        let content = std::fs::read_to_string(&head_path).ok()?;
        let trimmed = content.trim();
        if trimmed.len() >= 7 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(trimmed[..7].to_string());
        }
        return None;
    }

    // Try loose ref file first.
    let ref_path = git_dir.join("refs/heads").join(branch);
    if let Ok(content) = std::fs::read_to_string(&ref_path) {
        let sha = content.trim();
        if sha.len() >= 7 {
            return Some(sha[..7].to_string());
        }
    }

    // Fallback: parse packed-refs file.
    let packed_refs_path = git_dir.join("packed-refs");
    if let Ok(content) = std::fs::read_to_string(&packed_refs_path) {
        let target_ref = format!("refs/heads/{branch}");
        for line in content.lines() {
            let line = line.trim();
            if line.starts_with('#') || line.starts_with('^') {
                continue;
            }
            // Format: "<sha> <ref>"
            if let Some((sha, ref_name)) = line.split_once(' ') {
                if ref_name == target_ref && sha.len() >= 7 {
                    return Some(sha[..7].to_string());
                }
            }
        }
    }

    // Final fallback: subprocess.
    let work_dir = find_working_dir(git_dir)?;
    let output = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(&work_dir)
        .output()
        .ok()?;
    if output.status.success() {
        let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !sha.is_empty() {
            return Some(sha);
        }
    }
    None
}

/// Attempts to find a working directory from a git dir for subprocess fallback.
///
/// For a normal `.git` directory, the working dir is the parent.
/// For a worktree gitdir (e.g., `.git/worktrees/name`), reads the `gitdir` file.
fn find_working_dir(git_dir: &Path) -> Option<PathBuf> {
    // Normal repo: git_dir is `<workdir>/.git`.
    let parent = git_dir.parent()?;
    if parent.join(".git").is_dir() && parent.join(".git") == *git_dir {
        return Some(parent.to_path_buf());
    }
    // Worktree gitdir: contains a `gitdir` file pointing back to the worktree.
    let gitdir_file = git_dir.join("gitdir");
    if let Ok(content) = std::fs::read_to_string(&gitdir_file) {
        let worktree_dot_git = PathBuf::from(content.trim());
        if let Some(worktree_dir) = worktree_dot_git.parent() {
            if worktree_dir.exists() {
                return Some(worktree_dir.to_path_buf());
            }
        }
    }
    // Fallback: just use the git_dir parent.
    Some(parent.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a mock normal git repo: `dir/.git/HEAD` with a branch ref.
    fn create_mock_repo(dir: &Path, branch: &str, sha: &str) {
        let git_dir = dir.join(".git");
        std::fs::create_dir_all(git_dir.join("refs/heads")).unwrap();
        std::fs::write(
            git_dir.join("HEAD"),
            format!("ref: refs/heads/{branch}\n"),
        )
        .unwrap();
        // Write loose ref.
        // Handle branch names with slashes by creating parent dirs.
        let ref_path = git_dir.join("refs/heads").join(branch);
        if let Some(parent) = ref_path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&ref_path, format!("{sha}\n")).unwrap();
    }

    /// Creates a mock bare repo with a linked worktree.
    fn create_mock_worktree(
        bare_dir: &Path,
        worktree_dir: &Path,
        worktree_name: &str,
        branch: &str,
        sha: &str,
    ) {
        // Set up the bare repo side: worktrees/<name>/HEAD.
        let wt_gitdir = bare_dir.join("worktrees").join(worktree_name);
        std::fs::create_dir_all(&wt_gitdir).unwrap();
        std::fs::write(
            wt_gitdir.join("HEAD"),
            format!("ref: refs/heads/{branch}\n"),
        )
        .unwrap();
        // Write the gitdir file pointing back to the worktree's .git file.
        std::fs::write(
            wt_gitdir.join("gitdir"),
            worktree_dir.join(".git").to_str().unwrap(),
        )
        .unwrap();

        // Set up the worktree side: .git file pointing to the bare repo worktree dir.
        std::fs::create_dir_all(worktree_dir).unwrap();
        std::fs::write(
            worktree_dir.join(".git"),
            format!("gitdir: {}", wt_gitdir.to_str().unwrap()),
        )
        .unwrap();

        // Write loose ref in the bare repo.
        let ref_path = bare_dir.join("refs/heads").join(branch);
        if let Some(parent) = ref_path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&ref_path, format!("{sha}\n")).unwrap();
    }

    #[test]
    fn resolve_git_dir_normal_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let repo_dir = tmp.path().join("my-project");
        create_mock_repo(&repo_dir, "main", "abcdef1234567890abcdef1234567890abcdef12");

        let result = resolve_git_dir(&repo_dir);
        assert_eq!(result, Some(repo_dir.join(".git")));
    }

    #[test]
    fn resolve_git_dir_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let bare_dir = tmp.path().join("bare.git");
        let worktree_dir = tmp.path().join("my-worktree");
        std::fs::create_dir_all(&bare_dir).unwrap();

        create_mock_worktree(
            &bare_dir,
            &worktree_dir,
            "my-worktree",
            "feat/branch",
            "abcdef1234567890abcdef1234567890abcdef12",
        );

        let result = resolve_git_dir(&worktree_dir);
        assert!(result.is_some());
        let resolved = result.unwrap();
        // Should resolve to the bare repo's worktrees/<name> directory.
        assert!(resolved.to_str().unwrap().contains("worktrees/my-worktree"));
    }

    #[test]
    fn resolve_git_dir_not_a_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let result = resolve_git_dir(tmp.path());
        assert!(result.is_none());
    }

    #[test]
    fn resolve_git_dir_walks_up_parents() {
        let tmp = tempfile::tempdir().unwrap();
        let repo_dir = tmp.path().join("project");
        create_mock_repo(&repo_dir, "main", "abcdef1234567890abcdef1234567890abcdef12");

        let sub_dir = repo_dir.join("src").join("lib");
        std::fs::create_dir_all(&sub_dir).unwrap();

        let result = resolve_git_dir(&sub_dir);
        assert_eq!(result, Some(repo_dir.join(".git")));
    }

    #[test]
    fn read_git_branch_normal() {
        let tmp = tempfile::tempdir().unwrap();
        let repo_dir = tmp.path().join("project");
        create_mock_repo(&repo_dir, "main", "abcdef1234567890abcdef1234567890abcdef12");

        let git_dir = repo_dir.join(".git");
        let branch = read_git_branch(&git_dir);
        assert_eq!(branch, Some("main".to_string()));
    }

    #[test]
    fn read_git_branch_with_slashes() {
        let tmp = tempfile::tempdir().unwrap();
        let repo_dir = tmp.path().join("project");
        create_mock_repo(
            &repo_dir,
            "feat/inline-summaries",
            "abcdef1234567890abcdef1234567890abcdef12",
        );

        let git_dir = repo_dir.join(".git");
        let branch = read_git_branch(&git_dir);
        assert_eq!(branch, Some("feat/inline-summaries".to_string()));
    }

    #[test]
    fn read_git_branch_detached_head() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(
            git_dir.join("HEAD"),
            "abcdef1234567890abcdef1234567890abcdef12\n",
        )
        .unwrap();

        let branch = read_git_branch(&git_dir);
        assert_eq!(branch, Some("HEAD".to_string()));
    }

    #[test]
    fn read_git_branch_nonexistent() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        let branch = read_git_branch(&git_dir);
        assert!(branch.is_none());
    }

    #[test]
    fn read_commit_short_loose_ref() {
        let tmp = tempfile::tempdir().unwrap();
        let repo_dir = tmp.path().join("project");
        create_mock_repo(
            &repo_dir,
            "main",
            "abcdef1234567890abcdef1234567890abcdef12",
        );

        let git_dir = repo_dir.join(".git");
        let commit = read_commit_short(&git_dir, "main");
        assert_eq!(commit, Some("abcdef1".to_string()));
    }

    #[test]
    fn read_commit_short_slashed_branch() {
        let tmp = tempfile::tempdir().unwrap();
        let repo_dir = tmp.path().join("project");
        create_mock_repo(
            &repo_dir,
            "feat/inline-summaries",
            "1234567890abcdef1234567890abcdef1234567890",
        );

        let git_dir = repo_dir.join(".git");
        let commit = read_commit_short(&git_dir, "feat/inline-summaries");
        assert_eq!(commit, Some("1234567".to_string()));
    }

    #[test]
    fn read_commit_short_detached_head() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(
            git_dir.join("HEAD"),
            "abcdef1234567890abcdef1234567890abcdef12\n",
        )
        .unwrap();

        let commit = read_commit_short(&git_dir, "HEAD");
        assert_eq!(commit, Some("abcdef1".to_string()));
    }

    #[test]
    fn read_commit_short_packed_refs() {
        let tmp = tempfile::tempdir().unwrap();
        let repo_dir = tmp.path().join("project");
        let git_dir = repo_dir.join(".git");
        std::fs::create_dir_all(git_dir.join("refs/heads")).unwrap();
        std::fs::write(
            git_dir.join("HEAD"),
            "ref: refs/heads/main\n",
        )
        .unwrap();

        // No loose ref file, but packed-refs contains the ref.
        let packed_content = "# pack-refs with: peeled fully-peeled sorted\n\
            abcdef1234567890abcdef1234567890abcdef12 refs/heads/main\n\
            1111111234567890abcdef1234567890abcdef12 refs/heads/other\n";
        std::fs::write(git_dir.join("packed-refs"), packed_content).unwrap();

        let commit = read_commit_short(&git_dir, "main");
        assert_eq!(commit, Some("abcdef1".to_string()));
    }

    #[test]
    fn read_commit_short_no_ref_at_all() {
        let tmp = tempfile::tempdir().unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(git_dir.join("refs/heads")).unwrap();
        std::fs::write(
            git_dir.join("HEAD"),
            "ref: refs/heads/main\n",
        )
        .unwrap();

        // No loose ref, no packed-refs, no git subprocess available.
        // This should return None (or fall through to subprocess which also fails).
        let commit = read_commit_short(&git_dir, "main");
        // In test env, git subprocess may or may not work. Either None or a valid short hash.
        // We primarily test that it doesn't panic.
        assert!(commit.is_none() || commit.as_ref().unwrap().len() >= 7);
    }
}
