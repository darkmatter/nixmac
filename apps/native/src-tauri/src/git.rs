//! Git operations for tracking configuration changes.
//!
//! Provides a minimal git interface for version control of the Nix flake.
//! This enables safe rollback and change tracking.

use crate::types::{GitFileStatus, GitStatus};
use anyhow::Result;
use std::process::Command;
use tauri::AppHandle;

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

/// Gets the default branch name (main or master), if it exists.
fn get_default_branch(dir: &str) -> Option<&'static str> {
    if git_command()
        .args(["rev-parse", "--verify", "main"])
        .current_dir(dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        Some("main")
    } else if git_command()
        .args(["rev-parse", "--verify", "master"])
        .current_dir(dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        Some("master")
    } else {
        None
    }
}

/// Gets the full diff against main/master branch, including tracked changes and untracked file contents.
/// This shows all changes since diverging from the default branch, which is used for AI summaries.
/// Falls back to HEAD if neither main nor master exist.
/// Untracked files are formatted as diffs showing the entire file as added.
pub fn get_full_diff(dir: &str) -> Result<String> {
    let base = get_default_branch(dir).unwrap_or("HEAD");

    // Get git diff for tracked files
    let diff_output = git_command()
        .args(["diff", base])
        .current_dir(dir)
        .output()?;

    let mut diff = String::from_utf8_lossy(&diff_output.stdout).to_string();

    // Also get untracked files and show their contents as diffs
    let untracked_output = git_command()
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(dir)
        .output()?;

    let untracked_files = String::from_utf8_lossy(&untracked_output.stdout);

    for file in untracked_files.lines() {
        if file.is_empty() {
            continue;
        }
        let file_path = std::path::Path::new(dir).join(file);
        if let Ok(contents) = std::fs::read_to_string(&file_path) {
            // Format as a diff showing the entire file as added
            diff.push_str(&format!("\ndiff --git a/{} b/{}\n", file, file));
            diff.push_str("new file mode 100644\n");
            diff.push_str("--- /dev/null\n");
            diff.push_str(&format!("+++ b/{}\n", file));
            let line_count = contents.lines().count();
            diff.push_str(&format!("@@ -0,0 +1,{} @@\n", line_count));
            for line in contents.lines() {
                diff.push_str(&format!("+{}\n", line));
            }
        }
    }

    Ok(diff)
}

/// Gets a diff containing only .nix files (including untracked .nix files).
pub fn get_nix_diff(dir: &str) -> Result<String> {
    let base = get_default_branch(dir).unwrap_or("HEAD");

    let diff_output = git_command()
        .args(["diff", base, "--", "*.nix"])
        .current_dir(dir)
        .output()?;

    let mut diff = String::from_utf8_lossy(&diff_output.stdout).to_string();

    let untracked_output = git_command()
        .args(["ls-files", "--others", "--exclude-standard", "--", "*.nix"])
        .current_dir(dir)
        .output()?;

    let untracked_files = String::from_utf8_lossy(&untracked_output.stdout);

    for file in untracked_files.lines() {
        if file.is_empty() {
            continue;
        }
        let file_path = std::path::Path::new(dir).join(file);
        if let Ok(contents) = std::fs::read_to_string(&file_path) {
            diff.push_str(&format!("\ndiff --git a/{} b/{}\n", file, file));
            diff.push_str("new file mode 100644\n");
            diff.push_str("--- /dev/null\n");
            diff.push_str(&format!("+++ b/{}\n", file));
            let line_count = contents.lines().count();
            diff.push_str(&format!("@@ -0,0 +1,{} @@\n", line_count));
            for line in contents.lines() {
                diff.push_str(&format!("+{}\n", line));
            }
        }
    }

    Ok(diff)
}

/// Counts additions and deletions from a diff string.
pub fn count_diff_changes(diff: &str) -> (usize, usize) {
    let mut additions = 0;
    let mut deletions = 0;

    for line in diff.lines() {
        // Skip diff headers (--- and +++)
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        // Count added lines
        if line.starts_with('+') {
            additions += 1;
        }
        // Count deleted lines
        else if line.starts_with('-') {
            deletions += 1;
        }
    }

    (additions, deletions)
}

/// Parses file information from diff output.
/// Extracts file paths and change types from diff headers.
/// Uses the same pattern as diff.tsx: `diff --git a/<path> b/<path>`
fn parse_files_from_diff(diff: &str) -> Vec<GitFileStatus> {
    let mut files = Vec::new();
    let mut current_file: Option<String> = None;
    let mut current_change_type = "edited";

    for line in diff.lines() {
        // Match "diff --git a/path b/path" - same pattern as diff.tsx
        if line.starts_with("diff --git a/") {
            // Save previous file if any
            if let Some(path) = current_file.take() {
                files.push(GitFileStatus {
                    path,
                    change_type: current_change_type.to_string(),
                });
            }

            // Extract path from "diff --git a/path b/path"
            // Find " b/" and take everything after it (matching diff.tsx regex group 2)
            if let Some(b_index) = line.find(" b/") {
                let path = &line[b_index + 3..]; // Skip " b/"
                current_file = Some(path.to_string());
                current_change_type = "edited"; // Default, may be overridden
            }
        }
        // Detect change type from subsequent lines
        else if line.starts_with("new file mode") {
            current_change_type = "new";
        } else if line.starts_with("deleted file mode") {
            current_change_type = "removed";
        } else if line.starts_with("rename from") {
            current_change_type = "renamed";
        }
    }

    // Don't forget the last file
    if let Some(path) = current_file {
        files.push(GitFileStatus {
            path,
            change_type: current_change_type.to_string(),
        });
    }

    files
}

