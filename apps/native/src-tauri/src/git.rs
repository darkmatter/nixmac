//! Git operations for tracking and recording configuration changes.

use crate::types::{GitFileStatus, GitStatus};
use anyhow::Result;
use std::process::Command;
use tauri::AppHandle;

/// Identity and hooks injected so nixmac doesn't inherit user's config
fn git_command() -> Command {
    let mut cmd = Command::new("git");
    cmd.env("PATH", crate::nix::get_nix_path());
    cmd.args([
        "-c",
        "user.name=nixmac",
        "-c",
        "user.email=nixmac@local",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
    ]);
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

/// Initializes git repo if needed with sensible .gitignore for Nix projects.
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

/// Full diff vs HEAD, including tracked changes and untracked files as diffs.
pub fn get_full_diff(dir: &str) -> Result<String> {
    // Get git diff for tracked files
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
    let diff_output = git_command()
        .args(["diff", "HEAD", "--", "*.nix"])
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
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
        }
        else if line.starts_with('-') {
            deletions += 1;
        }
    }

    (additions, deletions)
}

/// Parses file info from diffs. Filename and path from diff headers.
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
        // Detect change type
        else if line.starts_with("new file mode") {
            current_change_type = "new";
        } else if line.starts_with("deleted file mode") {
            current_change_type = "removed";
        } else if line.starts_with("rename from") {
            current_change_type = "renamed";
        }
    }

    // Pick up last file
    if let Some(path) = current_file {
        files.push(GitFileStatus {
            path,
            change_type: current_change_type.to_string(),
        });
    }

    files
}

/// Returns the SHA of the commit with the nixmac-last-build tag or None
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

/// Gets the SHA of any ref (branch name, tag, or symbolic ref like HEAD).
pub fn get_ref_sha(dir: &str, ref_name: &str) -> Option<String> {
    let output = git_command()
        .args(["rev-parse", ref_name])
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
    get_ref_sha(dir, "HEAD")
}

/// True if HEAD has the nixmac-last-build tag
pub fn head_is_built(dir: &str) -> bool {
    let Some(built_sha) = get_last_built_commit_sha(dir) else {
        return false;
    };
    let Some(head_sha) = get_head_sha(dir) else {
        return false;
    };
    built_sha == head_sha
}

/// Returns the current branch name (None if detached HEAD)
pub fn current_branch(dir: &str) -> Option<String> {
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

/// Comprehensive git status against HEAD.
pub fn status(dir: &str) -> Result<GitStatus> {
    let branch = current_branch(dir);

    let diff = get_full_diff(dir).unwrap_or_default();
    let (additions, deletions) = count_diff_changes(&diff);

    let files = parse_files_from_diff(&diff);

    let head_is_built = head_is_built(dir);

    let head_commit_hash = get_head_sha(dir);

    let head_diff = get_head_diff(dir).unwrap_or_default();
    let clean_head = head_diff.is_empty();

    let changes = crate::changes_from_diff::changes_from_diff(&diff, 0, false);

    Ok(GitStatus {
        files,
        branch,
        head_is_built,
        diff,
        additions,
        deletions,
        head_commit_hash,
        clean_head,
        changes,
    })
}

/// Gets status and caches it to loop in watcher
pub fn status_and_cache<R: tauri::Runtime>(dir: &str, app: &AppHandle<R>) -> Result<GitStatus> {
    let status = status(dir)?;
    cache_status(app, &status)?;
    Ok(status)
}

pub fn cache_status<R: tauri::Runtime>(app: &AppHandle<R>, status: &GitStatus) -> Result<()> {
    crate::store::set_cached_git_status(app, status)
}

/// Returns cached
pub fn cached<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Option<GitStatus>> {
    crate::store::get_cached_git_status(app)
}

/// Registers all untracked files as intent-to-add in the git index.
/// Makes files visible to `git ls-files` (and therefore Nix flakes)
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

/// Info about a created commit.
pub struct CommitInfo {
    pub hash: String,
    pub tree_hash: String,
}

/// Returns commits as Row Type (id = 0), from `start_hash` for `limit`(None for all)
pub fn log(
    dir: &str,
    start_hash: &str,
    limit: Option<usize>,
) -> Result<Vec<crate::sqlite_types::Commit>> {
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

        commits.push(crate::sqlite_types::Commit {
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

/// Diff between parent_hash and commit_hash.
pub fn commit_diff(dir: &str, parent_hash: &str, commit_hash: &str) -> Result<String> {
    let output = git_command()
        .args(["diff", parent_hash, commit_hash])
        .current_dir(dir)
        .output()?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Stages all and commits with msg, returns hash and tree hash.
pub fn commit_all(dir: &str, message: &str) -> Result<CommitInfo> {
    git_command()
        .args(["add", "-A"])
        .current_dir(dir)
        .output()?;

    git_command()
        .args(["commit", "-m", message])
        .current_dir(dir)
        .output()?;

    // Get commit hash
    let hash_output = git_command()
        .args(["rev-parse", "HEAD"])
        .current_dir(dir)
        .output()?;
    let hash = String::from_utf8_lossy(&hash_output.stdout)
        .trim()
        .to_string();

    // Get tree hash
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

/// Stages all changes and stashes with msg.
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

/// Restore all uncommitted, discard untracked.
pub fn restore_all(dir: &str) -> Result<()> {
    git_command()
        .args(["reset", "HEAD", "--"])
        .current_dir(dir)
        .output()?;

    git_command()
        .args(["checkout", "--", "."])
        .current_dir(dir)
        .output()?;

    git_command()
        .args(["clean", "-fd"])
        .current_dir(dir)
        .output()?;

    Ok(())
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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


/// Adds `nixmac-last-build` - to track latest build
/// & `nixmac-built-<timestamp>` permanently
pub fn tag_as_built(dir: &str) -> Result<()> {
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

        fs::write(repo_dir.join("file.txt"), "main\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "main commit"]);
        let origin_branch = current_branch(&repo_dir_str).unwrap();
        let original_origin_head = run_git_ok(&repo_dir, &["rev-parse", "HEAD"]);

        run_git_ok(&repo_dir, &["checkout", "-b", "feature"]);
        fs::write(repo_dir.join("file.txt"), "feature\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "feature commit"]);
        run_git_ok(&repo_dir, &["checkout", &origin_branch]);

        finalize_evolve(
            &repo_dir_str,
            "feature",
            &origin_branch,
            false,
            Some("feature commit (edited)"),
        )
        .unwrap();

        let head = run_git_ok(&repo_dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
        assert_eq!(head.trim(), origin_branch);

        let feature_message = run_git_ok(&repo_dir, &["log", "feature", "-1", "--pretty=%s"]);
        assert_eq!(feature_message.trim(), "feature commit (edited)");

        // The original origin-branch head must remain in its first-parent chain,
        // proving we did not amend the origin branch itself.
        let first_parent_history = run_git_ok(&repo_dir, &["rev-list", "--first-parent", &origin_branch]);
        assert!(first_parent_history.contains(original_origin_head.trim()));
    }
}
