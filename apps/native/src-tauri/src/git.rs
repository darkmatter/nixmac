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

/// Probes in order: local main, local master, then remote HEAD as a last resort
pub fn get_default_branch(dir: &str) -> Option<String> {
    if git_command()
        .args(["rev-parse", "--verify", "main"])
        .current_dir(dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Some("main".to_string());
    }
    if git_command()
        .args(["rev-parse", "--verify", "master"])
        .current_dir(dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Some("master".to_string());
    }
    // Only reached if neither main nor master exist locally.
    if let Ok(output) = git_command()
        .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
        .current_dir(dir)
        .output()
    {
        if output.status.success() {
            let refname = String::from_utf8_lossy(&output.stdout);
            if let Some(branch) = refname.trim().strip_prefix("refs/remotes/origin/") {
                return Some(branch.to_string());
            }
        }
    }
    None
}

/// For write operations that MUST act on the default branch.
fn require_default_branch(dir: &str) -> Result<String> {
    get_default_branch(dir).ok_or_else(|| {
        anyhow::anyhow!(
            "No default branch (main or master) found in this repository. \
             Ensure the repository has at least one commit on a main or master branch, \
             or that a remote is configured with a default branch."
        )
    })
}

/// Gets the full diff against main/master branch, including tracked changes and untracked file contents.
/// This shows all changes since diverging from the default branch, which is used for AI summaries.
/// Falls back to HEAD if neither main nor master exist.
/// Untracked files are formatted as diffs showing the entire file as added.
pub fn get_full_diff(dir: &str) -> Result<String> {
    let base = get_default_branch(dir).unwrap_or_else(|| "HEAD".to_string());

    // Get git diff for tracked files
    let diff_output = git_command()
        .args(["diff", &base])
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

/// Gets the diff of uncommitted changes against HEAD (staged + unstaged + untracked).
pub fn get_head_diff(dir: &str) -> Result<String> {
    // Get diff for tracked files (both staged and unstaged)
    let diff_output = git_command()
        .args(["diff", "HEAD"])
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
    let base = get_default_branch(dir).unwrap_or_else(|| "HEAD".to_string());

    let diff_output = git_command()
        .args(["diff", &base, "--", "*.nix"])
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
pub fn parse_files_from_diff(diff: &str) -> Vec<GitFileStatus> {
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

/// Returns true if `built_sha` appears in the commits between main and HEAD.
/// Walks HEAD backwards and stops at main's tip, so only branch-exclusive
/// commits are considered. A commit shared with main does not count.
fn built_sha_on_branch_since_main(dir: &str, built_sha: &str) -> bool {
    let Some(main_ref) = get_default_branch(dir) else {
        return false;
    };
    let range = format!("{}..HEAD", main_ref);
    let Ok(output) = git_command()
        .args(["log", &range, "--format=%H"])
        .current_dir(dir)
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|hash| hash.trim() == built_sha)
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

    // Check if on the default branch
    let default_branch = get_default_branch(dir);
    let is_main_branch = branch
        .as_ref()
        .zip(default_branch.as_ref())
        .map(|(b, d)| b == d)
        .unwrap_or(false);

    // Compute diff and stats
    let diff = get_full_diff(dir).unwrap_or_default();
    let (additions, deletions) = count_diff_changes(&diff);

    // Parse files from diff
    let files = parse_files_from_diff(&diff);

    // Check if HEAD has the nixmac-built tag
    let head_is_built = head_is_built(dir);

    // Get the last built commit SHA and check if it appears in the commits
    // exclusive to this branch (between main and HEAD).
    let last_built_commit_sha = get_last_built_commit_sha(dir);
    let branch_has_built_commit = last_built_commit_sha
        .as_ref()
        .map(|sha| built_sha_on_branch_since_main(dir, sha))
        .unwrap_or(false);

    // Get commit messages since main (only if not on main branch)
    let branch_commit_messages = if is_main_branch {
        vec![]
    } else {
        get_commit_messages_since_main(dir)
    };

    // Get HEAD commit hash
    let head_commit_hash = get_head_sha(dir);

    // Determine clean_head (no changes)
    let head_diff = get_head_diff(dir).unwrap_or_default();
    let clean_head = head_diff.is_empty();

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
        head_commit_hash,
        clean_head,
    })
}

/// Gets status and caches it in the store so the watcher won't fire a spurious
/// change event on the next poll.
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

/// Registers all untracked files as intent-to-add in the git index.
/// This makes new files visible to `git ls-files` (and therefore Nix flakes)
/// without fully staging them. No-op if there are no untracked files.
pub fn intent_add_untracked(dir: &str) -> Result<()> {
    let output = git_command()
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(dir)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!(
            "failed to run `git ls-files --others --exclude-standard` in `{dir}`: {stderr}"
        ));
    }

    let untracked = String::from_utf8_lossy(&output.stdout);
    let files: Vec<&str> = untracked.lines().filter(|l| !l.is_empty()).collect();

    if files.is_empty() {
        return Ok(());
    }

    let mut args = vec!["add", "-N", "--"];
    args.extend(files);
    let add_output = git_command().args(&args).current_dir(dir).output()?;
    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(anyhow::anyhow!(
            "failed to run `git add -N -- <untracked files>` in `{dir}`: {stderr}"
        ));
    }
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

/// Info about a created commit.
pub struct CommitInfo {
    pub hash: String,
    pub tree_hash: String,
}

