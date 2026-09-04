/// Git execution layer.
///
/// This module uses git2 for object, ref, index, and worktree mutation.
/// Note that the unit tests still require git to be installed on the system
/// but that seems like a reasonable assumption.
///
/// Rules:
/// - May modify filesystem, index, HEAD, refs
use crate::git::query::has_head_commit;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

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
    #[allow(dead_code)] // No longer mirrored to the DB, but cheap to keep populated.
    pub tree_hash: String,
}

/// Stages every non-ignored worktree change into the repository index.
///
/// Simulates `git add -A`:
/// - `update_all(["."])` refreshes existing tracked entries and stages deletions.
/// - `add_all(["."], DEFAULT, ...)` stages new/modified non-ignored files.
///
/// Behavior notes:
/// - This operates on the whole discovered repository, matching modern
///   `git add -A` behavior even when invoked from a nested directory.
fn stage_all(repo: &git2::Repository) -> Result<git2::Index> {
    let mut index = repo.index().context("git2 open repository index")?;

    index
        .update_all(["."], None)
        .context("git2 update tracked index entries")?;
    index
        .add_all(["."], git2::IndexAddOption::DEFAULT, None)
        .context("git2 add worktree changes to index")?;
    index.write().context("git2 write staged index")?;

    Ok(index)
}

/// Stages all and commits with msg, returns hash and tree hash.
///
/// Simulates:
/// - `git add -A` with the `stage_all` helper.
/// - `git commit -m <message>` with `repo.commit(Some("HEAD"), ...)`.
/// - `git rev-parse HEAD` by returning the new commit id.
/// - `git rev-parse HEAD^{tree}` by returning the staged tree id.
///
/// Environment notes:
/// - The old CLI impl injected `user.name=nixmac` and `user.email=nixmac@local`;
///   git2 needs to implement that with an explicit signature.
/// - git2 does not run hooks or GPG signing, which preserves the previous CLI's
///   `core.hooksPath=/dev/null` and `commit.gpgsign=false` intent.
/// - PATH is thankfully irrelevant because no subprocess, hook, editor, or signer runs.
pub fn commit_all(dir: &str, message: &str) -> Result<CommitInfo> {
    let repo = git2::Repository::discover(dir)?;
    let mut index = stage_all(&repo)?;
    let tree_id = index.write_tree().context("git2 write commit tree")?;
    let tree = repo.find_tree(tree_id).context("git2 find commit tree")?;

    let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
    if let Some(parent) = parent.as_ref() {
        if parent.tree_id() == tree_id {
            anyhow::bail!("nothing to commit");
        }
    } else if index.is_empty() {
        anyhow::bail!("nothing to commit");
    }

    let signature =
        git2::Signature::now("nixmac", "nixmac@local").context("create git signature")?;
    let parents = parent.iter().collect::<Vec<_>>();
    let commit_id = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .context("git2 create commit")?;

    Ok(CommitInfo {
        hash: commit_id.to_string(),
        tree_hash: tree_id.to_string(),
    })
}

/// Commit a single file's change, leaving the rest of the working tree
/// uncommitted. The index is reset to HEAD so only `path` is included, then the
/// path is staged (or its deletion staged) and a commit is created.
pub fn commit_file(dir: &str, path: &str, message: &str) -> Result<CommitInfo> {
    commit_files(dir, &[path], message)
}

/// Commit only the requested repository-relative files, leaving unrelated
/// worktree changes out of the commit.
pub fn commit_files(dir: &str, paths: &[&str], message: &str) -> Result<CommitInfo> {
    let repo = git2::Repository::discover(dir)?;

    let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());

    let mut index = repo.index().context("git2 open repository index")?;
    // Start from HEAD so only `path` differs in this commit.
    if let Some(parent) = parent.as_ref() {
        let head_tree = parent.tree().context("git2 read HEAD tree")?;
        index
            .read_tree(&head_tree)
            .context("git2 reset index to HEAD")?;
    } else {
        index.clear().context("git2 clear index")?;
    }

    let workdir = repo
        .workdir()
        .context("commit_files in a bare repository")?;
    for path in paths {
        let rel = Path::new(path);
        if workdir.join(rel).exists() {
            index
                .add_path(rel)
                .with_context(|| format!("git2 stage `{path}`"))?;
        } else {
            index
                .remove_path(rel)
                .with_context(|| format!("git2 stage deletion of `{path}`"))?;
        }
    }
    index.write().context("git2 write staged index")?;

    let tree_id = index.write_tree().context("git2 write commit tree")?;
    if let Some(parent) = parent.as_ref()
        && parent.tree_id() == tree_id
    {
        anyhow::bail!("nothing to commit");
    }
    let tree = repo.find_tree(tree_id).context("git2 find commit tree")?;

    let signature =
        git2::Signature::now("nixmac", "nixmac@local").context("create git signature")?;
    let parents = parent.iter().collect::<Vec<_>>();
    let commit_id = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .context("git2 create commit")?;

    Ok(CommitInfo {
        hash: commit_id.to_string(),
        tree_hash: tree_id.to_string(),
    })
}

/// Build an index entry pointing `rel` at `content` and stage it. Zeroed stat
/// data makes git rehash the file on the next status scan, so content
/// equality decides cleanliness.
fn stage_content_in_index(
    repo: &git2::Repository,
    index: &mut git2::Index,
    rel: &Path,
    content: &str,
    mode: u32,
) -> Result<()> {
    let oid = repo.blob(content.as_bytes()).context("git2 write blob")?;
    let entry = git2::IndexEntry {
        ctime: git2::IndexTime::new(0, 0),
        mtime: git2::IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode,
        uid: 0,
        gid: 0,
        file_size: content.len() as u32,
        id: oid,
        flags: 0,
        flags_extended: 0,
        path: rel.as_os_str().as_encoded_bytes().to_vec(),
    };
    index
        .add_frombuffer(&entry, content.as_bytes())
        .with_context(|| format!("git2 stage `{}`", rel.display()))
}

