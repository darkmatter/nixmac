//! Git-backed ignore checks for the evolve tools.
//!
//! Ignore semantics are delegated entirely to libgit2 (`git2`) instead of
//! reimplementing `.gitignore` matching: nested `.gitignore` files scope to
//! their own subtree, `.git/info/exclude` and the user's global excludes are
//! honored, and — matching real git — tracked files are never ignored even
//! when a pattern matches them.

use anyhow::{Context, Result};
use git2::Repository;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub(crate) struct GitignoreChecker {
    repo_root: PathBuf,
}

impl GitignoreChecker {
    /// Returns `Ok(None)` when `repo_root` is not a git repository (no ignore
    /// filtering applies), and an error when it looks like a repository but
    /// cannot be opened, so ignore protections fail closed.
    pub(crate) fn new(repo_root: &Path) -> Result<Option<Self>> {
        if !repo_root.join(".git").exists() {
            return Ok(None);
        }
        Repository::open(repo_root).with_context(|| {
            format!(
                "failed to open git repository at {} for gitignore checks",
                repo_root.display()
            )
        })?;
        Ok(Some(Self {
            repo_root: repo_root.to_path_buf(),
        }))
    }

    /// Re-open per call so the checker stays cheap to share and picks up
    /// index changes made while an evolution is running.
    fn repo(&self) -> Result<Repository> {
        Repository::open(&self.repo_root).with_context(|| {
            format!(
                "failed to open git repository at {}",
                self.repo_root.display()
            )
        })
    }

    /// Returns true when git would ignore `relative_path`. Tracked files are
    /// never ignored, regardless of `.gitignore` patterns.
    pub(crate) fn is_ignored(&self, relative_path: &Path) -> Result<bool> {
        let repo = self.repo()?;
        let index = repo.index().context("failed to read git index")?;
        if index.get_path(relative_path, 0).is_some() {
            return Ok(false);
        }
        repo.is_path_ignored(relative_path).with_context(|| {
            format!(
                "failed to check gitignore status of {}",
                relative_path.display()
            )
        })
    }

    /// Every file git considers part of the working tree: tracked files plus
    /// untracked files that are not ignored.
    pub(crate) fn visible_files(&self) -> Result<VisibleFiles> {
        let repo = self.repo()?;

        let mut files: HashSet<PathBuf> = HashSet::new();
        for entry in repo.index().context("failed to read git index")?.iter() {
            files.insert(PathBuf::from(String::from_utf8_lossy(&entry.path).as_ref()));
        }

        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);
        let statuses = repo
            .statuses(Some(&mut opts))
            .context("failed to compute git status")?;
        for status in statuses.iter() {
            if status.status().contains(git2::Status::WT_NEW) {
                files.insert(PathBuf::from(
                    String::from_utf8_lossy(status.path_bytes()).as_ref(),
                ));
            }
        }

        Ok(VisibleFiles::new(files))
    }
}

/// The set of non-ignored files in a repository, with directory containment
/// queries so tree walks can prune subtrees that hold no visible files.
pub(crate) struct VisibleFiles {
    files: HashSet<PathBuf>,
    dirs: HashSet<PathBuf>,
}

impl VisibleFiles {
    fn new(files: HashSet<PathBuf>) -> Self {
        let mut dirs = HashSet::new();
        for file in &files {
            let mut ancestor = file.as_path();
            while let Some(parent) = ancestor.parent() {
                if parent.as_os_str().is_empty() || !dirs.insert(parent.to_path_buf()) {
                    break;
                }
                ancestor = parent;
            }
        }
        Self { files, dirs }
    }

    pub(crate) fn contains_file(&self, relative_path: &Path) -> bool {
        self.files.contains(relative_path)
    }

    pub(crate) fn contains_dir(&self, relative_path: &Path) -> bool {
        self.dirs.contains(relative_path)
    }
}

