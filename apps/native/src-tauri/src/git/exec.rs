/// Git execution layer (CLI AUTHORITY)
///
/// This module uses `git_command()` for CLI semantics that git2 cannot preserve,
/// and git2 where the equivalent operation is object/ref/index-level.
///
/// Rules:
/// - This layer relies on REAL Git behavior
/// - Must preserve CLI semantics exactly
/// - Includes hooks suppression + identity injection
/// - May modify filesystem, index, HEAD, refs
use crate::git::query::has_head_commit;
use anyhow::{Context, Result};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
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

/// Helper to determine the Git index mode for an intent-to-add entry based on filesystem metadata.
fn intent_to_add_mode(metadata: &std::fs::Metadata) -> u32 {
    if metadata.file_type().is_symlink() {
        return 0o120000;
    }

    // Unix executable permission bits and symlink semantics are the source of truth for
    // reproducing Git index modes without asking libgit2 to read/hash the file contents.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if metadata.permissions().mode() & 0o111 != 0 {
            return 0o100755;
        }
    }

    // If we ever run on non-Unix, regular files will be registered as non-executable.
    0o100644
}

/// Registers all untracked files as intent-to-add in the git index.
/// Makes files visible to `git ls-files` (and therefore Nix flakes)
///
/// Commands:
/// - Simulates `git ls-files --others --exclude-standard` with `repo.statuses(...)`.
/// - Simulates `git add -N -- <untracked files>` by writing empty-blob index
///   entries with `IndexEntryExtendedFlag::INTENT_TO_ADD`.
pub fn intent_add_untracked(dir: &str) -> Result<()> {
    let repo = git2::Repository::discover(dir)?;

    let mut status_opts = git2::StatusOptions::new();
    status_opts
        .show(git2::StatusShow::Workdir)
        .include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(true);

    let statuses = repo.statuses(Some(&mut status_opts))?;
    let untracked_paths = statuses
        .iter()
        .filter(|entry| entry.status().is_wt_new())
        // git2's status path API requires UTF-8. This seems like an ok tradeoff, since
        // we really shouldn't be trying to manage repos with non-UTF-8 paths.
        .map(|entry| entry.path().map(PathBuf::from))
        .collect::<std::result::Result<Vec<_>, _>>()?;

    if untracked_paths.is_empty() {
        return Ok(());
    }

    let mut index = repo.index()?;
    let empty_blob_id = repo.blob(&[])?;
    let workdir = repo
        .workdir()
        .context("cannot intent-add files in a bare repository")?;

    for path in &untracked_paths {
        let metadata = std::fs::symlink_metadata(workdir.join(path))
            .with_context(|| format!("inspect intent-to-add path `{}`", path.display()))?;
        let path_bytes = path
            .to_str()
            .with_context(|| format!("intent-to-add path is not UTF-8: `{}`", path.display()))?
            .as_bytes()
            .to_vec();

        // Construct the intent-to-add entry directly so the working file's
        // contents are never written into the object database.
        // This matches `git add -N` and avoids accumulating unreachable blobs
        // when build checks repeatedly register changing untracked files.
        let entry = git2::IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: intent_to_add_mode(&metadata),
            uid: 0,
            gid: 0,
            file_size: 0,
            id: empty_blob_id,
            flags: git2::IndexEntryFlag::EXTENDED.bits(),
            flags_extended: git2::IndexEntryExtendedFlag::INTENT_TO_ADD.bits(),
            path: path_bytes,
        };

        index
            .add(&entry)
            .with_context(|| format!("git2 add intent-to-add entry for `{}`", path.display()))?;
    }

    index.write().context("git2 write intent-to-add index")?;

    Ok(())
}

/// Info about a created commit.
pub struct CommitInfo {
    pub hash: String,
    pub tree_hash: String,
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
    let repo = git2::Repository::discover(dir)?;
    let target = repo
        .revparse_single(target)
        .with_context(|| format!("failed to resolve tag target `{}`", target))?;