/// Point a path's index entry at restored working-tree content, skipping the
/// write when the entry already holds that blob.
fn repair_index_entry(
    repo: &git2::Repository,
    index: &mut git2::Index,
    rel: &Path,
    content: &str,
    mode: u32,
) -> Result<()> {
    let oid = repo.blob(content.as_bytes()).context("git2 write blob")?;
    if index.get_path(rel, 0).is_some_and(|entry| entry.id == oid) {
        return Ok(());
    }
    stage_content_in_index(repo, index, rel, content, mode)?;
    index.write().context("git2 write repaired index")?;
    Ok(())
}

/// Whether the index entry for `rel` differs from HEAD's. A missing entry on
/// either side counts as different, so staged additions, modifications, and
/// deletions all qualify — but a never-added untracked file does not.
fn index_entry_differs_from_head(
    head_tree: Option<&git2::Tree>,
    index: &git2::Index,
    rel: &Path,
) -> bool {
    let head_id = head_tree
        .and_then(|tree| tree.get_path(rel).ok())
        .map(|entry| entry.id());
    let index_id = index.get_path(rel, 0).map(|entry| entry.id);
    index_id != head_id
}

/// Discard one detected hunk from a file's working-tree content. Unlike
/// `restore_file` this touches only the hunk's lines, so sibling hunks in the
/// same file survive. Discarding a new file's hunk removes the file; restoring
/// a deleted file's hunk rewrites its content.
///
/// Like `restore_file`, staged changes are repaired: when the path's index
/// entry differs from HEAD (staged addition, modification, or deletion), it is
/// pointed at the restored content so the discarded change does not keep the
/// drift row alive. Purely unstaged drift leaves the index untouched.
pub fn restore_hunk(dir: &str, path: &str, hunk: &str) -> Result<()> {
    let repo = git2::Repository::discover(dir)?;
    let rel = super::repo_files::normalize_repo_relative_path_lexically(path)
        .context("path escapes the repository")?;
    let workdir = repo
        .workdir()
        .context("restore_hunk in a bare repository")?;
    let full = workdir.join(&rel);
    let parsed = super::hunks::parse_hunk(hunk)?;

    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
    let head_entry = head_tree.as_ref().and_then(|tree| tree.get_path(&rel).ok());
    let tracked_in_head = head_entry.is_some();
    // Hunk text carries no newline-at-EOF marker (the drift pipeline drops
    // it), so take the restored side's state from the HEAD blob.
    let eof_trailing_newline = head_entry
        .as_ref()
        .and_then(|entry| repo.find_blob(entry.id()).ok())
        .map(|blob| blob.content().ends_with(b"\n"))
        .unwrap_or(true);

    let mut index = repo.index().context("git2 open repository index")?;
    let staged_change = index_entry_differs_from_head(head_tree.as_ref(), &index, &rel);
    // Prefer the index entry's mode (it reflects the worktree for staged
    // additions); fall back to HEAD's, then to a plain file.
    let mode = index
        .get_path(&rel, 0)
        .map(|entry| entry.mode)
        .or_else(|| head_entry.as_ref().map(|entry| entry.filemode() as u32))
        .unwrap_or(0o100644);

    if !full.exists() {
        // Only a deleted-file hunk (empty new side) can be discarded here;
        // the hash lookup upstream guarantees the hunk existed in the diff.
        if !parsed.new_lines.is_empty() {
            anyhow::bail!("`{path}` is missing from the working tree; refresh and try again");
        }
        let restored = super::hunks::apply_hunk(
            "",
            &parsed,
            super::hunks::Direction::Reverse,
            eof_trailing_newline,
        )?;
        let super::hunks::ApplyOutcome::Content(content) = restored else {
            anyhow::bail!("discarding this change restored no content");
        };
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create parent dirs of `{}`", full.display()))?;
        }
        std::fs::write(&full, &content)
            .with_context(|| format!("restore deleted `{}`", full.display()))?;
        if staged_change {
            // A staged deletion must not keep the row alive once the file is
            // back on disk.
            repair_index_entry(&repo, &mut index, &rel, &content, mode)?;
        }
        return Ok(());
    }

    let content = std::fs::read_to_string(&full)
        .with_context(|| format!("read `{path}` (binary files cannot discard single changes)"))?;

    match super::hunks::apply_hunk(
        &content,
        &parsed,
        super::hunks::Direction::Reverse,
        eof_trailing_newline,
    )? {
        super::hunks::ApplyOutcome::Content(new_content) => {
            std::fs::write(&full, &new_content)
                .with_context(|| format!("write `{}`", full.display()))?;
            if staged_change {
                repair_index_entry(&repo, &mut index, &rel, &new_content, mode)?;
            }
        }
        super::hunks::ApplyOutcome::Empty => {
            // The hunk covered the file's entire content (a new-file hunk).
            if tracked_in_head {
                // HEAD's file was empty; discarding its additions empties it.
                std::fs::write(&full, "").with_context(|| format!("empty `{}`", full.display()))?;
                if staged_change {
                    repair_index_entry(&repo, &mut index, &rel, "", mode)?;
                }
            } else {
                std::fs::remove_file(&full)
                    .with_context(|| format!("remove `{}`", full.display()))?;
                // Mirror restore_file: drop a staged (intent-to-add) entry too.
                if index.get_path(&rel, 0).is_some() {
                    let _ = index.remove_path(&rel);
                    let _ = index.write();
                }
            }
        }
    }

    Ok(())
}

