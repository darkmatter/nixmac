use std::path::PathBuf;

use anyhow::Result;
use git2::{DiffOptions, Oid, Repository};
use tauri::AppHandle;

use crate::{
    git::{FileDiff, file_diff_to_change, init::require_repo, is_sensitive_or_opaque},
    shared_types::{ChangeType, GitFileStatus, GitStatus},
};

/// Used to track the state of a file as we build up its diff, since git2 processing
/// uses the metadata and content in separate passes.
struct FileState {
    diff: String,
    line_count: i64,
    is_binary: bool,
    last_hunk_key: Option<(usize, usize)>,
}

/// Interhunk lines controls whether nearby changes are grouped together in the same hunk.
/// It's normally 0 by default in the git CLI but we'll use 1 to be more aggressive about grouping
/// nearby changes together, which should help with summarization quality (our main use case).
const INTERHUNK_LINES: u32 = 1;

/// Context lines controls how many unchanged lines are included around each change.
/// It's normally 3 by default in the git CLI but we'll increase it a bit to give
/// the agent more context for summarization, especially for changes in the middle of files.
const CONTEXT_LINES: u32 = 5;

fn default_diff_opts() -> DiffOptions {
    let mut opts = DiffOptions::new();
    opts.show_binary(true);
    opts.context_lines(CONTEXT_LINES);
    opts.interhunk_lines(INTERHUNK_LINES);
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);
    opts.show_untracked_content(true);
    opts
}

/// Map git2 change types to our internal representation.
fn map_change_type(delta: git2::Delta) -> ChangeType {
    match delta {
        git2::Delta::Added => ChangeType::New,
        git2::Delta::Deleted => ChangeType::Removed,
        git2::Delta::Modified => ChangeType::Edited,
        git2::Delta::Renamed => ChangeType::Renamed,
        git2::Delta::Copied => ChangeType::Renamed,
        _ => ChangeType::Edited,
    }
}

// Git query layer (SAFE)
//
// This module uses git2 exclusively.
//
// Rules:
// - NO filesystem modification
// - NO index mutation
// - NO working tree changes
// - ONLY Git object graph inspection
//
// Basically, only things that don't depend on git porcelain output and/or
// git CLI semantics.

/// Gets the git repository root directory for `dir`, or `dir` if not in a repo.
/// Used for resolving file paths for the benefit of tools and git operations.
pub fn repo_root(dir: &str) -> PathBuf {
    match git2::Repository::discover(dir) {
        Ok(repo) => {
            // workdir() is the equivalent of "show-toplevel"
            // but returns None for bare repositories
            repo.workdir()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from(dir))
        }
        Err(_) => PathBuf::from(dir),
    }
}

/// Returns the current branch name (None if detached HEAD or not a repo).
///
/// This is equivalent to:
///     git rev-parse --abbrev-ref HEAD
pub fn current_branch(dir: &str) -> Option<String> {
    let repo = git2::Repository::discover(dir).ok()?;

    let head = repo.head().ok()?;

    let name = head.shorthand().ok()?;

    match name {
        "HEAD" => None,
        other => Some(other.to_string()),
    }
}

/// Resolves a Git reference (branch, tag, HEAD, or full ref name) to its commit SHA.
///
/// This is the git2 equivalent of:
///     git rev-parse <ref_name>
///
/// Behavior:
/// - Returns `Some(sha)` if the reference resolves successfully
/// - Returns `None` if:
///   - the directory is not a Git repository
///   - the reference does not exist
///   - the reference cannot be resolved to an object
pub fn get_ref_sha(dir: &str, ref_name: &str) -> Option<String> {
    let repo = git2::Repository::discover(dir).ok()?;

    let obj = repo.revparse_single(ref_name).ok()?;

    // id is the sha that we want.
    Some(obj.id().to_string())
}