/// Gets commit messages on the current branch since diverging from main.
/// Returns commits in reverse chronological order (newest first).
fn get_commit_messages_since_main(dir: &str) -> Vec<String> {
    let Some(base) = get_default_branch(dir) else {
        return vec![];
    };

    let range = format!("{}..HEAD", base);
    let output = git_command()
        .args(["log", &range, "--pretty=format:%s"])
        .current_dir(dir)
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout
                .lines()
                .filter(|line| !line.is_empty())
                .map(String::from)
                .collect()
        }
        _ => vec![],
    }
}

/// Gets the SHA of the commit with the nixmac-last-build tag.
/// Returns None if the tag doesn't exist.
pub fn get_last_built_commit_sha(dir: &str) -> Option<String> {
    let output = git_command()
        .args(["rev-parse", "--verify", "refs/tags/nixmac-last-build"])
        .current_dir(dir)
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Gets the SHA of the current HEAD commit.
fn get_head_sha(dir: &str) -> Option<String> {
    let output = git_command()
        .args(["rev-parse", "HEAD"])
        .current_dir(dir)
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Checks if HEAD has the nixmac-last-build tag.
/// Returns true if HEAD is the most recently built commit.
pub fn head_is_built(dir: &str) -> bool {
    let Some(built_sha) = get_last_built_commit_sha(dir) else {
        return false;
    };
    let Some(head_sha) = get_head_sha(dir) else {
        return false;
    };
    built_sha == head_sha
}

/// Checks if the built commit is on the current branch (is an ancestor of HEAD).
fn built_commit_on_branch(dir: &str, built_sha: &str) -> bool {
    git_command()
        .args(["merge-base", "--is-ancestor", built_sha, "HEAD"])
        .current_dir(dir)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Returns the current branch name.
fn get_current_branch(dir: &str) -> Option<String> {
    let output = git_command()
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(dir)
        .output()
        .ok()?;

    if output.status.success() {
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if branch != "HEAD" {
            Some(branch)
        } else {
            None
        }
    } else {
        None
    }
}

/// Gets comprehensive git status by parsing the diff against main/master.
pub fn status(dir: &str) -> Result<GitStatus> {
    // Get current branch
    let branch = get_current_branch(dir);

    // Check if on main or master branch
    let is_main_branch = branch
        .as_ref()
        .map(|b| b == "main" || b == "master")
        .unwrap_or(false);

    // Compute diff and stats
    let diff = get_full_diff(dir).unwrap_or_default();
    let (additions, deletions) = count_diff_changes(&diff);

    // Parse files from diff
    let files = parse_files_from_diff(&diff);

    // Check if HEAD has the nixmac-built tag
    let head_is_built = head_is_built(dir);

    // Get the last built commit SHA and check if it's on current branch
    let last_built_commit_sha = get_last_built_commit_sha(dir);
    let branch_has_built_commit = last_built_commit_sha
        .as_ref()
        .map(|sha| built_commit_on_branch(dir, sha))
        .unwrap_or(false);

    // Get commit messages since main (only if not on main branch)
    let branch_commit_messages = if is_main_branch {
        vec![]
    } else {
        get_commit_messages_since_main(dir)
    };

    Ok(GitStatus {
        files,
        branch,
        branch_commit_messages,
        head_is_built,
        is_main_branch,
        branch_has_built_commit,
        diff,
        additions,
        deletions,
    })
}

/// Caches status before returning it,
pub fn status_and_cache<R: tauri::Runtime>(dir: &str, app: &AppHandle<R>) -> Result<GitStatus> {
    let status = status(dir)?;
    cache_status(app, &status)?;
    Ok(status)
}

/// Caches a git status for later comparison.
pub fn cache_status<R: tauri::Runtime>(app: &AppHandle<R>, status: &GitStatus) -> Result<()> {
    crate::store::set_cached_git_status(app, status)
}

/// Cached git status (currently used only to check summary stale on widget mount)
pub fn cached<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Option<GitStatus>> {
    crate::store::get_cached_git_status(app)
}

/// Stages all changes (git add -A).
pub fn stage_all(dir: &str) -> Result<()> {
    git_command()
        .args(["add", "-A"])
        .current_dir(dir)
        .output()?;
    Ok(())
}

/// Unstages all staged changes (git reset HEAD).
/// This keeps the working directory changes but removes them from the index.
pub fn unstage_all(dir: &str) -> Result<()> {
    git_command()
        .args(["reset", "HEAD", "--"])
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

/// Creates and checks out a new branch.
/// If the branch already exists, appends -v2, -v3, etc. until a unique name is found.
/// Returns the branch name that was created.
pub fn checkout_new_branch(dir: &str, branch_name: &str) -> Result<String> {
    for version in 1..=100 {
        let name = if version == 1 {
            branch_name.to_string()
        } else {
            format!("{}-v{}", branch_name, version)
        };

        let output = git_command()
            .args(["checkout", "-b", &name])
            .current_dir(dir)
            .output()?;

        if output.status.success() {
            return Ok(name);
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("already exists") {
            anyhow::bail!("Failed to create branch: {}", stderr);
        }
    }

    anyhow::bail!("Too many versions of branch {}", branch_name)
}

/// Checks out an existing branch.
pub fn checkout_branch(dir: &str, branch_name: &str) -> Result<()> {
    let output = git_command()
        .args(["checkout", branch_name])
        .current_dir(dir)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("Failed to checkout branch: {}", stderr);
    }

    Ok(())
}

/// Checks out the main branch (tries main, falls back to master).
pub fn checkout_main_branch(dir: &str) -> Result<()> {
    let Some(branch) = get_default_branch(dir) else {
        anyhow::bail!("No main or master branch found");
    };
    checkout_branch(dir, branch)
}

/// Adds build tags to HEAD:
/// - `nixmac-built-<timestamp>` - permanent tag for build history
/// - `nixmac-last-build` - moving tag that always points to latest build
pub fn tag_as_built(dir: &str) -> Result<()> {
    // Create timestamped tag for history (e.g., nixmac-built-1708123456)
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let timestamped_tag = format!("nixmac-built-{}", timestamp);

    let output = git_command()
        .args(["tag", &timestamped_tag, "HEAD"])
        .current_dir(dir)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("Failed to create timestamped tag: {}", stderr);
    }

    // Create/move the "last build" tag for easy checking
    let output = git_command()
        .args(["tag", "-f", "nixmac-last-build", "HEAD"])
        .current_dir(dir)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("Failed to update last-build tag: {}", stderr);
    }

    Ok(())
}

/// Finalizes an evolve by merging the branch to main.
/// If squash is true, squashes all commits into one with the provided message.
pub fn finalize_evolve(
    dir: &str,
    branch_name: &str,
    squash: bool,
    commit_message: Option<&str>,
) -> Result<()> {
    // If squashing, reset soft to main and create a new commit on the branch
    if squash {
        let output = git_command()
            .args(["reset", "--soft", "main"])
            .current_dir(dir)
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to reset to main: {}", stderr);
        }

        let msg = commit_message.unwrap_or("chore: squash evolve commits");
        let output = git_command()
            .args(["commit", "-m", msg])
            .current_dir(dir)
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to create squash commit: {}", stderr);
        }
    }

    // 1. Checkout main
    let output = git_command()
        .args(["checkout", "main"])
        .current_dir(dir)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("Failed to checkout main: {}", stderr);
    }

    // 2. Merge the evolve branch (fast-forward if squashed)
    let output = git_command()
        .args(["merge", branch_name])
        .current_dir(dir)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);

        // Abort the failed merge to clean up
        let _ = git_command()
            .args(["merge", "--abort"])
            .current_dir(dir)
            .output();

        // Checkout the branch again so user stays on their working branch
        let _ = git_command()
            .args(["checkout", branch_name])
            .current_dir(dir)
            .output();

        // Provide helpful error message suggesting squash for conflicts
        anyhow::bail!(
            "Merge conflict detected. Try 'Squash' to succesfully merge your changes . Details: {}",
            stderr
        );
    }

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
        // New file should appear in diff and files list
        assert!(!status.diff.is_empty());
        assert!(!status.files.is_empty());
        assert!(status.branch.is_some());
    }

    #[test]
    fn test_parse_files_from_diff() {
        let diff = r#"diff --git a/new-file.txt b/new-file.txt
new file mode 100644
--- /dev/null
+++ b/new-file.txt
@@ -0,0 +1 @@
+hello
diff --git a/existing.txt b/existing.txt
--- a/existing.txt
+++ b/existing.txt
@@ -1 +1 @@
-old
+new
diff --git a/removed.txt b/removed.txt
deleted file mode 100644
--- a/removed.txt
+++ /dev/null
@@ -1 +0,0 @@
-goodbye"#;

        let files = parse_files_from_diff(diff);
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].path, "new-file.txt");
        assert_eq!(files[0].change_type, "new");
        assert_eq!(files[1].path, "existing.txt");
        assert_eq!(files[1].change_type, "edited");
        assert_eq!(files[2].path, "removed.txt");
        assert_eq!(files[2].change_type, "removed");
    }
}
