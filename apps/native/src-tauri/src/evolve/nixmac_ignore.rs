//! Subsystem for making nixmac "ignore" files during evolution based on business rules
//! plus user preferences stored in a ".nixmacignore" file.
//! The ignore files are used to filter out files from the evolution process so that they are not considered for agent exploration, updates, or changes.
//!
//! Rules:
//! 1. Only a .nixmacignore at the repo root is read (TODO: at least for now)
//! 2. .git and result are always ignored and this cannot be negated.
//! 3. .nixmacignore applies to all files tracked and untracked by git.
//! 4. Paths are repo-root-relative (not config-dir relative).
//! 5. If you don't have a .nixmacignore, no additional ignore rules are applied beyond those in item 2.
//! 6. If we can't read .nixmacignore we should fail closed and the UI should do an error.
//!    NOTE: This decision effectively means you have to fix/delete a broken .nixmacignore before using nixmac further.
//! 7. The agent itself should not modify .nixmacignore.
//! 8. The special .nixmac directory is immune to the nixmac_ignore rules because doing so might break internal system functionality, so we need to check it explicitly in the code.

use anyhow::Context;
use anyhow::Result;
use git2::Repository;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// Directories always ignored by file listing and search helpers.
const IGNORED_DIRS: [&str; 2] = [".git", "result"];

pub(crate) struct NixmacIgnoreChecker {
    repo_root: PathBuf,
    matcher: Gitignore,
}

impl NixmacIgnoreChecker {
    /// Returns `Ok(None)` when `repo_root` is not a git repository (no ignore
    /// filtering applies), and an error when it looks like a repository but
    /// cannot be opened, so ignore protections fail closed.
    pub(crate) fn new(repo_root: &Path) -> Result<Option<NixmacIgnoreChecker>> {
        if !repo_root.join(".git").exists() {
            return Ok(None);
        }
        Repository::open(repo_root).with_context(|| {
            format!(
                "failed to open git repository at {} for nixmac ignore checks",
                repo_root.display()
            )
        })?;

        let ignore_path = repo_root.join(".nixmacignore");
        let mut builder = GitignoreBuilder::new(repo_root);
        match fs::symlink_metadata(&ignore_path) {
            Ok(_) => {
                if let Some(error) = builder.add(&ignore_path) {
                    return Err(error).with_context(|| {
                        format!("failed to read or parse {}", ignore_path.display())
                    });
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("failed to inspect {}", ignore_path.display()));
            }
        }
        let matcher = builder.build().with_context(|| {
            format!(
                "failed to build ignore rules from {}",
                ignore_path.display()
            )
        })?;

        Ok(Some(NixmacIgnoreChecker {
            repo_root: repo_root.to_path_buf(),
            matcher,
        }))
    }

    /// Returns whether a repo-root-relative path must be hidden from the
    /// evolution agent.
    pub(crate) fn is_ignored(&self, relative_path: &Path, is_dir: bool) -> bool {
        let relative_path = relative_path
            .strip_prefix(&self.repo_root)
            .unwrap_or(relative_path);

        // These rules are checked separately so a user negation in
        // `.nixmacignore` can never make them visible.
        if relative_path == Path::new(".nixmacignore")
            || relative_path.components().next().is_some_and(|component| {
                IGNORED_DIRS
                    .iter()
                    .any(|ignored| component.as_os_str() == *ignored)
            })
        {
            return true;
        }

        // `.nixmac` directories contain files owned by Nixmac itself. It can occur at any
        // depth in the repository and user rules must never hide it or
        // anything below it.
        let mut components = relative_path.components().peekable();
        while let Some(component) = components.next() {
            if matches!(component, std::path::Component::Normal(name) if name == ".nixmac")
                && (is_dir || components.peek().is_some())
            {
                return false;
            }
        }

        let ignored = self
            .matcher
            .matched_path_or_any_parents(relative_path, is_dir)
            .is_ignore();

        // This diagnostic is very noisy so it's commented out by default, but it's useful
        // for validating the ignore rules.
        // log::debug!(
        //     "nixmac ignore check: {} (dir={}) => {}",
        //     relative_path.display(),
        //     is_dir,
        //     ignored
        // );
        ignored
    }
}