/// Returns the commit a nixmac backup branch was snapshotted from — the
/// backup commit's first parent (`create_evolution_backup` commits the
/// snapshot with HEAD as its sole parent). `None` when the branch is missing
/// or doesn't point at a commit with a parent.
///
/// A session's backup is only meaningful while HEAD still equals this
/// anchor: once the repository gains commits nixmac didn't make, restoring
/// the snapshot would silently revert them.
pub fn backup_anchor_commit(dir: &str, branch_name: &str) -> Option<String> {
    let repo = git2::Repository::discover(dir).ok()?;
    let obj = repo
        .revparse_single(&format!("refs/heads/{branch_name}"))
        .ok()?;
    let commit = obj.peel_to_commit().ok()?;
    commit.parent(0).ok().map(|parent| parent.id().to_string())
}

/// Returns true if HEAD can be resolved to a commit object.
///
/// This is stricter than "HEAD exists":
/// it ensures HEAD ultimately points to a commit that can be diffed.
///
/// Equivalent intent:
///     git rev-parse --verify HEAD
/// but with explicit commit resolution instead of string-level validation.
pub fn has_head_commit(dir: &str) -> bool {
    match git2::Repository::discover(dir) {
        Ok(repo) => repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .is_some(),
        Err(_) => false,
    }
}

/// Returns all tags pointing at `hash`.
///
/// Replaces:
///   git tag --points-at <hash>
///
/// Semantics:
/// - Returns tag names whose resolved object matches the given commit/object hash
/// - Includes both lightweight and annotated tags (annotated tags are peeled)
///
/// QUERY LAYER (git2, read-only)
pub fn read_tags(dir: &str, hash: &str) -> Vec<String> {
    let Ok(repo) = git2::Repository::discover(dir) else {
        return vec![];
    };

    let Ok(oid) = git2::Oid::from_str(hash) else {
        return vec![];
    };

    let Ok(target_obj) = repo.find_object(oid, None) else {
        return vec![];
    };

    let Ok(references) = repo.references() else {
        return vec![];
    };

    let mut tags = Vec::new();

    for reference in references.flatten() {
        let Ok(name) = reference.name() else {
            continue;
        };

        if !name.starts_with("refs/tags/") {
            continue;
        }

        let Ok(resolved) = reference.peel(git2::ObjectType::Any) else {
            continue;
        };

        if resolved.id() == target_obj.id() {
            if let Ok(name) = reference.shorthand() {
                tags.push(name.to_string());
            }
        }
    }

    tags
}

/// Returns commits as Row Type (id = 0), from `start_hash` for `limit` (None for all).
///
/// Equivalent CLI:
///   git log --format=%H%n%T%n%at%n%s [-n <limit>] <start_hash>
pub fn log(
    dir: &str,
    start_hash: &str,
    limit: Option<usize>,
) -> Result<Vec<crate::sqlite_types::Commit>> {
    let repo = Repository::discover(dir)?;
    let commit = repo.revparse_single(start_hash)?.peel_to_commit()?;

    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(git2::Sort::TIME)?;
    revwalk.push(commit.id())?;

    let mut commits = Vec::new();
    for oid in revwalk.take(limit.unwrap_or(usize::MAX)) {
        let commit = repo.find_commit(oid?)?;
        let subject = commit.summary().unwrap_or_default().unwrap_or_default();

        commits.push(crate::sqlite_types::Commit {
            id: 0,
            hash: commit.id().to_string(),
            tree_hash: commit.tree_id().to_string(),
            message: (!subject.is_empty()).then(|| subject.to_string()),
            created_at: commit.time().seconds(),
        });
    }

    Ok(commits)
}

/// Returns structured FileDiffs representing the changes between `base_ref` and the working tree.
/// We use this to feed change details to summarization for uncommitted changes since
/// an arbitrary reference point (e.g. last commit, last push, evolution start, etc).
pub fn changes_since_ref(dir: &str, base_ref: &str) -> Result<Vec<FileDiff>> {
    require_repo(dir)?;
    let repo = Repository::discover(dir)?;
    let reference = repo.revparse_single(base_ref)?;
    let reference_tree = reference.peel_to_tree()?;

    let mut diff_opts = default_diff_opts();
    let diff = repo.diff_tree_to_workdir_with_index(Some(&reference_tree), Some(&mut diff_opts))?;

    run_diff_engine(diff)
}