/// Fetch commits starting from `start_hash` going backwards.
/// `limit` caps the number returned; pass `None` to return all commits.
/// Returns CommitRow values with id = 0 (placeholder; real id assigned on DB upsert).
pub fn log(
    dir: &str,
    start_hash: &str,
    limit: Option<usize>,
) -> Result<Vec<crate::sqlite_types::CommitRow>> {
    let mut cmd = git_command();
    cmd.arg("log").arg("--format=%H%n%T%n%at%n%s");
    if let Some(n) = limit {
        cmd.arg("-n").arg(n.to_string());
    }
    cmd.arg(start_hash);
    let output = cmd.current_dir(dir).output()?;

    let text = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();
    let mut lines = text.lines();

    loop {
        let hash = match lines.next() {
            Some(h) if !h.is_empty() => h.to_string(),
            _ => break,
        };
        let tree_hash = lines.next().unwrap_or("").to_string();
        let timestamp: i64 = lines.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let subject = lines.next().unwrap_or("").to_string();

        commits.push(crate::sqlite_types::CommitRow {
            id: 0,
            hash,
            tree_hash,
            message: if subject.is_empty() {
                None
            } else {
                Some(subject)
            },
            created_at: timestamp,
        });
    }

    Ok(commits)
}

/// Get the unified diff between parent_hash and commit_hash.
pub fn commit_diff(dir: &str, parent_hash: &str, commit_hash: &str) -> Result<String> {
    let output = git_command()
        .args(["diff", parent_hash, commit_hash])
        .current_dir(dir)
        .output()?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Stages all changes and commits with the given message.
/// Returns the commit hash and tree hash on success.
pub fn commit_all(dir: &str, message: &str) -> Result<CommitInfo> {
    git_command()
        .args(["add", "-A"])
        .current_dir(dir)
        .output()?;

    git_command()
        .args(["commit", "-m", message])
        .current_dir(dir)
        .output()?;

    // Get the commit hash
    let hash_output = git_command()
        .args(["rev-parse", "HEAD"])
        .current_dir(dir)
        .output()?;
    let hash = String::from_utf8_lossy(&hash_output.stdout)
        .trim()
        .to_string();

    // Get the tree hash
    let tree_output = git_command()
        .args(["rev-parse", "HEAD^{tree}"])
        .current_dir(dir)
        .output()?;
    let tree_hash = String::from_utf8_lossy(&tree_output.stdout)
        .trim()
        .to_string();

    Ok(CommitInfo { hash, tree_hash })
}

/// Checks out all files from `target_hash` into the working tree without moving HEAD.
pub fn restore_files_at_commit(dir: &str, target_hash: &str) -> Result<()> {
    git_command()
        .args(["checkout", target_hash, "--", "."])
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
    checkout_branch(dir, &branch)
}

/// Deletes a local branch by name. Must not be the currently checked-out branch.
pub fn delete_branch(dir: &str, branch: &str) -> Result<()> {
    let output = git_command()
        .args(["branch", "-D", branch])
        .current_dir(dir)
        .output()?;
    if !output.status.success() {
        anyhow::bail!(
            "Failed to delete branch {}: {}",
            branch,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(())
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
    let default_branch = require_default_branch(dir)?;

    // Branch-specific operations below (amend/squash) must run on the branch
    // being finalized, not whichever branch happens to be currently checked out.
    let output = git_command()
        .args(["checkout", branch_name])
        .current_dir(dir)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("Failed to checkout {}: {}", branch_name, stderr);
    }

    // If a commit message is provided without squashing, amend the latest commit before merging
    if !squash {
        if let Some(msg) = commit_message {
            let output = git_command()
                .args(["commit", "--amend", "-m", msg])
                .current_dir(dir)
                .output()?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                anyhow::bail!("Failed to amend commit message: {}", stderr);
            }
        }
    }

    // If squashing, reset soft to the default branch and create a new commit on the branch
    if squash {
        let output = git_command()
            .args(["reset", "--soft", &default_branch])
            .current_dir(dir)
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to reset to {}: {}", default_branch, stderr);
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

    // 1. Checkout default branch
    let output = git_command()
        .args(["checkout", &default_branch])
        .current_dir(dir)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("Failed to checkout {}: {}", default_branch, stderr);
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
    use std::path::Path;
    use tempfile::TempDir;

    fn run_git_ok(repo_dir: &Path, args: &[&str]) -> String {
        let output = git_command().args(args).current_dir(repo_dir).output().unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).to_string()
    }

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

    #[test]
    fn test_finalize_evolve_amends_target_branch_not_checked_out_branch() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_if_needed(&repo_dir_str).unwrap();

        run_git_ok(&repo_dir, &["config", "user.email", "test@example.com"]);
        run_git_ok(&repo_dir, &["config", "user.name", "Test User"]);

        fs::write(repo_dir.join("file.txt"), "main\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "main commit"]);
        let default_branch = get_default_branch(&repo_dir_str).unwrap();
        let original_default_head = run_git_ok(&repo_dir, &["rev-parse", "HEAD"]);

        run_git_ok(&repo_dir, &["checkout", "-b", "feature"]);
        fs::write(repo_dir.join("file.txt"), "feature\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "feature commit"]);
        run_git_ok(&repo_dir, &["checkout", &default_branch]);

        finalize_evolve(
            &repo_dir_str,
            "feature",
            false,
            Some("feature commit (edited)"),
        )
        .unwrap();

        let current_branch = run_git_ok(&repo_dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
        assert_eq!(current_branch.trim(), default_branch);

        let feature_message = run_git_ok(&repo_dir, &["log", "feature", "-1", "--pretty=%s"]);
        assert_eq!(feature_message.trim(), "feature commit (edited)");

        // The original default-branch head must remain in the default branch's
        // first-parent chain, proving we did not amend the default branch itself.
        let first_parent_history = run_git_ok(&repo_dir, &["rev-list", "--first-parent", &default_branch]);
        assert!(first_parent_history.contains(original_default_head.trim()));
    }
}