/// Returns the list of directories that are always ignored by the evolution agent.
/// This is used to more proactively filter in ripgrep searches and other file listing operations,
/// so that we don't waste time searching in directories that are always eventually ignored.
pub(crate) fn get_always_ignored_dirs() -> &'static [&'static str] {
    &IGNORED_DIRS
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn checker(base: &Path) -> NixmacIgnoreChecker {
        Repository::init(base).expect("init git repo");
        NixmacIgnoreChecker::new(base)
            .expect("create checker")
            .expect("base is a git repo")
    }

    #[test]
    fn non_git_directory_yields_no_checker() {
        let temp = tempdir().expect("create temp dir");
        assert!(
            NixmacIgnoreChecker::new(temp.path())
                .expect("plain directories are allowed")
                .is_none()
        );
    }

    #[test]
    fn mandatory_paths_are_always_ignored() {
        let temp = tempdir().expect("create temp dir");
        fs::write(
            temp.path().join(".nixmacignore"),
            "!.git/**\n!result/**\n!.nixmacignore\n",
        )
        .expect("write ignore file");
        let checker = checker(temp.path());

        assert!(checker.is_ignored(Path::new(".git/config"), false));
        assert!(checker.is_ignored(Path::new("result/build.log"), false));
        assert!(checker.is_ignored(Path::new(".nixmacignore"), false));
    }

    #[test]
    fn root_nixmacignore_uses_standard_ignore_syntax() {
        let temp = tempdir().expect("create temp dir");
        fs::write(
            temp.path().join(".nixmacignore"),
            "*.secret\n/private/\n!important.secret\n",
        )
        .expect("write ignore file");
        let checker = checker(temp.path());

        assert!(checker.is_ignored(Path::new("nested/value.secret"), false));
        assert!(checker.is_ignored(Path::new("private/value.txt"), false));
        assert!(!checker.is_ignored(Path::new("important.secret"), false));
        assert!(!checker.is_ignored(Path::new("visible.txt"), false));
    }

    #[test]
    fn nixmac_directories_are_immune_to_nixmacignore_at_any_depth() {
        let temp = tempdir().expect("create temp dir");
        fs::write(temp.path().join(".nixmacignore"), "*\n").expect("write ignore file");
        let checker = checker(temp.path());

        assert!(!checker.is_ignored(Path::new(".nixmac"), true));
        assert!(!checker.is_ignored(Path::new(".nixmac/settings.json"), false));
        assert!(!checker.is_ignored(Path::new("hosts/macbook/.nixmac"), true));
        assert!(!checker.is_ignored(Path::new("hosts/macbook/.nixmac/modules/data.json"), false));

        assert!(checker.is_ignored(Path::new(".nixmac"), false));
        assert!(checker.is_ignored(Path::new("settings.json"), false));
        assert!(checker.is_ignored(Path::new("hosts/macbook/nixmac/data.json"), false));
        assert!(checker.is_ignored(Path::new("hosts/macbook/.nixmac-backup/data.json"), false));
    }

    #[test]
    fn mandatory_ignored_directories_take_precedence_over_nixmac_immunity() {
        let temp = tempdir().expect("create temp dir");
        fs::write(temp.path().join(".nixmacignore"), "").expect("write ignore file");
        let checker = checker(temp.path());

        assert!(checker.is_ignored(Path::new(".git/.nixmac/settings.json"), false));
        assert!(checker.is_ignored(Path::new("result/nested/.nixmac/data.json"), false));
    }

    #[test]
    fn unreadable_nixmacignore_fails_closed() {
        let temp = tempdir().expect("create temp dir");
        Repository::init(temp.path()).expect("init git repo");
        fs::create_dir(temp.path().join(".nixmacignore")).expect("create invalid ignore path");

        let error = NixmacIgnoreChecker::new(temp.path())
            .err()
            .expect("a directory cannot be read as an ignore file");
        assert!(
            error.to_string().contains(".nixmacignore"),
            "error: {error:#}"
        );
    }
}