/// Gets the current git status of the repo including
/// the structured list of changes for summarization and the full diff string for clients that need it.
pub fn status(dir: &str) -> Result<GitStatus> {
    require_repo(dir)?;
    let repo = git2::Repository::discover(dir)?;

    let branch = super::current_branch(dir);

    let head_commit_hash = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map(|oid| oid.to_string());

    let head_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .and_then(|c| c.tree().ok());

    // ------------------------------------------------------------
    // Get the raw diff object for HEAD vs working directory, including untracked files.
    // ------------------------------------------------------------
    let mut diff_opts = default_diff_opts();
    let diff = repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))?;
    let stats = diff.stats()?;

    let additions = stats.insertions();
    let deletions = stats.deletions();

    let mut files = Vec::new();

    // ------------------------------------------------------------
    // Get the file-level metadata for the changed files,
    // and also compute aggregate stats like total additions/deletions.
    // ------------------------------------------------------------
    diff.foreach(
        &mut |delta, _| {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();

            files.push(GitFileStatus {
                path,
                change_type: map_change_type(delta.status()),
            });

            true
        },
        None,
        None,
        None,
    )?;

    // ------------------------------------------------------------
    // Get the full patch string, the summarizer needs it.
    // ------------------------------------------------------------
    let mut diff_string = String::new();
    diff.print(git2::DiffFormat::Patch, |_d, _h, line| {
        // Prepend the +/-/space origin marker for body lines. File ('F') and
        // hunk ('H') headers already carry their prefix in `line.content()`,
        // so they fall through without an added char — matching `git diff`.
        match line.origin() {
            '+' | '-' | ' ' => diff_string.push(line.origin()),
            _ => {}
        }
        diff_string.push_str(std::str::from_utf8(line.content()).unwrap_or_default());
        true
    })?;

    // ------------------------------------------------------------
    // Reuse the existing diff engine for structured FileDiffs.
    // ------------------------------------------------------------
    let changes = run_diff_engine(diff)?;

    // ------------------------------------------------------------
    // Compute final state
    // ------------------------------------------------------------
    let clean_head = files.is_empty();

    Ok(GitStatus {
        files,
        branch,
        additions,
        deletions,
        head_commit_hash,
        clean_head,
        changes: changes
            .into_iter()
            .map(|d| file_diff_to_change(d, 0, false))
            .collect(),
        diff: diff_string,
    })
}

/// Gets status and records it in the git-state cell (which notifies the frontend).
pub fn status_and_cache<R: tauri::Runtime>(dir: &str, app: &AppHandle<R>) -> Result<GitStatus> {
    let status = status(dir)?;
    crate::state::git_state::update_status(app, status.clone());
    Ok(status)
}

/// Gets the FileDiffs that represent the evolution results between two commits.
pub fn commit_diff(dir: &str, parent_hash: &str, commit_hash: &str) -> Result<Vec<FileDiff>> {
    let repo = Repository::discover(dir)?;

    let parent = repo.find_commit(Oid::from_str(parent_hash)?)?;
    let commit = repo.find_commit(Oid::from_str(commit_hash)?)?;

    let parent_tree = parent.tree()?;
    let commit_tree = commit.tree()?;

    let diff = repo.diff_tree_to_tree(
        Some(&parent_tree),
        Some(&commit_tree),
        Some(&mut default_diff_opts()),
    )?;

    run_diff_engine(diff)
}

