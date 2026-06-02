/// Git execution layer (CLI AUTHORITY)
///
/// This module uses `git_command()` exclusively.
///
/// Rules:
/// - This layer relies on REAL Git behavior
/// - Must preserve CLI semantics exactly
/// - Includes hooks suppression + identity injection
/// - May modify filesystem, index, HEAD, refs
use crate::git::query::{get_head_sha, has_head_commit, repo_root};
use anyhow::{Context, Result};
use std::ffi::OsStr;
use std::path::{Component, Path};
use std::process::{Command, Output};

/// Wraps git commands, errs with Stderr on exit with non-zero status
struct GitCommand(Command);

impl GitCommand {
    fn args<I, S>(&mut self, args: I) -> &mut Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.0.args(args);
        self
    }

    fn arg<S: AsRef<OsStr>>(&mut self, arg: S) -> &mut Self {
        self.0.arg(arg);
        self
    }

    fn current_dir<P: AsRef<Path>>(&mut self, dir: P) -> &mut Self {
        self.0.current_dir(dir);
        self
    }

    fn output(&mut self) -> Result<Output> {
        let out = self.0.output()?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            anyhow::bail!("Git error: {}", stderr.trim());
        }
        Ok(out)
    }
}

/// Identity + hooks injection layer (CLI boundary enforcement)
///
/// IMPORTANT: This cannot be meaningfully replicated with `git2`,
/// the Rust library which doesn't require shelling out to a process.
///
/// The functions that call this wrapper intentionally use the Git CLI to enforce:
/// - deterministic identity (user.name / user.email)
/// - disabled commit signing (GPG)
/// - disabled hooks execution (core.hooksPath=/dev/null)
/// - controlled environment PATH resolution
///
/// These behaviors are part of the *Git process environment*, not the
/// repository object model.
///
/// `git2` does NOT support:
/// - per-command environment mutation equivalent to `-c` CLI overrides
/// - hooksPath / hook suppression semantics
/// - GPG signing configuration via execution context
/// - PATH-based toolchain isolation
fn git_command() -> GitCommand {
    let mut cmd = Command::new("git");
    cmd.env("PATH", crate::system::nix::get_nix_path());
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
    GitCommand(cmd)
}