/// Commit one detected hunk of a single file: the hunk is applied to the
/// file's HEAD content, staged alone, and committed. Sibling hunks and the
/// rest of the working tree stay uncommitted. Mirrors `commit_file` but with
/// hunk granularity instead of file granularity.
///
/// An empty applied result records a deletion only when the file is also gone
/// from the working tree; a tracked file truncated to zero bytes is committed
/// as an empty blob instead.
pub fn commit_hunk(dir: &str, path: &str, hunk: &str, message: &str) -> Result<CommitInfo> {
    let repo = git2::Repository::discover(dir)?;
    let rel = super::repo_files::normalize_repo_relative_path_lexically(path)
        .context("path escapes the repository")?;

    let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
    let head_tree = parent.as_ref().and_then(|commit| commit.tree().ok());
    let head_entry = head_tree.as_ref().and_then(|tree| tree.get_path(&rel).ok());

    let head_content = match head_entry.as_ref() {
        Some(entry) => {
            let blob = repo.find_blob(entry.id()).context("git2 read HEAD blob")?;
            anyhow::ensure!(
                !blob.is_binary(),
                "`{path}` is binary; single-change commit is unavailable"
            );
            String::from_utf8_lossy(blob.content()).into_owned()
        }
        None => String::new(),
    };

    let parsed = super::hunks::parse_hunk(hunk)?;
    // The hunk's added side describes the working tree, so when the applied
    // region ends the file, its newline state is the on-disk file's.
    let eof_trailing_newline = std::fs::read_to_string(
        repo.workdir()
            .context("commit_hunk in a bare repository")?
            .join(&rel),
    )
    .map(|content| content.ends_with('\n'))
    .unwrap_or(true);
    let new_content = match super::hunks::apply_hunk(
        &head_content,
        &parsed,
        super::hunks::Direction::Forward,
        eof_trailing_newline,
    )? {
        super::hunks::ApplyOutcome::Content(content) => content,
        super::hunks::ApplyOutcome::Empty => String::new(),
    };

    let mut index = repo.index().context("git2 open repository index")?;
    // Start from HEAD so only this hunk's path differs in the commit.
    match head_tree.as_ref() {
        Some(tree) => index.read_tree(tree).context("git2 reset index to HEAD")?,
        None => index.clear().context("git2 clear index")?,
    }

    // An empty result records a deletion only when the file is gone from the
    // working tree too; a tracked file truncated to zero bytes is committed
    // as an empty blob instead.
    let file_in_worktree = repo
        .workdir()
        .is_some_and(|workdir| workdir.join(&rel).exists());
    let mode = head_entry
        .as_ref()
        .map_or(0o100644, |entry| entry.filemode() as u32);
    if new_content.is_empty() && !file_in_worktree {
        anyhow::ensure!(
            head_entry.is_some(),
            "nothing to commit: the change is already absent from HEAD"
        );
        index
            .remove_path(&rel)
            .with_context(|| format!("git2 stage deletion of `{path}`"))?;
    } else {
        stage_content_in_index(&repo, &mut index, &rel, &new_content, mode)?;
    }
    index.write().context("git2 write staged index")?;

    let tree_id = index.write_tree().context("git2 write commit tree")?;
    if let Some(parent) = parent.as_ref()
        && parent.tree_id() == tree_id
    {
        anyhow::bail!("nothing to commit");
    }
    let tree = repo.find_tree(tree_id).context("git2 find commit tree")?;

    let signature =
        git2::Signature::now("nixmac", "nixmac@local").context("create git signature")?;
    let parents = parent.iter().collect::<Vec<_>>();
    let commit_id = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .context("git2 create commit")?;

    Ok(CommitInfo {
        hash: commit_id.to_string(),
        tree_hash: tree_id.to_string(),
    })
}

/// Discard the working-tree changes for a single file: tracked files are
/// restored to their HEAD content (covering modifications and deletions), and
/// an untracked file is removed from the working tree.
pub fn restore_file(dir: &str, path: &str) -> Result<()> {
    let repo = git2::Repository::discover(dir)?;
    let rel = Path::new(path);

    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
    let tracked_in_head = head_tree
        .as_ref()
        .is_some_and(|tree| tree.get_path(rel).is_ok());

    if tracked_in_head {
        let head_obj = repo
            .revparse_single("HEAD")
            .context("git2 resolve HEAD for restore_file")?;
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout.force().update_index(true).path(path);
        repo.checkout_tree(&head_obj, Some(&mut checkout))
            .with_context(|| format!("git2 restore `{path}` from HEAD"))?;
    } else {
        // Untracked/new file → discarding means removing it from the worktree.
        let workdir = repo
            .workdir()
            .context("restore_file in a bare repository")?;
        let full = workdir.join(rel);
        if full.exists() {
            std::fs::remove_file(&full)
                .with_context(|| format!("remove untracked `{}`", full.display()))?;
        }
        let mut index = repo.index().context("git2 open repository index")?;
        if index.get_path(rel, 0).is_some() {
            let _ = index.remove_path(rel);
            let _ = index.write();
        }
    }

    Ok(())
}

/// Restores tracked files to `commit_hash`, removes untracked files, and leaves HEAD in place.
///
/// Simulates:
/// - `git read-tree --reset -u <commit_hash>` by replacing the repository index
///   with the target commit tree and checking that index out to the worktree.
/// - `git clean -fd` with `remove_untracked`.
///
/// Behavior notes:
/// - This operates on the entire discovered repository, even when `dir` is a
///   nested directory. The previous CLI implementation only restored and
///   cleaned working-tree files beneath `dir`, although it reset the full index.
///   **THAT SEEMS UNINTENDED** and is maybe an artifact of how we used to assume
///   that `dir` would always be the repository root.
///
/// - The index and worktree are changed to match the target.
/// - Ignored files are preserved. Completely empty untracked directories may
///   remain because Git does not report them through status.
pub fn checkout_files_at_commit(dir: &str, commit_hash: &str) -> Result<()> {
    let repo = git2::Repository::discover(dir)?;
    let commit = repo
        .revparse_single(commit_hash)
        .with_context(|| format!("git2 resolve restore target `{commit_hash}`"))?
        .peel_to_commit()
        .with_context(|| format!("git2 peel restore target `{commit_hash}` to commit"))?;
    let tree = commit.tree().context("git2 read restore target tree")?;

    let mut index = repo.index().context("git2 open repository index")?;
    index
        .read_tree(&tree)
        .context("git2 replace index with restore target tree")?;
    index.write().context("git2 write restore target index")?;

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force().remove_ignored(false);
    repo.checkout_index(Some(&mut index), Some(&mut checkout))
        .context("git2 checkout restore target index")?;

    remove_untracked(&repo)
}

