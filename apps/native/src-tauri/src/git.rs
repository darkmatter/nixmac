//! Git operations for tracking configuration changes.
//!
//! Provides a minimal git interface for version control of the Nix flake.
//! This enables safe rollback and change tracking.

use crate::types::{GitFileStatus, GitStatus};
use anyhow::Result;
use std::process::Command;

/// Create a git command with proper PATH for macOS GUI apps
fn git_command() -> Command {
    let mut cmd = Command::new("git");
    cmd.env("PATH", crate::nix::get_nix_path());
    cmd
}

/// Checks if a directory is inside a git repository.
pub fn is_repo(dir: &str) -> bool {
    git_command()
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Initializes a git repository if the directory isn't already one.
/// Also creates a sensible .gitignore for Nix projects.
pub fn init_if_needed(dir: &str) -> Result<()> {
    if !is_repo(dir) {
        std::fs::create_dir_all(dir)?;
        git_command().args(["init"]).current_dir(dir).output()?;

        let gitignore_path = std::path::Path::new(dir).join(".gitignore");
        if !gitignore_path.exists() {
            std::fs::write(
                gitignore_path,
                "node_modules\nresult\nrelease\ndist\ndist-electron\n",
            )?;
        }
    }
    Ok(())
}

/// Parses `git status --porcelain=v1` output into a structured format.
///
/// The porcelain format uses a two-character status code:
/// - First char: index (staging area) status
/// - Second char: working tree status
///
/// Common codes:
/// - `??` = untracked file
/// - `A ` = added to index
/// - `M ` = modified in index
/// - ` M` = modified in working tree (not staged)
/// - `D ` = deleted from index
pub fn status(dir: &str) -> Result<GitStatus> {
    let output = git_command()
        .args(["status", "--porcelain=v1", "-b"])
        .current_dir(dir)
        .output()?;

    let status_str = String::from_utf8_lossy(&output.stdout);

    let mut files = Vec::new();
    let mut created = Vec::new();
    let mut deleted = Vec::new();
    let mut modified = Vec::new();
    let mut staged = Vec::new();
    let mut not_added = Vec::new();
    let mut conflicted = Vec::new();
    let mut current = None;
    let tracking = None;

    for line in status_str.lines() {
        // Branch info line starts with "##"
        if line.starts_with("##") {
            let branch_info = line.trim_start_matches("##").trim();
            if let Some(branch_name) = branch_info.split("...").next() {
                current = Some(branch_name.trim().to_string());
            }
            continue;
        }

        // Skip malformed lines (need at least "XY path")
        if line.len() < 3 {
            continue;
        }

        let index_status = line.chars().next().map(|c| c.to_string());
        let working_tree_status = line.chars().nth(1).map(|c| c.to_string());
        let path = line[3..].to_string();

        files.push(GitFileStatus {
            path: path.clone(),
            index: index_status.clone(),
            working_tree: working_tree_status.clone(),
        });

        // Categorize files by their status
        match (index_status.as_deref(), working_tree_status.as_deref()) {
            (Some("A"), _) => {
                created.push(path.clone());
                staged.push(path.clone());
            }
            (Some("D"), _) => {
                deleted.push(path.clone());
                staged.push(path.clone());
            }
            (Some("M"), _) => {
                modified.push(path.clone());
                staged.push(path.clone());
            }
            (Some("?"), Some("?")) => {
                not_added.push(path.clone());
            }
            (Some("U"), _) | (_, Some("U")) => {
                conflicted.push(path.clone());
            }
            _ => {}
        }
    }

    let has_changes = !files.is_empty();

    // Compute derived state
    let has_unstaged_changes = files
        .iter()
        .any(|f| f.working_tree.as_ref().map_or(false, |wt| wt != " "));

    let cleanly_staged_count = files
        .iter()
        .filter(|f| {
            f.index
                .as_ref()
                .map_or(false, |idx| idx != " " && idx != "?")
                && f.working_tree.as_ref().map_or(true, |wt| wt == " ")
        })
        .count();

    let all_changes_staged = has_changes && !has_unstaged_changes;
    let all_changes_cleanly_staged =
        has_changes && cleanly_staged_count == files.len() && !staged.is_empty();

    Ok(GitStatus {
        files,
        created,
        deleted,
        modified,
        staged,
        not_added,
        conflicted,
        ahead: 0,
        behind: 0,
        current,
        tracking,
        has_changes,
        has_unstaged_changes,
        all_changes_staged,
        all_changes_cleanly_staged,
    })
}

/// Fast check for any changes using git diff-index.
/// This is more efficient than `status()` as it uses file stat metadata
/// rather than parsing full status output.
///
/// Returns true if there are any uncommitted changes (staged or unstaged).
/// Also detects untracked files.
pub fn has_changes_fast(dir: &str) -> bool {
    // If repo has no commits yet, diff-index against HEAD will fail.
    // Fall back to a cheap porcelain status check in that case.
    let has_head = git_command()
        .args(["rev-parse", "--verify", "HEAD"])
        .current_dir(dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !has_head {
        return git_command()
            .args(["status", "--porcelain=v1"])
            .current_dir(dir)
            .output()
            .map(|o| !o.stdout.is_empty())
            .unwrap_or(false);
    }

    // Check for staged/unstaged changes against HEAD
    let has_tracked_changes = git_command()
        .args(["diff-index", "--quiet", "HEAD", "--"])
        .current_dir(dir)
        .output()
        .map(|o| !o.status.success()) // exit code 1 means changes exist
        .unwrap_or(false);

    if has_tracked_changes {
        return true;
    }

    // Also check for untracked files (diff-index doesn't catch these)
    let has_untracked = git_command()
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(dir)
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);

    has_untracked
}

/// Stages all changes (git add -A).
pub fn stage_all(dir: &str) -> Result<()> {
    git_command()
        .args(["add", "-A"])
        .current_dir(dir)
        .output()?;
    Ok(())
}

/// Stages all changes and commits with the given message.
pub fn commit_all(dir: &str, message: &str) -> Result<()> {
    git_command()
        .args(["add", "-A"])
        .current_dir(dir)
        .output()?;

    git_command()
        .args(["commit", "-m", message])
        .current_dir(dir)
        .output()?;

    Ok(())
}

/// Stages all changes and commits with the given message.
pub fn stash(dir: &str, message: &str) -> Result<()> {
    git_command()
        .args(["add", "-A"])
        .current_dir(dir)
        .output()?;

    git_command()
        .args(["stash", "push", "-m", message])
        .current_dir(dir)
        .output()?;

    Ok(())
}

/// Discards all uncommitted changes (both staged and unstaged).
/// This restores tracked files to HEAD and removes untracked files.
pub fn restore_all(dir: &str) -> Result<()> {
    // Reset staged changes
    git_command()
        .args(["reset", "HEAD", "--"])
        .current_dir(dir)
        .output()?;

    // Discard changes to tracked files
    git_command()
        .args(["checkout", "--", "."])
        .current_dir(dir)
        .output()?;

    // Remove untracked files and directories
    git_command()
        .args(["clean", "-fd"])
        .current_dir(dir)
        .output()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // mk temp repo
    #[test]
    fn test_init_if_needed() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        init_if_needed(&repo_dir.to_string_lossy()).unwrap();
        assert!(is_repo(&repo_dir.to_string_lossy()));
    }

    #[test]
    fn test_status() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        init_if_needed(&repo_dir.to_string_lossy()).unwrap();
        fs::write(repo_dir.join("file.txt"), "hello").unwrap();
        let status = status(&repo_dir.to_string_lossy()).unwrap();
        assert!(status.has_changes);
        assert!(status.created.is_empty());
        assert!(status.deleted.is_empty());
        assert!(status.modified.is_empty());
        assert!(status.staged.is_empty());
        assert!(status.not_added.is_empty());
        assert!(status.conflicted.is_empty());
        assert!(status.current.is_some());
        assert!(status.tracking.is_some());
    }
}