fn is_safe_repo_relative_path(filename: &str) -> bool {
    let path = Path::new(filename);
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

/// Returns (original, modified) file content for a single file: HEAD content and working-tree content.
/// Returns empty strings for new files (no HEAD) or deleted files (not on disk).
pub fn file_diff_contents(dir: &str, filename: &str) -> (String, String) {
    let original = git_command()
        .args(["show", &format!("HEAD:{filename}")])
        .current_dir(dir)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let modified = if is_safe_repo_relative_path(filename) {
        std::fs::read_to_string(repo_root(dir).join(filename)).unwrap_or_default()
    } else {
        String::new()
    };
    (original, modified)
}

/// Registers all untracked files as intent-to-add in the git index.
/// Makes files visible to `git ls-files` (and therefore Nix flakes)
pub fn intent_add_untracked(dir: &str) -> Result<()> {
    let repo_root_dir = repo_root(dir);
    let output = git_command()
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(&repo_root_dir)
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
    let add_output = git_command()
        .args(&args)
        .current_dir(&repo_root_dir)
        .output()?;
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

/// Restores tracked files to `commit_hash`, removes untracked files, and leaves HEAD in place.
///
/// Ignored build outputs are preserved because this intentionally uses
/// `git clean -fd`, not `git clean -fdx`.
pub fn checkout_files_at_commit(dir: &str, commit_hash: &str) -> Result<()> {
    git_command()
        .args(["read-tree", "--reset", "-u", commit_hash])
        .current_dir(dir)
        .output()
        .context("git read-tree --reset -u")?;

    git_command()
        .args(["clean", "-fd"])
        .current_dir(dir)
        .output()
        .context("git clean -fd")?;
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

/// Git tags (any ref or hash) `target`, `force = true` overwrites.
pub fn tag_commit(dir: &str, tag: &str, target: &str, force: bool) -> Result<()> {
    let mut args = vec!["tag"];
    if force {
        args.push("-f");
    }
    args.push(tag);
    args.push(target);
    git_command()
        .args(&args)
        .current_dir(dir)
        .output()
        .with_context(|| format!("failed to create tag `{}`", tag))?;
    Ok(())
}

/// Stage everything and create a backup branch without moving HEAD.
pub fn create_evolution_backup(
    repo_path: &str,
    evolution_id: Option<i64>,
    changeset_id: i64,
) -> Result<Option<String>> {
    if !has_head_commit(repo_path) {
        return Ok(None);
    }

    let branch_name = format!(
        "nixmac-evolve/evolution{}-changeset{}",
        evolution_id.unwrap_or(0),
        changeset_id
    );

    git_command()
        .args(["add", "--all"])
        .current_dir(repo_path)
        .output()
        .context("git add --all")?;

    let tree_hash = git_command()
        .args(["write-tree"])
        .current_dir(repo_path)
        .output()
        .context("git write-tree")
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())?;

    let head_hash =
        get_head_sha(repo_path).ok_or_else(|| anyhow::anyhow!("failed to resolve HEAD"))?;

    let commit_msg = format!("nixmac backup: {}", branch_name);
    let commit_hash = git_command()
        .args([
            "commit-tree",
            &tree_hash,
            "-p",
            &head_hash,
            "-m",
            &commit_msg,
        ])
        .current_dir(repo_path)
        .output()
        .context("git commit-tree")
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())?;

    let ref_path = format!("refs/heads/{}", branch_name);
    git_command()
        .args(["update-ref", &ref_path, &commit_hash])
        .current_dir(repo_path)
        .output()
        .context("git update-ref")?;

    Ok(Some(branch_name))
}

/// Restore working tree to the content of a specific branch ref.
/// Replaces the current index with the branch's tree, then checks out the working tree.
///
/// NOTE that this would be harder to implement in git2 because:
/// - git2 does NOT expose “plumbing-level” commands like `read-tree` or
///   `checkout-index` as direct APIs.
/// - The closest primitive is `repo.reset(ResetType::Hard)`, which combines
///   index + working tree updates, but does NOT include untracked file cleanup.
/// - `git clean -fd` is not implemented in git2 because it is inherently
///   a filesystem operation driven by ignore rules and user policy, not just
///   Git object model state.
///
/// Therefore a full equivalent would require:
/// - resolving the ref → commit → tree (via revparse + peel)
/// - performing a hard reset (tracked files)
/// - manually walking the filesystem to delete untracked files/dirs
pub fn restore_from_branch_ref(repo_path: &str, ref_name: &str) -> Result<()> {
    git_command()
        .args(["read-tree", ref_name])
        .current_dir(repo_path)
        .output()
        .context("git read-tree")?;

    git_command()
        .args(["checkout-index", "-f", "-a"])
        .current_dir(repo_path)
        .output()
        .context("git checkout-index")?;

    git_command()
        .args(["clean", "-fd"])
        .current_dir(repo_path)
        .output()?;

    Ok(())
}

/// Delete a backup branch ref.
#[allow(dead_code)]
pub fn delete_backup_branch(repo_path: &str, branch_name: &str) -> Result<()> {
    let ref_path = format!("refs/heads/{}", branch_name);
    git_command()
        .args(["update-ref", "-d", &ref_path])
        .current_dir(repo_path)
        .output()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::git::current_branch;
    use crate::git::init::init_repo;

    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn run_git_ok(repo_dir: &Path, args: &[&str]) -> String {
        let output = git_command()
            .args(args)
            .current_dir(repo_dir)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).to_string()
    }

    #[test]
    fn test_file_diff_contents_rejects_parent_traversal() {
        let temp_dir = TempDir::new().unwrap();
        let outside_file = temp_dir.path().join("outside.txt");
        fs::write(&outside_file, "outside").unwrap();

        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        let (original, modified) = file_diff_contents(&repo_dir_str, "../outside.txt");
        assert!(original.is_empty());
        assert!(modified.is_empty());
    }

    #[test]
    fn test_file_diff_contents_reads_safe_relative_path() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ inputs = {}; }").unwrap();

        let (_, modified) = file_diff_contents(&repo_dir_str, "flake.nix");
        assert_eq!(modified, "{ inputs = {}; }");
    }

    #[test]
    fn test_checkout_files_at_commit_removes_files_added_after_target_without_moving_head() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }").unwrap();
        let baseline = commit_all(&repo_dir_str, "initial").unwrap();

        fs::create_dir_all(repo_dir.join("modules/darwin")).unwrap();
        fs::write(
            repo_dir.join("modules/darwin/system-defaults.nix"),
            "{ system.defaults.NSGlobalDomain.AppleInterfaceStyle = \"Dark\"; }\n",
        )
        .unwrap();
        fs::write(repo_dir.join("flake.nix"), "{ outputs = {}; }").unwrap();
        let changed = commit_all(&repo_dir_str, "add system defaults").unwrap();

        fs::write(
            repo_dir.join("temporary-untracked.nix"),
            "{ temp = true; }\n",
        )
        .unwrap();
        checkout_files_at_commit(&repo_dir_str, &baseline.hash).unwrap();

        let head_after_restore = run_git_ok(&repo_dir, &["rev-parse", "HEAD"]);
        assert_eq!(
            head_after_restore.trim(),
            changed.hash,
            "History restore preparation should not move HEAD before finalize_restore creates the restore commit"
        );
        assert_eq!(
            fs::read_to_string(repo_dir.join("flake.nix")).unwrap(),
            "{ }",
            "modified files should match the target commit"
        );
        assert!(
            !repo_dir.join("modules/darwin/system-defaults.nix").exists(),
            "files added after the restore target must be removed"
        );
        assert!(
            !repo_dir.join("temporary-untracked.nix").exists(),
            "untracked files should not survive restore preparation"
        );
        assert_eq!(
            run_git_ok(
                &repo_dir,
                &["diff", "--name-only", &baseline.hash, "--cached"]
            ),
            "",
            "the index should match the target commit exactly"
        );

        commit_all(&repo_dir_str, "Restore commit").unwrap();
        assert_eq!(
            run_git_ok(&repo_dir, &["diff", "--name-only", &baseline.hash, "HEAD"]),
            "",
            "the finalized restore commit should match the baseline tree"
        );
    }

    #[test]
    fn test_restore_all_recovers_head_after_checkout_files_at_commit() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }").unwrap();
        let baseline = commit_all(&repo_dir_str, "initial").unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ outputs = {}; }").unwrap();
        fs::write(repo_dir.join("added.nix"), "{ added = true; }\n").unwrap();
        let changed = commit_all(&repo_dir_str, "add file").unwrap();

        checkout_files_at_commit(&repo_dir_str, &baseline.hash).unwrap();
        restore_all(&repo_dir_str).unwrap();

        let head_after_abort = run_git_ok(&repo_dir, &["rev-parse", "HEAD"]);
        assert_eq!(
            head_after_abort.trim(),
            changed.hash,
            "abort restore should not move HEAD"
        );
        assert_eq!(
            fs::read_to_string(repo_dir.join("flake.nix")).unwrap(),
            "{ outputs = {}; }",
            "abort restore should recover HEAD's tracked file content"
        );
        assert!(
            repo_dir.join("added.nix").exists(),
            "abort restore should recover tracked files from HEAD"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["status", "--porcelain=v1"]),
            "",
            "abort restore should leave the worktree clean at HEAD"
        );
    }

    #[test]
    fn test_create_evolution_backup_does_not_move_head() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("file.txt"), "initial\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial commit"]);
        let head_before = run_git_ok(&repo_dir, &["rev-parse", "HEAD"]);
        let branch_before = current_branch(&repo_dir_str).unwrap();

        // Simulate uncommitted AI changes so backup has something to capture.
        fs::write(repo_dir.join("file.txt"), "changed\n").unwrap();

        let backup_branch = create_evolution_backup(&repo_dir_str, Some(1), 1)
            .unwrap()
            .expect("expected a backup branch to be created");

        // HEAD and checked-out branch must be unchanged.
        let head_after = run_git_ok(&repo_dir, &["rev-parse", "HEAD"]);
        let branch_after = current_branch(&repo_dir_str).unwrap();
        assert_eq!(head_before.trim(), head_after.trim());
        assert_eq!(branch_before, branch_after);

        // Backup ref must exist and point to a commit that includes the changed content.
        let backup_tree = run_git_ok(&repo_dir, &["show", &format!("{}:file.txt", backup_branch)]);
        assert_eq!(backup_tree.trim(), "changed");
    }

    #[test]
    fn test_create_evolution_backup_creates_branch_even_when_clean() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("file.txt"), "initial\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial commit"]);

        let result = create_evolution_backup(&repo_dir_str, Some(1), 0).unwrap();
        assert!(result.is_some());
    }

    #[test]
    fn test_intent_add_untracked_from_nested_config_dir() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let config_dir = repo_dir.join("nix/os");
        fs::create_dir_all(&config_dir).unwrap();

        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        let config_dir_str = config_dir.to_string_lossy().to_string();

        init_repo(&repo_dir_str).unwrap();
        fs::write(repo_dir.join("flake.nix"), "{ }").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial commit"]);

        fs::write(repo_dir.join("new.nix"), "{ untracked = true; }\n").unwrap();

        intent_add_untracked(&config_dir_str).unwrap();

        let indexed = run_git_ok(&repo_dir, &["ls-files"]);
        assert!(
            indexed.lines().any(|line| line == "new.nix"),
            "intent-add should index repo-root untracked file when invoked from nested config dir"
        );
    }
}