/// Returns true when `relative_path` is ignored, treating "no repository" as
/// nothing ignored.
pub(crate) fn is_path_ignored(
    checker: Option<&GitignoreChecker>,
    relative_path: &Path,
) -> Result<bool> {
    match checker {
        Some(checker) => checker.is_ignored(relative_path),
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::{GitignoreChecker, is_path_ignored};
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    fn init_repo(base: &Path) -> git2::Repository {
        git2::Repository::init(base).expect("init git repo")
    }

    fn checker(base: &Path) -> GitignoreChecker {
        GitignoreChecker::new(base)
            .expect("create checker")
            .expect("base is a git repo")
    }

    #[test]
    fn non_git_directory_yields_no_checker() {
        let temp = tempdir().expect("create temp dir");
        let checker = GitignoreChecker::new(temp.path()).expect("no error for plain dir");
        assert!(checker.is_none(), "expected None for a non-repo directory");
        assert!(
            !is_path_ignored(None, Path::new("anything.txt")).expect("check"),
            "no checker means nothing is ignored"
        );
    }

    #[test]
    fn root_gitignore_rules_apply() {
        let temp = tempdir().expect("create temp dir");
        let base = temp.path();
        init_repo(base);
        fs::write(base.join(".gitignore"), "secret.txt\n").expect("write .gitignore");
        fs::write(base.join("secret.txt"), "x").expect("write secret");
        fs::write(base.join("visible.txt"), "x").expect("write visible");

        let checker = checker(base);
        assert!(checker.is_ignored(Path::new("secret.txt")).expect("check"));
        assert!(!checker.is_ignored(Path::new("visible.txt")).expect("check"));
    }

    #[test]
    fn nested_rules_apply_only_within_their_subtree() {
        let temp = tempdir().expect("create temp dir");
        let base = temp.path();
        init_repo(base);
        fs::create_dir_all(base.join("nested")).expect("create nested dir");
        fs::write(base.join("nested/.gitignore"), "secret.txt\n").expect("write nested ignore");

        let checker = checker(base);
        assert!(
            checker
                .is_ignored(Path::new("nested/secret.txt"))
                .expect("check"),
            "nested rule must apply inside its subtree"
        );
        assert!(
            !checker.is_ignored(Path::new("secret.txt")).expect("check"),
            "nested rule must not apply to the repo root"
        );
    }

    #[test]
    fn nested_catch_all_does_not_ignore_repo_root() {
        // Regression test: jj writes `.jj/.gitignore` containing `/*`. The old
        // hand-rolled matcher applied that pattern repo-wide, blocking
        // read_file/list_files/search_code entirely.
        let temp = tempdir().expect("create temp dir");
        let base = temp.path();
        init_repo(base);
        fs::create_dir_all(base.join(".jj")).expect("create .jj dir");
        fs::write(base.join(".jj/.gitignore"), "/*\n").expect("write .jj ignore");
        fs::write(base.join("flake.nix"), "{ }").expect("write flake");

        let checker = checker(base);
        assert!(
            !checker.is_ignored(Path::new("flake.nix")).expect("check"),
            "root files must stay visible"
        );
        assert!(
            checker
                .is_ignored(Path::new(".jj/repo/store"))
                .expect("check"),
            "the catch-all must still apply within .jj"
        );
    }

    #[test]
    fn tracked_files_are_never_ignored() {
        let temp = tempdir().expect("create temp dir");
        let base = temp.path();
        let repo = init_repo(base);
        fs::write(base.join("home.nix"), "{ }").expect("write file");
        let mut index = repo.index().expect("open index");
        index.add_path(Path::new("home.nix")).expect("track file");
        index.write().expect("write index");
        // Pattern matches the tracked file; git ignores the pattern for it.
        fs::write(base.join(".gitignore"), "home.nix\n").expect("write .gitignore");

        let checker = checker(base);
        assert!(
            !checker.is_ignored(Path::new("home.nix")).expect("check"),
            "tracked files must never be ignored"
        );
    }

    #[test]
    fn visible_files_lists_tracked_and_untracked_but_not_ignored() {
        let temp = tempdir().expect("create temp dir");
        let base = temp.path();
        let repo = init_repo(base);
        fs::write(base.join(".gitignore"), "secret.txt\n").expect("write .gitignore");
        fs::write(base.join("tracked.txt"), "x").expect("write tracked");
        fs::write(base.join("untracked.txt"), "x").expect("write untracked");
        fs::write(base.join("secret.txt"), "x").expect("write secret");
        fs::create_dir_all(base.join("sub")).expect("create sub");
        fs::write(base.join("sub/inner.txt"), "x").expect("write inner");
        let mut index = repo.index().expect("open index");
        index.add_path(Path::new("tracked.txt")).expect("track");
        index.write().expect("write index");

        let visible = checker(base).visible_files().expect("visible files");
        assert!(visible.contains_file(Path::new("tracked.txt")));
        assert!(visible.contains_file(Path::new("untracked.txt")));
        assert!(visible.contains_file(Path::new("sub/inner.txt")));
        assert!(!visible.contains_file(Path::new("secret.txt")));
        assert!(visible.contains_dir(Path::new("sub")));
        assert!(!visible.contains_dir(Path::new("elsewhere")));
    }
}
