use std::path::{Component, Path, PathBuf};

use git2::Repository;

/// Normalizes a repository-relative file path, ensuring it is not absolute and does not escape the repository.
/// NOTE that it checks the path/string components only, not the actual filesystem under a repo.
pub fn normalize_repo_relative_path_lexically(filename: &str) -> Option<PathBuf> {
    let path = Path::new(filename);
    if path.is_absolute() {
        return None;
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::Prefix(_) | Component::RootDir => return None,
        }
    }

    Some(normalized)
}

/// Reads the contents of a file at the given path from the HEAD commit of the repository.
/// Returns an empty string if the file does not exist in HEAD or if there is no HEAD commit.
pub fn head_file_contents(repo: &Repository, path: &Path) -> String {
    repo.head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok())
        .and_then(|commit| commit.tree().ok())
        .and_then(|tree| tree.get_path(path).ok().map(|entry| entry.id()))
        .and_then(|id| repo.find_blob(id).ok())
        .map(|blob| String::from_utf8_lossy(blob.content()).into_owned())
        .unwrap_or_default()
}

/// Reads the contents of a file at the given path from the working directory of the repository.
/// Returns an empty string if the file does not exist on disk.
pub fn workdir_file_contents(repo: &Repository, path: &Path) -> String {
    let Some(workdir) = repo.workdir() else {
        return String::new();
    };

    let full_path = workdir.join(path);
    let Ok(metadata) = std::fs::symlink_metadata(&full_path) else {
        return String::new();
    };

    if metadata.file_type().is_symlink() {
        return std::fs::read_link(&full_path)
            .map(|target| target.to_string_lossy().into_owned())
            .unwrap_or_default();
    }

    let Ok(workdir_canonical) = workdir.canonicalize() else {
        return String::new();
    };
    let Ok(full_path_canonical) = full_path.canonicalize() else {
        return String::new();
    };

    if !full_path_canonical.starts_with(workdir_canonical) {
        return String::new();
    }

    std::fs::read_to_string(full_path_canonical).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn commit_file(repo: &Repository, path: &Path, contents: &str, message: &str) -> git2::Oid {
        let repo_path = repo.workdir().expect("repo workdir");
        let full_path = repo_path.join(path);

        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).expect("create parent dirs");
        }
        fs::write(&full_path, contents).expect("write file");

        let mut index = repo.index().expect("open index");
        index.add_path(path).expect("stage file");
        index.write().expect("write index");

        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let sig = git2::Signature::now("nixmac", "nixmac@local").expect("signature");
        let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
        let parents = parent.iter().collect::<Vec<_>>();

        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
            .expect("create commit")
    }

    #[test]
    fn normalize_repo_relative_path_lexically_accepts_and_collapses_safe_paths() {
        assert_eq!(
            normalize_repo_relative_path_lexically("flake.nix"),
            Some(PathBuf::from("flake.nix"))
        );
        assert_eq!(
            normalize_repo_relative_path_lexically("./modules/../flake.nix"),
            Some(PathBuf::from("flake.nix"))
        );
        assert_eq!(
            normalize_repo_relative_path_lexically("modules/./darwin/default.nix"),
            Some(PathBuf::from("modules/darwin/default.nix"))
        );
    }

    #[test]
    fn normalize_repo_relative_path_lexically_rejects_escaping_paths() {
        assert_eq!(
            normalize_repo_relative_path_lexically("../secret.txt"),
            None
        );
        assert_eq!(
            normalize_repo_relative_path_lexically("modules/../../secret.txt"),
            None
        );
        assert_eq!(
            normalize_repo_relative_path_lexically("/tmp/secret.txt"),
            None
        );
    }

    #[test]
    fn head_file_contents_reads_blob_from_head() {
        let temp = TempDir::new().expect("create temp dir");
        let repo = Repository::init(temp.path()).expect("init repo");

        commit_file(&repo, Path::new("flake.nix"), "{ }\n", "initial");
        fs::write(temp.path().join("flake.nix"), "{ inputs = {}; }\n").expect("modify file");

        assert_eq!(head_file_contents(&repo, Path::new("flake.nix")), "{ }\n");
    }

    #[test]
    fn head_file_contents_returns_empty_for_missing_head_or_file() {
        let temp = TempDir::new().expect("create temp dir");
        let repo = Repository::init(temp.path()).expect("init repo");

        assert_eq!(head_file_contents(&repo, Path::new("flake.nix")), "");

        commit_file(&repo, Path::new("README.md"), "hello\n", "initial");

        assert_eq!(head_file_contents(&repo, Path::new("flake.nix")), "");
    }

    #[test]
    fn workdir_file_contents_reads_existing_worktree_file() {
        let temp = TempDir::new().expect("create temp dir");
        let repo = Repository::init(temp.path()).expect("init repo");

        fs::write(temp.path().join("flake.nix"), "{ inputs = {}; }\n").expect("write file");

        assert_eq!(
            workdir_file_contents(&repo, Path::new("flake.nix")),
            "{ inputs = {}; }\n"
        );
    }

    #[test]
    fn workdir_file_contents_returns_empty_for_missing_file() {
        let temp = TempDir::new().expect("create temp dir");
        let repo = Repository::init(temp.path()).expect("init repo");

        assert_eq!(workdir_file_contents(&repo, Path::new("missing.nix")), "");
    }

    #[test]
    fn workdir_file_contents_rejects_path_that_resolves_outside_workdir() {
        let temp = TempDir::new().expect("create temp dir");
        let repo = Repository::init(temp.path()).expect("init repo");
        let outside = temp.path().join("../outside.txt");
        fs::write(&outside, "outside").expect("write outside file");

        assert_eq!(
            workdir_file_contents(&repo, Path::new("../outside.txt")),
            ""
        );
    }
}
