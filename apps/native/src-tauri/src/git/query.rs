/// Git query layer (SAFE)
///
/// This module uses git2 exclusively.
///
/// Rules:
/// - NO filesystem modification
/// - NO index mutation
/// - NO working tree changes
/// - ONLY Git object graph inspection
///
/// Basically, only things that don't depend on git porcelain output and/or
/// git CLI semantics.
use std::path::PathBuf;

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

/// Returns true if `dir` is inside a non-bare Git working tree.
/// This behaves similarly to:
///     git rev-parse --is-inside-work-tree
///
/// The key point is that a bare repository does not have a working tree.
pub fn is_repo(dir: &str) -> bool {
    git2::Repository::discover(dir)
        .map(|repo| repo.workdir().is_some())
        .unwrap_or(false)
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

/// Gets the SHA of the current HEAD commit.
pub fn get_head_sha(dir: &str) -> Option<String> {
    get_ref_sha(dir, "HEAD")
}

/// Returns true if HEAD can be resolved to a commit object.
///
/// This is stricter than "HEAD exists":
/// it ensures HEAD ultimately points to a commit that can be diffed.
/// Therefore it fixes a bug in the old version that used GitCommand.
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

#[cfg(test)]
mod tests {
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
    fn is_repo_detects_nested_worktree_path() {
        let (temp, _) = repo_with_initial_commit();
        let nested = temp.path().join("nested");
        fs::create_dir_all(&nested).expect("create nested dir");

        assert!(is_repo(&nested.to_string_lossy()));
    }

    #[test]
    fn is_repo_false_for_non_repo_and_bare_repo() {
        let temp = TempDir::new().expect("create temp dir");
        assert!(!is_repo(&temp.path().to_string_lossy()));

        let bare_dir = temp.path().join("bare.git");
        git2::Repository::init_bare(&bare_dir).expect("init bare repo");
        assert!(!is_repo(&bare_dir.to_string_lossy()));
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
        assert_eq!(get_head_sha(&path), Some(commit_id.to_string()));
        assert_eq!(get_ref_sha(&path, "does-not-exist"), None);
    }

    #[test]
    fn get_ref_sha_and_head_sha_none_for_non_repo() {
        let temp = TempDir::new().expect("create temp dir");
        let path = temp.path().to_string_lossy().to_string();

        assert_eq!(get_ref_sha(&path, "HEAD"), None);
        assert_eq!(get_head_sha(&path), None);
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
}