/// Internal helper function to run the "diff engine" (delta + patch parsing) and produce structured FileDiffs.
fn run_diff_engine(diff: git2::Diff) -> Result<Vec<FileDiff>> {
    let mut files: Vec<FileDiff> = Vec::new();

    let mut state: std::collections::HashMap<String, FileState> = std::collections::HashMap::new();

    // -------------------------
    // 1. Delta pass (file metadata)
    // First we iterate over the deltas to get file-level metadata and filter out sensitive/opaque files.
    // -------------------------
    diff.foreach(
        &mut |delta, _| {
            let old_path = delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned());
            let new_path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned());

            files.push(FileDiff {
                old_path: old_path.clone(),
                new_path: new_path.clone(),
                diff: String::new(),
                line_count: 0,
            });

            true
        },
        None,
        None,
        None,
    )?;

    // -------------------------
    // 2. Patch pass (content)
    // For individual file diffs, assemble the full patch text and line count by matching on file paths.
    // -------------------------
    diff.print(git2::DiffFormat::Patch, |delta, hunk, line| {
        let filename = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();

        let entry = state.entry(filename).or_insert(FileState {
            diff: String::new(),
            line_count: 0,
            last_hunk_key: None,
            is_binary: delta.flags().contains(git2::DiffFlags::BINARY),
        });

        let content = std::str::from_utf8(line.content()).unwrap_or_default();

        // -----------------------------------
        // Insert hunk header (once per hunk)
        // -----------------------------------
        if let Some(h) = hunk {
            let key: (usize, usize) = (h.old_start() as usize, h.new_start() as usize);

            if entry.last_hunk_key != Some(key) {
                entry.last_hunk_key = Some(key);

                entry.diff.push_str(&format!(
                    "@@ -{},{} +{},{} @@\n",
                    h.old_start(),
                    h.old_lines(),
                    h.new_start(),
                    h.new_lines()
                ));
            }
        }

        // -----------------------------------
        // Actual line content (with origin prefix if necessary)
        // -----------------------------------
        match line.origin() {
            '+' => {
                entry.diff.push('+');
                entry.diff.push_str(content);
                entry.line_count += 1;
            }
            '-' => {
                entry.diff.push('-');
                entry.diff.push_str(content);
                entry.line_count += 1;
            }
            ' ' => {
                entry.diff.push(' ');
                entry.diff.push_str(content);
            }
            _ => {}
        }

        true
    })?;

    // -------------------------
    // 3. Merge and filter-sensitive files pass
    // Now merge the structured delta info with the patch text and line counts to produce final FileDiffs.
    // -------------------------
    let mut result = Vec::new();

    for f in files {
        let key = f
            .new_path
            .as_deref()
            .or(f.old_path.as_deref())
            .unwrap_or("");

        if let Some(s) = state.remove(key) {
            if is_sensitive_or_opaque(key, &s.diff, s.is_binary) {
                continue;
            }

            result.push(FileDiff {
                old_path: f.old_path,
                new_path: f.new_path,
                diff: s.diff,
                line_count: s.line_count,
            });
        }
    }

    Ok(result)
}

/// Returns (original, modified) file content for a single file: HEAD content and working-tree content.
/// Returns empty strings for new files (no HEAD) or deleted files (not on disk).
pub fn file_diff_contents(dir: &str, filename: &str) -> (String, String) {
    // Make sure that the path cannot escape the repository, even with weird path components like ".." or symlinks.
    // If it does, we fail closed and return empty content to avoid potential security issues.
    let Some(path) = super::repo_files::normalize_repo_relative_path_lexically(filename) else {
        return (String::new(), String::new());
    };

    let Ok(repo) = Repository::discover(dir) else {
        return (String::new(), String::new());
    };

    (
        super::repo_files::head_file_contents(&repo, &path),
        super::repo_files::workdir_file_contents(&repo, &path),
    )
}

#[cfg(test)]
mod tests {
    use crate::git::init::init_repo;

    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn repo_with_initial_commit() -> (TempDir, git2::Oid) {
        let temp = TempDir::new().expect("create temp dir");
        let repo = git2::Repository::init(temp.path()).expect("init repo");

        fs::write(temp.path().join("README.md"), "hello\n").expect("write file");

        let mut index = repo.index().expect("open index");
        index.add_path(Path::new("README.md")).expect("stage file");
        index.write().expect("write index");

        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let sig = git2::Signature::now("nixmac", "nixmac@local").expect("signature");

        let commit_id = repo
            .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .expect("create commit");

        (temp, commit_id)
    }

