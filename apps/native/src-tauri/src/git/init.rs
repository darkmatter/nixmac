use anyhow::Result;
use git2::Repository;
use std::path::Path;

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

pub fn init_repo(dir: &str) -> Result<()> {
    let path = Path::new(dir);

    if !is_repo(dir) {
        std::fs::create_dir_all(path)?;
        Repository::init(path)?;

        let gitignore_path = path.join(".gitignore");

        if !gitignore_path.exists() {
            std::fs::write(
                gitignore_path,
                "node_modules\nresult\nrelease\ndist\ndist-electron\n",
            )?;
        }
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
}