    repo.tag_lightweight(tag, &target, force)
        .with_context(|| format!("failed to create tag `{}`", tag))?;

    Ok(())
}

/// Stage everything and create a backup branch without moving HEAD.
///
/// Command mapping:
/// - Runs `git add --all` through the CLI to preserve Git's staging semantics.
/// - Simulates `git write-tree` with `git2::Index::write_tree`.
/// - Simulates `git commit-tree <tree> -p HEAD -m <msg>` with `repo.commit(None, ...)`.
/// - Simulates `git update-ref refs/heads/<branch> <commit>` with `repo.reference(..., true, ...)`.
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

    let repo = git2::Repository::discover(repo_path)?;
    let mut index = repo.index().context("open git index")?;
    let tree_id = index.write_tree().context("git2 write index tree")?;
    let tree = repo.find_tree(tree_id).context("git2 find written tree")?;
    let parent = repo
        .head()
        .context("git2 resolve HEAD")?
        .peel_to_commit()
        .context("git2 peel HEAD to commit")?;
    let signature =
        git2::Signature::now("nixmac", "nixmac@local").context("create git signature")?;

    let commit_msg = format!("nixmac backup: {}", branch_name);
    let commit_id = repo
        .commit(None, &signature, &signature, &commit_msg, &tree, &[&parent])
        .context("git2 create backup commit")?;

    let ref_path = format!("refs/heads/{}", branch_name);
    repo.reference(&ref_path, commit_id, true, "create nixmac backup branch")
        .context("git2 update backup branch ref")?;

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
    fn test_tag_commit_creates_lightweight_tag_and_respects_force() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("file.txt"), "first\n").unwrap();
        let first = commit_all(&repo_dir_str, "first").unwrap();

        fs::write(repo_dir.join("file.txt"), "second\n").unwrap();
        let second = commit_all(&repo_dir_str, "second").unwrap();

        tag_commit(&repo_dir_str, "v1", &first.hash, false).unwrap();
        assert_eq!(
            run_git_ok(&repo_dir, &["rev-parse", "v1"]).trim(),
            first.hash
        );

        assert!(tag_commit(&repo_dir_str, "v1", &second.hash, false).is_err());
        assert_eq!(
            run_git_ok(&repo_dir, &["rev-parse", "v1"]).trim(),
            first.hash
        );

        tag_commit(&repo_dir_str, "v1", &second.hash, true).unwrap();
        assert_eq!(
            run_git_ok(&repo_dir, &["rev-parse", "v1"]).trim(),
            second.hash
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
    fn test_create_evolution_backup_captures_add_all_semantics() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("keep.txt"), "keep\n").unwrap();
        fs::write(repo_dir.join("remove.txt"), "remove\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial commit"]);

        fs::write(repo_dir.join("added.txt"), "added\n").unwrap();
        fs::remove_file(repo_dir.join("remove.txt")).unwrap();

        let backup_branch = create_evolution_backup(&repo_dir_str, Some(1), 2)
            .unwrap()
            .expect("expected a backup branch to be created");

        let added = run_git_ok(
            &repo_dir,
            &["show", &format!("{}:added.txt", backup_branch)],
        );
        assert_eq!(added, "added\n");

        let removed_path = format!("{}:remove.txt", backup_branch);
        assert!(
            git_command()
                .args(["cat-file", "-e", &removed_path])
                .current_dir(&repo_dir)
                .output()
                .is_err(),
            "backup tree should include tracked deletion staged by git add --all"
        );
    }

    #[test]
    fn test_create_evolution_backup_updates_existing_backup_branch() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("file.txt"), "initial\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial commit"]);

        fs::write(repo_dir.join("file.txt"), "first backup\n").unwrap();
        let backup_branch = create_evolution_backup(&repo_dir_str, Some(1), 3)
            .unwrap()
            .expect("expected a backup branch to be created");

        fs::write(repo_dir.join("file.txt"), "second backup\n").unwrap();
        let updated_backup_branch = create_evolution_backup(&repo_dir_str, Some(1), 3)
            .unwrap()
            .expect("expected a backup branch to be updated");

        assert_eq!(backup_branch, updated_backup_branch);

        let backup_tree = run_git_ok(&repo_dir, &["show", &format!("{}:file.txt", backup_branch)]);
        assert_eq!(backup_tree, "second backup\n");
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

    #[test]
    fn test_intent_add_untracked_sets_intent_flag_without_staging_contents() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join(".gitignore"), "ignored.nix\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial commit"]);

        fs::write(repo_dir.join("new.nix"), "{ untracked = true; }\n").unwrap();
        fs::write(repo_dir.join("ignored.nix"), "{ secret = true; }\n").unwrap();
        let real_blob_id =
            git2::Oid::hash_object(git2::ObjectType::Blob, b"{ untracked = true; }\n").unwrap();

        intent_add_untracked(&repo_dir_str).unwrap();

        let repo = git2::Repository::open(&repo_dir).unwrap();
        let index = repo.index().unwrap();
        let entry = index
            .get_path(Path::new("new.nix"), 0)
            .expect("new file should have an index entry");

        assert!(git2::IndexEntryFlag::from_bits_truncate(entry.flags)
            .contains(git2::IndexEntryFlag::EXTENDED));
        assert!(
            git2::IndexEntryExtendedFlag::from_bits_truncate(entry.flags_extended)
                .contains(git2::IndexEntryExtendedFlag::INTENT_TO_ADD)
        );
        assert_eq!(
            repo.find_blob(entry.id).unwrap().content(),
            b"",
            "intent-to-add entry should point at the empty blob"
        );
        assert!(
            repo.find_blob(real_blob_id).is_err(),
            "intent-to-add should not write the working file contents into the object database"
        );
        assert!(
            index.get_path(Path::new("ignored.nix"), 0).is_none(),
            "ignored files should not be registered"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["diff", "--cached", "--name-only"]),
            "",
            "intent-to-add should not stage the working file contents"
        );
    }

    #[cfg(unix)]
    #[test]
    fn test_intent_add_untracked_preserves_unix_file_modes_without_hashing_contents() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("normal.nix"), "{ normal = true; }\n").unwrap();
        fs::write(repo_dir.join("executable"), "#!/bin/sh\nexit 0\n").unwrap();
        let mut executable_permissions = fs::metadata(repo_dir.join("executable"))
            .unwrap()
            .permissions();
        executable_permissions.set_mode(0o755);
        fs::set_permissions(repo_dir.join("executable"), executable_permissions).unwrap();
        symlink("normal.nix", repo_dir.join("link.nix")).unwrap();

        intent_add_untracked(&repo_dir_str).unwrap();

        let repo = git2::Repository::open(&repo_dir).unwrap();
        let index = repo.index().unwrap();

        assert_eq!(
            index.get_path(Path::new("normal.nix"), 0).unwrap().mode,
            0o100644
        );
        assert_eq!(
            index.get_path(Path::new("executable"), 0).unwrap().mode,
            0o100755
        );
        assert_eq!(
            index.get_path(Path::new("link.nix"), 0).unwrap().mode,
            0o120000
        );
    }

    #[test]
    fn test_intent_add_untracked_works_without_head_commit() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();

        intent_add_untracked(&repo_dir_str).unwrap();

        let repo = git2::Repository::open(&repo_dir).unwrap();
        let index = repo.index().unwrap();
        let entry = index
            .get_path(Path::new("flake.nix"), 0)
            .expect("unborn repo file should have an index entry");

        assert!(
            git2::IndexEntryExtendedFlag::from_bits_truncate(entry.flags_extended)
                .contains(git2::IndexEntryExtendedFlag::INTENT_TO_ADD)
        );
    }
}