/// Restore the entire repository to HEAD and discard untracked files.
///
/// Simulates:
/// - `git reset HEAD --`
/// - `git checkout -- .`
/// - `git clean -fd`
///
/// Behavior notes:
/// - This operates on the entire discovered repository, even when `dir` is a
///   nested directory. The previous CLI implementation only restored and
///   cleaned working-tree files beneath `dir`, although it reset the full index.
///   **THAT SEEMS UNINTENDED** and is maybe an artifact of how we used to assume
///   that `dir` would always be the repository root.
///
/// - All staged AND unstaged changes are discarded across the repository.
///
/// - Reported untracked files and any now-empty tracked parent directories are
///   removed; ignored files are preserved. This requires a bit more sophisticated
///   approach (in the helper than `git clean -fd` alone because git2 does not expose
///   that command with those semantics.
pub fn restore_all(dir: &str) -> Result<()> {
    let repo = git2::Repository::discover(dir)?;
    let head = repo
        .revparse_single("HEAD")
        .context("git2 resolve HEAD for restore")?;

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force().remove_ignored(false);

    repo.reset(&head, git2::ResetType::Hard, Some(&mut checkout))
        .context("git2 hard reset repository to HEAD")?;

    remove_untracked(&repo)
}

/// Removes the non-ignored untracked files reported by git2 after a reset.
///
/// `CheckoutBuilder::remove_untracked(true)` only removes untracked paths that
/// obstruct checkout operations; it is not a complete replacement for
/// `git clean -fd`. Git does not report empty untracked _directories_ through
/// status, so those directories may remain.
fn remove_untracked(repo: &git2::Repository) -> Result<()> {
    let workdir = repo
        .workdir()
        .context("cannot remove untracked files from a bare repository")?;

    let mut status_opts = git2::StatusOptions::new();
    status_opts
        .show(git2::StatusShow::Workdir)
        .include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(true);

    let statuses = repo.statuses(Some(&mut status_opts))?;
    let mut parent_dirs = Vec::new();

    for entry in statuses.iter().filter(|entry| entry.status().is_wt_new()) {
        let relative_path = Path::new(entry.path()?);
        let full_path = workdir.join(relative_path);

        let metadata = std::fs::symlink_metadata(&full_path)
            .with_context(|| format!("inspect untracked path `{}`", full_path.display()))?;

        if metadata.is_dir() {
            // Don't do recursive removal here: a reported untracked directory may
            // contain ignored files.
            std::fs::remove_dir(&full_path)
                .with_context(|| format!("remove empty untracked dir `{}`", full_path.display()))?;
        } else {
            std::fs::remove_file(&full_path)
                .with_context(|| format!("remove untracked file `{}`", full_path.display()))?;
        }

        let mut parent = relative_path.parent();
        while let Some(path) = parent {
            if path.as_os_str().is_empty() {
                break;
            }
            parent_dirs.push(workdir.join(path));
            parent = path.parent();
        }
    }

    // Sort by deeper paths first, then sort lexically so that duplicates
    // are adjacent and can be deduped while preserving the correct order.
    parent_dirs.sort_by(|a, b| {
        b.components()
            .count()
            .cmp(&a.components().count())
            .then_with(|| a.cmp(b))
    });
    parent_dirs.dedup();
    for dir in parent_dirs {
        // Failure usually means the directory contains a tracked or ignored
        // file in which case we leave it alone.
        let _ = std::fs::remove_dir(dir);
    }

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
/// - Simulates `git add --all` with the `stage_all` helper.
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

    let repo = git2::Repository::discover(repo_path)?;
    let mut index = stage_all(&repo)?;
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
/// Simulates:
/// - `git read-tree <ref_name>` by replacing the repository index with the
///   resolved tree.
/// - `git checkout-index -f -a` by force-checking the index out to the worktree.
/// - `git clean -fd` with `remove_untracked`.
///
/// Behavior notes:
/// - The index and worktree are changed to match the ref.
/// - The resolved ref may be any tree-like-thingy that git2 can peel to a tree.
/// - Ignored files are preserved. Completely empty untracked directories may
///   remain because Git does not report them through status.
pub fn restore_from_branch_ref(repo_path: &str, ref_name: &str) -> Result<()> {
    let repo = git2::Repository::discover(repo_path)?;
    let tree = repo
        .revparse_single(ref_name)
        .with_context(|| format!("git2 resolve restore ref `{ref_name}`"))?
        .peel_to_tree()
        .with_context(|| format!("git2 peel restore ref `{ref_name}` to tree"))?;

    let mut index = repo.index().context("git2 open repository index")?;
    index
        .read_tree(&tree)
        .context("git2 replace index with restore ref tree")?;
    index.write().context("git2 write restore ref index")?;

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force().remove_ignored(false);
    repo.checkout_index(Some(&mut index), Some(&mut checkout))
        .context("git2 checkout restore ref index")?;

    remove_untracked(&repo)
}

#[cfg(test)]
mod tests {
    use crate::git::current_branch;
    use crate::git::init::init_repo;

    use super::*;
    use std::fs;
    use std::path::Path;
    use std::process::{Command, Output};
    use tempfile::TempDir;

    fn run_git(repo_dir: &Path, args: &[&str]) -> Output {
        Command::new("git")
            .env("PATH", crate::system::nix::get_nix_path())
            .args([
                "-c",
                "user.name=nixmac",
                "-c",
                "user.email=nixmac@local",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=/dev/null",
            ])
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git command")
    }

    fn run_git_ok(repo_dir: &Path, args: &[&str]) -> String {
        let output = run_git(repo_dir, args);
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).to_string()
    }

    #[test]
    fn test_commit_all_creates_initial_commit_with_deterministic_identity() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();

        let info = commit_all(&repo_dir_str, "initial").unwrap();

        assert_eq!(
            run_git_ok(&repo_dir, &["rev-parse", "HEAD"]).trim(),
            info.hash
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["rev-parse", "HEAD^{tree}"]).trim(),
            info.tree_hash
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["show", "-s", "--format=%an <%ae>", "HEAD"]).trim(),
            "nixmac <nixmac@local>"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["show", "-s", "--format=%s", "HEAD"]).trim(),
            "initial"
        );
    }

    #[test]
    fn test_commit_files_commits_only_requested_paths() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("one.txt"), "initial one\n").unwrap();
        fs::write(repo_dir.join("two.txt"), "initial two\n").unwrap();
        fs::write(repo_dir.join("unrelated.txt"), "initial unrelated\n").unwrap();
        commit_all(&repo_dir_str, "initial").unwrap();

        fs::write(repo_dir.join("one.txt"), "changed one\n").unwrap();
        fs::write(repo_dir.join("two.txt"), "changed two\n").unwrap();
        fs::write(repo_dir.join("unrelated.txt"), "working change\n").unwrap();
        commit_files(&repo_dir_str, &["one.txt", "two.txt"], "selected").unwrap();

        assert_eq!(
            run_git_ok(&repo_dir, &["show", "HEAD:one.txt"]),
            "changed one\n"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["show", "HEAD:two.txt"]),
            "changed two\n"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["show", "HEAD:unrelated.txt"]),
            "initial unrelated\n"
        );
        assert_eq!(
            fs::read_to_string(repo_dir.join("unrelated.txt")).unwrap(),
            "working change\n"
        );
    }

    #[test]
    fn test_commit_all_matches_add_all_for_all_file_states() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(repo_dir.join("keep.txt"), "initial\n").unwrap();
        fs::write(repo_dir.join("remove.txt"), "remove\n").unwrap();
        fs::write(repo_dir.join("tracked_ignored.txt"), "tracked initial\n").unwrap();
        commit_all(&repo_dir_str, "initial").unwrap();

        fs::write(repo_dir.join("keep.txt"), "changed\n").unwrap();
        fs::remove_file(repo_dir.join("remove.txt")).unwrap();
        fs::write(repo_dir.join("added.txt"), "added\n").unwrap();
        fs::write(repo_dir.join("ignored.txt"), "ignored\n").unwrap();
        fs::write(repo_dir.join("tracked_ignored.txt"), "tracked changed\n").unwrap();

        commit_all(&repo_dir_str, "second").unwrap();

        assert_eq!(
            run_git_ok(&repo_dir, &["show", "HEAD:keep.txt"]),
            "changed\n"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["show", "HEAD:added.txt"]),
            "added\n"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["show", "HEAD:tracked_ignored.txt"]),
            "tracked changed\n"
        );
        assert!(
            !run_git(&repo_dir, &["cat-file", "-e", "HEAD:remove.txt"])
                .status
                .success(),
            "deleted tracked file should be removed from the commit"
        );
        assert!(
            !run_git(&repo_dir, &["cat-file", "-e", "HEAD:ignored.txt"])
                .status
                .success(),
            "ignored untracked file should not be committed"
        );
        assert_eq!(run_git_ok(&repo_dir, &["status", "--porcelain=v1"]), "");
    }

    #[test]
    fn test_commit_all_from_nested_dir_stages_entire_repo() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let config_dir = repo_dir.join("nix/os");
        fs::create_dir_all(&config_dir).unwrap();
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        let config_dir_str = config_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("outside.txt"), "outside initial\n").unwrap();
        fs::write(config_dir.join("inside.nix"), "{ }\n").unwrap();
        commit_all(&repo_dir_str, "initial").unwrap();

        fs::write(repo_dir.join("outside.txt"), "outside changed\n").unwrap();
        fs::write(config_dir.join("inside.nix"), "{ changed = true; }\n").unwrap();

        commit_all(&config_dir_str, "nested commit").unwrap();

        assert_eq!(
            run_git_ok(&repo_dir, &["show", "HEAD:outside.txt"]),
            "outside changed\n"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["show", "HEAD:nix/os/inside.nix"]),
            "{ changed = true; }\n"
        );
    }

    #[test]
    fn test_commit_all_fails_when_there_is_nothing_to_commit() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        git2::Repository::init(&repo_dir).unwrap();

        assert!(commit_all(&repo_dir_str, "empty initial").is_err());

        let repo_dir = temp_dir.path().join("repo-with-gitignore");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        let first = commit_all(&repo_dir_str, "initial").unwrap();

        assert!(commit_all(&repo_dir_str, "empty second").is_err());
        assert_eq!(
            run_git_ok(&repo_dir, &["rev-parse", "HEAD"]).trim(),
            first.hash
        );
    }

    #[test]
    fn test_commit_all_does_not_run_git_hooks() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        fs::write(
            repo_dir.join(".git/hooks/pre-commit"),
            "#!/bin/sh\nexit 1\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(repo_dir.join(".git/hooks/pre-commit"))
                .unwrap()
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(repo_dir.join(".git/hooks/pre-commit"), permissions).unwrap();
        }

        commit_all(&repo_dir_str, "initial").unwrap();

        assert_eq!(
            run_git_ok(&repo_dir, &["show", "-s", "--format=%s", "HEAD"]).trim(),
            "initial"
        );
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
        let branch_before_restore = current_branch(&repo_dir_str);
        checkout_files_at_commit(&repo_dir_str, &baseline.hash).unwrap();

        let head_after_restore = run_git_ok(&repo_dir, &["rev-parse", "HEAD"]);
        assert_eq!(
            head_after_restore.trim(),
            changed.hash,
            "History restore preparation should not move HEAD before finalize_restore creates the restore commit"
        );
        assert_eq!(current_branch(&repo_dir_str), branch_before_restore);
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
    fn test_checkout_files_at_commit_preserves_ignored_files() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join(".gitignore"), "result/\n").unwrap();
        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        let baseline = commit_all(&repo_dir_str, "initial").unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ changed = true; }\n").unwrap();
        commit_all(&repo_dir_str, "changed").unwrap();

        fs::create_dir_all(repo_dir.join("result")).unwrap();
        fs::write(repo_dir.join("result/output"), "preserve\n").unwrap();

        checkout_files_at_commit(&repo_dir_str, &baseline.hash).unwrap();

        assert_eq!(
            fs::read_to_string(repo_dir.join("flake.nix")).unwrap(),
            "{ }\n"
        );
        assert_eq!(
            fs::read_to_string(repo_dir.join("result/output")).unwrap(),
            "preserve\n"
        );
    }

    #[test]
    fn test_checkout_files_at_commit_invalid_target_leaves_repository_unchanged() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        commit_all(&repo_dir_str, "initial").unwrap();
        fs::write(repo_dir.join("flake.nix"), "{ changed = true; }\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);

        let status_before = run_git_ok(&repo_dir, &["status", "--porcelain=v1"]);

        assert!(checkout_files_at_commit(&repo_dir_str, "does-not-exist").is_err());

        assert_eq!(
            fs::read_to_string(repo_dir.join("flake.nix")).unwrap(),
            "{ changed = true; }\n"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["status", "--porcelain=v1"]),
            status_before
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
    fn test_restore_all_from_nested_dir_restores_entire_repository() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let config_dir = repo_dir.join("nix/os");
        fs::create_dir_all(&config_dir).unwrap();

        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        let config_dir_str = config_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("outside.txt"), "initial\n").unwrap();
        fs::write(config_dir.join("inside.nix"), "{ }\n").unwrap();
        let head = commit_all(&repo_dir_str, "initial").unwrap();

        fs::write(repo_dir.join("outside.txt"), "changed\n").unwrap();
        fs::write(config_dir.join("inside.nix"), "{ changed = true; }\n").unwrap();
        fs::write(repo_dir.join("outside-untracked.txt"), "remove\n").unwrap();

        restore_all(&config_dir_str).unwrap();

        assert_eq!(
            fs::read_to_string(repo_dir.join("outside.txt")).unwrap(),
            "initial\n",
            "tracked files outside the nested input directory are restored"
        );
        assert_eq!(
            fs::read_to_string(config_dir.join("inside.nix")).unwrap(),
            "{ }\n"
        );
        assert!(!repo_dir.join("outside-untracked.txt").exists());
        assert_eq!(
            run_git_ok(&repo_dir, &["rev-parse", "HEAD"]).trim(),
            head.hash
        );
    }

    #[test]
    fn test_restore_all_removes_untracked_but_preserves_ignored_files() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join(".gitignore"), "ignored/\n").unwrap();
        fs::write(repo_dir.join("tracked.txt"), "initial\n").unwrap();
        commit_all(&repo_dir_str, "initial").unwrap();

        fs::create_dir_all(repo_dir.join("untracked/nested")).unwrap();
        fs::write(repo_dir.join("untracked/nested/file.txt"), "remove\n").unwrap();
        fs::create_dir_all(repo_dir.join("ignored")).unwrap();
        fs::write(repo_dir.join("ignored/build-output"), "preserve\n").unwrap();
        fs::write(repo_dir.join("intent.nix"), "{ }\n").unwrap();
        intent_add_untracked(&repo_dir_str).unwrap();

        restore_all(&repo_dir_str).unwrap();

        assert!(!repo_dir.join("untracked").exists());
        assert!(
            !repo_dir.join("intent.nix").exists(),
            "intent-to-add files should become untracked during reset and then be removed"
        );
        assert!(repo_dir.join("ignored/build-output").exists());
        assert_eq!(
            run_git_ok(&repo_dir, &["status", "--porcelain=v1"]),
            "",
            "restore should leave the repository clean"
        );
    }

    #[test]
    fn test_restore_from_branch_ref_restores_backup_without_moving_head() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join(".gitignore"), "result/\n").unwrap();
        fs::write(repo_dir.join("file.txt"), "initial\n").unwrap();
        let head = commit_all(&repo_dir_str, "initial").unwrap();
        let branch_before_restore = current_branch(&repo_dir_str);

        fs::write(repo_dir.join("file.txt"), "backup content\n").unwrap();
        let backup_branch = create_evolution_backup(&repo_dir_str, Some(2), 1)
            .unwrap()
            .expect("expected backup branch");

        fs::write(repo_dir.join("file.txt"), "later content\n").unwrap();
        fs::write(repo_dir.join("untracked.txt"), "remove\n").unwrap();
        fs::create_dir_all(repo_dir.join("result")).unwrap();
        fs::write(repo_dir.join("result/output"), "preserve\n").unwrap();

        restore_from_branch_ref(&repo_dir_str, &backup_branch).unwrap();

        assert_eq!(
            fs::read_to_string(repo_dir.join("file.txt")).unwrap(),
            "backup content\n"
        );
        assert!(!repo_dir.join("untracked.txt").exists());
        assert!(repo_dir.join("result/output").exists());
        assert_eq!(
            run_git_ok(&repo_dir, &["rev-parse", "HEAD"]).trim(),
            head.hash
        );
        assert_eq!(current_branch(&repo_dir_str), branch_before_restore);
        assert_eq!(
            run_git_ok(
                &repo_dir,
                &["diff", "--name-only", &backup_branch, "--cached"]
            ),
            "",
            "index should match the backup ref tree"
        );
    }

    #[test]
    fn test_restore_from_branch_ref_invalid_ref_leaves_repository_unchanged() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("file.txt"), "initial\n").unwrap();
        commit_all(&repo_dir_str, "initial").unwrap();
        fs::write(repo_dir.join("file.txt"), "changed\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);

        let status_before = run_git_ok(&repo_dir, &["status", "--porcelain=v1"]);

        assert!(restore_from_branch_ref(&repo_dir_str, "does-not-exist").is_err());

        assert_eq!(
            fs::read_to_string(repo_dir.join("file.txt")).unwrap(),
            "changed\n"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["status", "--porcelain=v1"]),
            status_before
        );
    }

    #[test]
    fn test_backup_anchor_commit_tracks_head_at_snapshot_time() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("file.txt"), "initial\n").unwrap();
        let head_at_snapshot = commit_all(&repo_dir_str, "initial").unwrap();

        fs::write(repo_dir.join("file.txt"), "session changes\n").unwrap();
        let backup_branch = create_evolution_backup(&repo_dir_str, Some(1), 1)
            .unwrap()
            .expect("expected backup branch");

        // While HEAD hasn't moved, the anchor matches it — the session is live.
        let anchor = crate::git::backup_anchor_commit(&repo_dir_str, &backup_branch);
        assert_eq!(anchor.as_deref(), Some(head_at_snapshot.hash.as_str()));
        assert_eq!(
            anchor,
            crate::git::get_ref_sha(&repo_dir_str, "HEAD"),
            "live session: anchor equals HEAD"
        );

        // A commit made outside the session moves HEAD off the anchor.
        fs::write(repo_dir.join("file.txt"), "manual commit\n").unwrap();
        commit_all(&repo_dir_str, "manual change outside nixmac").unwrap();
        assert_ne!(
            crate::git::backup_anchor_commit(&repo_dir_str, &backup_branch),
            crate::git::get_ref_sha(&repo_dir_str, "HEAD"),
            "stale session: anchor no longer equals HEAD"
        );

        // Missing branches have no anchor.
        assert_eq!(
            crate::git::backup_anchor_commit(&repo_dir_str, "nixmac-evolve/missing"),
            None
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
            !run_git(&repo_dir, &["cat-file", "-e", &removed_path])
                .status
                .success(),
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

        assert!(
            git2::IndexEntryFlag::from_bits_truncate(entry.flags)
                .contains(git2::IndexEntryFlag::EXTENDED)
        );
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
        use std::os::unix::fs::{PermissionsExt, symlink};

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

    /// Commits a 21-line `letters.txt` (lines `a`..`u`), then drifts two
    /// distant lines (`c` → `C`, `s` → `S`) in the working tree. With five
    /// context lines these land in two separate hunks.
    fn repo_with_two_drifted_lines() -> (TempDir, std::path::PathBuf, String, String) {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        let original: String = (b'a'..=b'u')
            .map(|letter| format!("{}\n", letter as char))
            .collect();
        fs::write(repo_dir.join("letters.txt"), &original).unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial"]);

        let drifted = original.replace("c\n", "C\n").replace("s\n", "S\n");
        fs::write(repo_dir.join("letters.txt"), &drifted).unwrap();

        (temp_dir, repo_dir, repo_dir_str, original)
    }

    fn two_drift_hunks(repo_dir_str: &str) -> (String, String) {
        let hunks = crate::git::query::changes_since_ref(repo_dir_str, "HEAD")
            .expect("diff workdir against HEAD");
        assert_eq!(hunks.len(), 2, "two distant edits should yield two hunks");
        let c_hunk = hunks
            .iter()
            .find(|hunk| hunk.diff.contains("+C"))
            .expect("hunk editing `c`")
            .diff
            .clone();
        let s_hunk = hunks
            .iter()
            .find(|hunk| hunk.diff.contains("+S"))
            .expect("hunk editing `s`")
            .diff
            .clone();
        (c_hunk, s_hunk)
    }

    #[test]
    fn test_restore_hunk_discards_one_hunk_and_keeps_sibling_hunks() {
        let (_temp, repo_dir, repo_dir_str, original) = repo_with_two_drifted_lines();
        let (c_hunk, s_hunk) = two_drift_hunks(&repo_dir_str);

        restore_hunk(&repo_dir_str, "letters.txt", &c_hunk).unwrap();
        let content = fs::read_to_string(repo_dir.join("letters.txt")).unwrap();
        assert!(
            content.contains("\nc\n"),
            "this hunk's line reverts: {content}"
        );
        assert!(
            !content.contains('C'),
            "this hunk's change is gone: {content}"
        );
        assert!(
            content.contains('S'),
            "sibling hunk must survive: {content}"
        );

        restore_hunk(&repo_dir_str, "letters.txt", &s_hunk).unwrap();
        let content = fs::read_to_string(repo_dir.join("letters.txt")).unwrap();
        assert_eq!(content, original, "discarding every hunk restores HEAD");
    }

    #[test]
    fn test_commit_hunk_commits_one_hunk_and_keeps_sibling_hunks() {
        let (_temp, repo_dir, repo_dir_str, _original) = repo_with_two_drifted_lines();
        let (c_hunk, _s_hunk) = two_drift_hunks(&repo_dir_str);

        commit_hunk(&repo_dir_str, "letters.txt", &c_hunk, "change c only").unwrap();

        let head_content = run_git_ok(&repo_dir, &["show", "HEAD:letters.txt"]);
        assert!(head_content.contains("\nC\n"), "committed hunk is in HEAD");
        assert!(
            head_content.contains("\ns\n"),
            "sibling hunk stays out of HEAD"
        );

        let workdir_content = fs::read_to_string(repo_dir.join("letters.txt")).unwrap();
        assert!(
            workdir_content.contains('C') && workdir_content.contains('S'),
            "the working tree keeps both changes"
        );

        let remaining =
            crate::git::query::changes_since_ref(&repo_dir_str, "HEAD").expect("remaining diff");
        assert_eq!(remaining.len(), 1, "only the sibling hunk is left");
        assert!(remaining[0].diff.contains("+S"));
    }

    #[test]
    fn test_restore_hunk_removes_untracked_new_file() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial"]);

        fs::write(repo_dir.join("new.nix"), "{ fresh = true; }\n").unwrap();
        let hunks = crate::git::query::changes_since_ref(&repo_dir_str, "HEAD").expect("diff");
        assert_eq!(hunks.len(), 1);

        restore_hunk(&repo_dir_str, "new.nix", &hunks[0].diff).unwrap();

        assert!(!repo_dir.join("new.nix").exists(), "new file is removed");
        let repo = git2::Repository::open(&repo_dir).unwrap();
        let status = repo.statuses(None).expect("status");
        assert_eq!(status.len(), 0, "workdir is clean again");
    }

    #[test]
    fn test_restore_hunk_restores_a_deleted_file() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("gone.nix"), "{ keep = me; }\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial"]);
        fs::remove_file(repo_dir.join("gone.nix")).unwrap();

        let hunks = crate::git::query::changes_since_ref(&repo_dir_str, "HEAD").expect("diff");
        assert_eq!(hunks.len(), 1);

        restore_hunk(&repo_dir_str, "gone.nix", &hunks[0].diff).unwrap();

        assert_eq!(
            fs::read_to_string(repo_dir.join("gone.nix")).unwrap(),
            "{ keep = me; }\n",
            "deleted file's content is restored"
        );
    }

    #[test]
    fn test_commit_hunk_records_an_untracked_file() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial"]);

        fs::write(repo_dir.join("new.nix"), "{ fresh = true; }\n").unwrap();
        let hunks = crate::git::query::changes_since_ref(&repo_dir_str, "HEAD").expect("diff");

        commit_hunk(&repo_dir_str, "new.nix", &hunks[0].diff, "add new.nix").unwrap();

        assert_eq!(
            run_git_ok(&repo_dir, &["show", "HEAD:new.nix"]),
            "{ fresh = true; }\n"
        );
        assert_eq!(run_git_ok(&repo_dir, &["status", "--porcelain=v1"]), "");
    }

    #[test]
    fn test_commit_hunk_records_a_deleted_file() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("gone.nix"), "{ keep = me; }\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial"]);
        fs::remove_file(repo_dir.join("gone.nix")).unwrap();

        let hunks = crate::git::query::changes_since_ref(&repo_dir_str, "HEAD").expect("diff");
        assert_eq!(hunks.len(), 1);

        commit_hunk(&repo_dir_str, "gone.nix", &hunks[0].diff, "remove gone.nix").unwrap();

        assert!(
            !run_git(&repo_dir, &["cat-file", "-e", "HEAD:gone.nix"])
                .status
                .success(),
            "HEAD should record the deletion"
        );
        assert_eq!(run_git_ok(&repo_dir, &["status", "--porcelain=v1"]), "");
    }

    #[test]
    fn test_commit_hunk_commits_a_truncated_file_as_empty_not_deleted() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("truncated.nix"), "{ keep = me; }\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial"]);

        // Truncating a tracked file to zero bytes yields a whole-file removal
        // hunk even though the file still exists on disk.
        fs::write(repo_dir.join("truncated.nix"), "").unwrap();
        let hunks = crate::git::query::changes_since_ref(&repo_dir_str, "HEAD").expect("diff");
        assert_eq!(hunks.len(), 1);
        assert!(hunks[0].diff.starts_with("@@ -1,1 +0,0 @@"));

        commit_hunk(&repo_dir_str, "truncated.nix", &hunks[0].diff, "truncate").unwrap();

        assert_eq!(
            run_git_ok(&repo_dir, &["cat-file", "-p", "HEAD:truncated.nix"]),
            "",
            "HEAD keeps the file as an empty blob, not a deletion"
        );
        assert_eq!(
            fs::read_to_string(repo_dir.join("truncated.nix")).unwrap(),
            "",
            "the working tree file survives"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["status", "--porcelain=v1"]),
            "",
            "committed empty content matches the empty working tree"
        );
    }

    #[test]
    fn test_restore_hunk_repairs_the_index_for_staged_drift() {
        let (_temp, repo_dir, repo_dir_str, original) = repo_with_two_drifted_lines();
        // Stage both drifted lines so the drift rows come from the index.
        run_git_ok(&repo_dir, &["add", "-A"]);
        let (c_hunk, s_hunk) = two_drift_hunks(&repo_dir_str);

        restore_hunk(&repo_dir_str, "letters.txt", &c_hunk).unwrap();
        let content = fs::read_to_string(repo_dir.join("letters.txt")).unwrap();
        assert!(
            !content.contains('C'),
            "this hunk's line reverts: {content}"
        );
        assert!(content.contains('S'), "sibling hunk survives: {content}");

        let repo = git2::Repository::open(&repo_dir).unwrap();
        let statuses = repo.statuses(None).unwrap();
        assert_eq!(statuses.len(), 1, "only the sibling hunk remains");
        let status = statuses.get(0).unwrap().status();
        assert!(
            status.is_index_modified() && !status.is_wt_modified(),
            "the index is repaired to match the restored working tree"
        );

        restore_hunk(&repo_dir_str, "letters.txt", &s_hunk).unwrap();
        assert_eq!(
            fs::read_to_string(repo_dir.join("letters.txt")).unwrap(),
            original,
            "discarding every staged hunk restores HEAD"
        );
        let statuses = repo.statuses(None).unwrap();
        assert_eq!(
            statuses.len(),
            0,
            "no staged residue keeps the drift row alive"
        );
    }

    #[test]
    fn test_restore_hunk_of_a_staged_deletion_restores_the_index_entry() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("gone.nix"), "{ keep = me; }\n").unwrap();
        run_git_ok(&repo_dir, &["add", "-A"]);
        run_git_ok(&repo_dir, &["commit", "-m", "initial"]);
        // `git rm` stages the deletion and removes the file from the worktree.
        run_git_ok(&repo_dir, &["rm", "gone.nix"]);

        let hunks = crate::git::query::changes_since_ref(&repo_dir_str, "HEAD").expect("diff");
        assert_eq!(hunks.len(), 1);

        restore_hunk(&repo_dir_str, "gone.nix", &hunks[0].diff).unwrap();

        assert_eq!(
            fs::read_to_string(repo_dir.join("gone.nix")).unwrap(),
            "{ keep = me; }\n",
            "deleted file's content is restored"
        );
        assert_eq!(
            run_git_ok(&repo_dir, &["status", "--porcelain=v1"]),
            "",
            "the staged deletion is repaired along with the working tree"
        );
    }

    #[test]
    fn test_restore_hunk_errors_when_the_hunk_no_longer_matches() {
        let (_temp, repo_dir, repo_dir_str, _original) = repo_with_two_drifted_lines();
        let (c_hunk, _s_hunk) = two_drift_hunks(&repo_dir_str);

        // The sibling hunk's discard changes line positions; the stale hunk
        // body no longer matches, which must fail loudly instead of corrupting.
        restore_hunk(&repo_dir_str, "letters.txt", &c_hunk).unwrap();
        fs::write(repo_dir.join("letters.txt"), "completely\nrewritten\n").unwrap();

        assert!(restore_hunk(&repo_dir_str, "letters.txt", &c_hunk).is_err());
    }
}