    fn commit_readme(
        repo: &git2::Repository,
        repo_path: &Path,
        message: &str,
        timestamp: i64,
        parent: Option<git2::Oid>,
    ) -> git2::Oid {
        fs::write(repo_path.join("README.md"), format!("{message}\n")).expect("write file");

        let mut index = repo.index().expect("open index");
        index.add_path(Path::new("README.md")).expect("stage file");
        index.write().expect("write index");

        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let time = git2::Time::new(timestamp, 0);
        let sig = git2::Signature::new("nixmac", "nixmac@local", &time).expect("signature");

        if let Some(parent_id) = parent {
            let parent_commit = repo.find_commit(parent_id).expect("find parent");
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent_commit])
                .expect("create commit")
        } else {
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[])
                .expect("create commit")
        }
    }

    #[test]
    fn repo_root_returns_repo_toplevel_for_nested_path() {
        let (temp, _) = repo_with_initial_commit();
        let nested = temp.path().join("a/b/c");
        fs::create_dir_all(&nested).expect("create nested dir");

        let root = repo_root(&nested.to_string_lossy());
        let root_canon = root.canonicalize().expect("canonicalize repo root");
        let expected_canon = temp.path().canonicalize().expect("canonicalize temp path");
        assert_eq!(root_canon, expected_canon);
    }

    #[test]
    fn repo_root_returns_input_when_not_a_repo() {
        let temp = TempDir::new().expect("create temp dir");
        let input = temp.path().join("not-a-repo");

        let root = repo_root(&input.to_string_lossy());
        assert_eq!(root, input);
    }

    #[test]
    fn repo_root_returns_input_for_bare_repo() {
        let temp = TempDir::new().expect("create temp dir");
        let bare_dir = temp.path().join("bare.git");
        git2::Repository::init_bare(&bare_dir).expect("init bare repo");

        assert_eq!(repo_root(&bare_dir.to_string_lossy()), bare_dir);
    }

    #[test]
    fn current_branch_some_on_branch_and_none_when_detached() {
        let (temp, commit_id) = repo_with_initial_commit();
        let path = temp.path().to_string_lossy().to_string();

        let branch = current_branch(&path);
        assert!(
            branch.is_some(),
            "expected branch name when HEAD is attached"
        );

        let repo = git2::Repository::discover(&path).expect("discover repo");
        repo.set_head_detached(commit_id).expect("detach head");

        assert_eq!(current_branch(&path), None);
    }

    #[test]
    fn current_branch_none_for_non_repo() {
        let temp = TempDir::new().expect("create temp dir");
        assert_eq!(current_branch(&temp.path().to_string_lossy()), None);
    }

    #[test]
    fn get_ref_sha_and_head_sha_resolve_head_commit() {
        let (temp, commit_id) = repo_with_initial_commit();
        let path = temp.path().to_string_lossy().to_string();

        assert_eq!(get_ref_sha(&path, "HEAD"), Some(commit_id.to_string()));
        assert_eq!(get_ref_sha(&path, "does-not-exist"), None);
    }

    #[test]
    fn get_ref_sha_unborn_branch_is_none() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path();

        let repo = git2::Repository::init(path).unwrap();

        // explicitly create a branch so HEAD exists but is unborn
        repo.set_head("refs/heads/main").unwrap();

        let repo_path = path.to_string_lossy().to_string();

        let head = get_ref_sha(&repo_path, "HEAD");

        assert_eq!(head, None);
    }

    #[test]
    fn get_ref_sha_none_for_non_repo() {
        let temp = TempDir::new().expect("create temp dir");
        let path = temp.path().to_string_lossy().to_string();

        assert_eq!(get_ref_sha(&path, "HEAD"), None);
        assert_eq!(get_ref_sha(&path, "does-not-exist"), None);
    }

    #[test]
    fn get_ref_sha_resolves_tag_refs() {
        let (temp, commit_id) = repo_with_initial_commit();
        let path = temp.path().to_string_lossy().to_string();
        let repo = git2::Repository::discover(&path).expect("discover repo");

        let commit = repo.find_commit(commit_id).expect("find commit");
        repo.tag_lightweight("v2.0.0", commit.as_object(), false)
            .expect("create lightweight tag");

        assert_eq!(
            get_ref_sha(&path, "refs/tags/v2.0.0"),
            Some(commit_id.to_string())
        );
        assert_eq!(get_ref_sha(&path, "v2.0.0"), Some(commit_id.to_string()));
    }

    #[test]
    fn has_head_commit_reflects_unborn_and_committed_repo() {
        let temp = TempDir::new().expect("create temp dir");
        let repo = git2::Repository::init(temp.path()).expect("init repo");
        let path = temp.path().to_string_lossy().to_string();

        assert!(!has_head_commit(&path));

        fs::write(temp.path().join("flake.nix"), "{ }\n").expect("write file");
        let mut index = repo.index().expect("open index");
        index.add_path(Path::new("flake.nix")).expect("stage file");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let sig = git2::Signature::now("nixmac", "nixmac@local").expect("signature");
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .expect("create commit");

        assert!(has_head_commit(&path));
    }

    #[test]
    fn has_head_commit_false_for_non_repo() {
        let temp = TempDir::new().expect("create temp dir");
        assert!(!has_head_commit(&temp.path().to_string_lossy()));
    }

    #[test]
    fn read_tags_returns_lightweight_and_annotated_tags_for_commit() {
        let (temp, commit_id) = repo_with_initial_commit();
        let path = temp.path().to_string_lossy().to_string();
        let repo = git2::Repository::discover(&path).expect("discover repo");

        let commit = repo.find_commit(commit_id).expect("find commit");
        repo.tag_lightweight("v1.0.0", commit.as_object(), false)
            .expect("create lightweight tag");

        let obj = repo
            .find_object(commit_id, None)
            .expect("find commit object");
        let sig = git2::Signature::now("nixmac", "nixmac@local").expect("signature");
        repo.tag("v1.0.1", &obj, &sig, "annotated", false)
            .expect("create annotated tag");

        let mut tags = read_tags(&path, &commit_id.to_string());
        tags.sort();
        assert_eq!(tags, vec!["v1.0.0".to_string(), "v1.0.1".to_string()]);

        assert!(read_tags(&path, "not-a-sha").is_empty());
    }

    #[test]
    fn read_tags_empty_when_repo_has_no_tags_or_mismatched_target() {
        let (temp, first_commit_id) = repo_with_initial_commit();
        let path = temp.path().to_string_lossy().to_string();
        let repo = git2::Repository::discover(&path).expect("discover repo");

        assert!(read_tags(&path, &first_commit_id.to_string()).is_empty());

        fs::write(temp.path().join("README.md"), "hello again\n").expect("write file");
        let mut index = repo.index().expect("open index");
        index.add_path(Path::new("README.md")).expect("stage file");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let sig = git2::Signature::now("nixmac", "nixmac@local").expect("signature");
        let parent = repo
            .find_commit(first_commit_id)
            .expect("find parent commit");
        let second_commit_id = repo
            .commit(Some("HEAD"), &sig, &sig, "second", &tree, &[&parent])
            .expect("create second commit");

        let second_commit = repo
            .find_commit(second_commit_id)
            .expect("find second commit");
        repo.tag_lightweight("v9.9.9", second_commit.as_object(), false)
            .expect("create lightweight tag");

        let tags_for_first = read_tags(&path, &first_commit_id.to_string());
        assert!(
            tags_for_first.is_empty(),
            "first commit should not include tags pointing at second commit"
        );
    }

    #[test]
    fn read_tags_empty_when_hash_oid_is_valid_but_object_missing() {
        let (temp, _) = repo_with_initial_commit();
        let path = temp.path().to_string_lossy().to_string();

        let missing_oid = "0000000000000000000000000000000000000001";
        assert!(read_tags(&path, missing_oid).is_empty());
    }

    #[test]
    fn log_returns_commits_from_start_hash_with_limit() {
        let temp = TempDir::new().expect("create temp dir");
        let repo = git2::Repository::init(temp.path()).expect("init repo");
        let path = temp.path().to_string_lossy().to_string();

        let first_id = commit_readme(&repo, temp.path(), "initial", 100, None);
        let second_id = commit_readme(&repo, temp.path(), "second", 200, Some(first_id));
        let third_id = commit_readme(&repo, temp.path(), "third", 300, Some(second_id));

        let commits = log(&path, &third_id.to_string(), Some(2)).expect("read log");

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].hash, third_id.to_string());
        assert_eq!(commits[0].message, Some("third".to_string()));
        assert_eq!(commits[0].created_at, 300);
        assert_eq!(
            commits[0].tree_hash,
            repo.find_commit(third_id).unwrap().tree_id().to_string()
        );

        assert_eq!(commits[1].hash, second_id.to_string());
        assert_eq!(commits[1].message, Some("second".to_string()));
        assert_eq!(commits[1].created_at, 200);
    }

    #[test]
    fn test_status() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();
        // commit_all to materialize a branch
        fs::write(repo_dir.join("flake.nix"), "{ }").unwrap();
        crate::git::commit_all(&repo_dir_str, "chore: initial nix-darwin configuration").unwrap();
        // Now add an uncommitted change to inspect.
        fs::write(repo_dir.join("flake.nix"), "{ inputs = {}; }").unwrap();
        let status = status(&repo_dir_str).unwrap();
        assert!(!status.files.is_empty());
        assert!(status.branch.is_some());
    }

    #[test]
    fn test_status_diff_preserves_line_origin_markers() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        // Commit a known three-line file.
        fs::write(repo_dir.join("file.txt"), "line1\nline2\nline3\n").unwrap();
        crate::git::commit_all(&repo_dir_str, "chore: initial").unwrap();

        // Change the middle line and stage it.
        fs::write(repo_dir.join("file.txt"), "line1\nLINE2\nline3\n").unwrap();
        let repo = git2::Repository::open(&repo_dir).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("file.txt")).unwrap();
        index.write().unwrap();

        let status = status(&repo_dir_str).unwrap();

        // Body lines must carry their +/- origin marker so consumers can tell
        // additions from deletions (regression: markers were being dropped).
        assert!(
            status.diff.contains("-line2\n"),
            "diff should mark the deleted line with '-':\n{}",
            status.diff
        );
        assert!(
            status.diff.contains("+LINE2\n"),
            "diff should mark the added line with '+':\n{}",
            status.diff
        );
        // Context lines keep their leading space; the bare, unmarked deleted
        // line must not appear.
        assert!(
            !status.diff.contains("\nline2\n"),
            "deleted line must not appear without an origin marker:\n{}",
            status.diff
        );
    }

    #[test]
    fn test_status_without_head_commit_with_untracked_file() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }").unwrap();

        let status = status(&repo_dir_str).unwrap();
        assert!(!status.clean_head);
        assert!(status.head_commit_hash.is_none());
        assert!(status.files.iter().any(|f| f.path == "flake.nix"));
    }

    #[test]
    fn test_status_without_head_commit_with_staged_file() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();

        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }").unwrap();

        // Equivalent to: git add -A
        let repo = git2::Repository::open(&repo_dir).unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_all(["."], git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();

        let status = status(&repo_dir_str).unwrap();

        assert!(!status.clean_head);
        assert!(status.head_commit_hash.is_none());
        assert!(status.files.iter().any(|f| f.path == "flake.nix"));
    }

    #[test]
    fn test_status_includes_untracked_file_from_nested_config_dir() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();

        init_repo(&repo_dir_str).unwrap();

        let config_dir = repo_dir.join("nixmac");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(config_dir.join("flake.nix"), "{ }").unwrap();

        let status = status(&repo_dir_str).unwrap();

        assert!(!status.clean_head);
        assert!(status.head_commit_hash.is_none());
        assert!(status.files.iter().any(|f| f.path == "nixmac/flake.nix"));
    }

    #[test]
    fn test_status_excludes_gitignored_file() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();

        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join(".gitignore"), "secret.txt\n").unwrap();
        fs::write(repo_dir.join("secret.txt"), "top secret\n").unwrap();

        let status = status(&repo_dir_str).unwrap();

        assert!(status.files.iter().all(|f| f.path != "secret.txt"));
    }

    #[test]
    fn test_map_change_type() {
        assert_eq!(map_change_type(git2::Delta::Added), ChangeType::New);
        assert_eq!(map_change_type(git2::Delta::Deleted), ChangeType::Removed);
        assert_eq!(map_change_type(git2::Delta::Modified), ChangeType::Edited);
        assert_eq!(map_change_type(git2::Delta::Renamed), ChangeType::Renamed);
        assert_eq!(map_change_type(git2::Delta::Copied), ChangeType::Renamed);
        // Other types should default to Edited
        assert_eq!(map_change_type(git2::Delta::Unmodified), ChangeType::Edited);
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
    fn test_file_diff_contents_reads_head_and_worktree_with_git2() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();
        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        crate::git::commit_all(&repo_dir_str, "initial").unwrap();
        fs::write(repo_dir.join("flake.nix"), "{ inputs = {}; }\n").unwrap();

        let (original, modified) = file_diff_contents(&repo_dir_str, "./flake.nix");

        assert_eq!(original, "{ }\n");
        assert_eq!(modified, "{ inputs = {}; }\n");
    }

    #[test]
    fn changes_since_ref_includes_uncommitted_worktree_changes_since_base_ref() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();

        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        crate::git::commit_all(&repo_dir_str, "initial").unwrap();

        let repo = git2::Repository::discover(&repo_dir_str).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("evolution-start", &head, false).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ inputs = {}; }\n").unwrap();

        let diffs = changes_since_ref(&repo_dir_str, "evolution-start").unwrap();

        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].new_path.as_deref(), Some("flake.nix"));
        assert!(diffs[0].diff.contains("+{ inputs = {}; }"));
    }

    #[test]
    fn changes_since_ref_includes_untracked_files_since_base_ref() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();

        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        crate::git::commit_all(&repo_dir_str, "initial").unwrap();

        let repo = git2::Repository::discover(&repo_dir_str).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("evolution-start", &head, false).unwrap();

        fs::write(repo_dir.join("new-module.nix"), "{ config, ... }: { }\n").unwrap();

        let diffs = changes_since_ref(&repo_dir_str, "evolution-start").unwrap();

        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].new_path.as_deref(), Some("new-module.nix"));
        assert!(diffs[0].diff.contains("+{ config, ... }: { }"));
    }

    #[test]
    fn changes_since_ref_includes_cumulative_changes_after_head_moves() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();

        init_repo(&repo_dir_str).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ }\n").unwrap();
        crate::git::commit_all(&repo_dir_str, "initial").unwrap();

        let repo = git2::Repository::discover(&repo_dir_str).unwrap();
        let start = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("evolution-start", &start, false).unwrap();

        fs::write(repo_dir.join("flake.nix"), "{ inputs = {}; }\n").unwrap();
        crate::git::commit_all(&repo_dir_str, "intermediate").unwrap();

        fs::write(repo_dir.join("home.nix"), "{ pkgs, ... }: { }\n").unwrap();

        let diffs = changes_since_ref(&repo_dir_str, "evolution-start").unwrap();

        let paths: Vec<_> = diffs
            .iter()
            .map(|d| d.new_path.as_deref().unwrap_or_default())
            .collect();

        assert!(paths.contains(&"flake.nix"));
        assert!(paths.contains(&"home.nix"));
    }

    #[test]
    fn changes_since_ref_errors_for_invalid_base_ref() {
        let (temp, _) = repo_with_initial_commit();
        let path = temp.path().to_string_lossy().to_string();

        let result = changes_since_ref(&path, "does-not-exist");

        assert!(result.is_err());
    }
}
