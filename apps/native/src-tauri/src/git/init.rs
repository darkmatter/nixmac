use anyhow::Result;
use git2::Repository;
use std::path::Path;

const DEFAULT_GITIGNORE: &str = "node_modules\nresult\nrelease\ndist\ndist-electron\n";

fn write_default_gitignore(path: &Path) -> Result<()> {
    let gitignore_path = path.join(".gitignore");

    if !gitignore_path.exists() {
        std::fs::write(gitignore_path, DEFAULT_GITIGNORE)?;
    }

    Ok(())
}

/// Errors if `dir` is not a git repository. Use at the top of functions that require a repo.
pub fn require_repo(dir: &str) -> Result<()> {
    if !is_repo(dir) {
        anyhow::bail!("'{}' is not a git repository", dir);
    }
    Ok(())
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

/// Returns true only when `dir` itself is the root of a non-bare Git worktree.
pub fn is_repo_root(dir: &Path) -> bool {
    let Ok(repo) = Repository::open(dir) else {
        return false;
    };
    let Some(workdir) = repo.workdir() else {
        return false;
    };
    let Ok(expected) = dir.canonicalize() else {
        return false;
    };
    let Ok(actual) = workdir.canonicalize() else {
        return false;
    };

    actual == expected
}

#[allow(dead_code)]
pub fn init_repo(dir: &str) -> Result<()> {
    let path = Path::new(dir);

    if !is_repo(dir) {
        std::fs::create_dir_all(path)?;
        Repository::init(path)?;
        write_default_gitignore(path)?;
    }

    Ok(())
}

/// Initializes `dir` as a Git repository unless it is already the exact root.
///
/// Unlike `init_repo`, this intentionally does not discover parent
/// repositories. It is for flows that must own a nested config directory even
/// when the user's home directory is itself a Git worktree.
pub fn init_repo_root(dir: &Path) -> Result<()> {
    if !is_repo_root(dir) {
        std::fs::create_dir_all(dir)?;
        Repository::init(dir)?;
        write_default_gitignore(dir)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {

    use tempfile::TempDir;

    use super::*;

    // mk temp repo
    #[test]
    fn test_init_repo() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        init_repo(&repo_dir.to_string_lossy()).unwrap();
        assert!(is_repo(&repo_dir.to_string_lossy()));
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
    fn repo_root_detection_does_not_discover_parent_repos() {
        let temp = TempDir::new().expect("create temp dir");
        let home = temp.path().join("home");
        let config_dir = home.join(".darwin");
        init_repo(&home.to_string_lossy()).expect("init parent repo");
        std::fs::create_dir_all(&config_dir).expect("create nested config dir");

        assert!(is_repo(&config_dir.to_string_lossy()));
        assert!(!is_repo_root(&config_dir));
    }

    #[test]
    fn init_repo_root_creates_nested_repo_inside_parent_repo() {
        let temp = TempDir::new().expect("create temp dir");
        let home = temp.path().join("home");
        let config_dir = home.join(".darwin");
        init_repo(&home.to_string_lossy()).expect("init parent repo");

        init_repo_root(&config_dir).expect("init exact nested repo");

        assert!(is_repo_root(&config_dir));
        assert!(config_dir.join(".gitignore").exists());
    }
}
