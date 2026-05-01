use anyhow::Result;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use log::warn;
use std::fs;
use std::path::{Path, PathBuf};

/// Load all `.gitignore` files under the base config directory.
pub(crate) fn load_gitignore_matcher(base: &Path) -> Result<Option<Gitignore>> {
    let mut gitignore_paths = Vec::new();
    collect_gitignore_files(base, &mut gitignore_paths);

    if gitignore_paths.is_empty() {
        return Ok(None);
    }

    gitignore_paths.sort();

    build_matcher(base, &gitignore_paths)
}

/// Returns true when `relative_path` is ignored by the provided gitignore matcher.
pub(crate) fn is_ignored_by_matcher(
    matcher: Option<&Gitignore>,
    relative_path: &Path,
    is_dir: bool,
) -> bool {
    matcher
        .map(|m| {
            m.matched_path_or_any_parents(relative_path, is_dir)
                .is_ignore()
        })
        .unwrap_or(false)
}

fn collect_gitignore_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            warn!(
                "Unable to read directory {} while collecting .gitignore files: {}",
                dir.display(),
                e
            );
            return;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                warn!(
                    "Unable to read directory entry in {} while collecting .gitignore files: {}",
                    dir.display(),
                    e
                );
                continue;
            }
        };

        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(e) => {
                warn!(
                    "Unable to get file type for {} while collecting .gitignore files: {}",
                    entry.path().display(),
                    e
                );
                continue;
            }
        };

        let path = entry.path();
        let name = entry.file_name();

        if file_type.is_file() && name == ".gitignore" {
            out.push(path);
            continue;
        }

        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }

        if super::IGNORED_DIRS.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }

        collect_gitignore_files(&path, out);
    }
}

/// Build a Gitignore matcher from the provided `.gitignore` paths.
/// If building with the full set fails, this attempts to salvage as many valid
/// files as possible. If none can be loaded, this returns an error to fail
/// closed instead of silently disabling ignore protections.
fn build_matcher(base: &Path, gitignore_paths: &[PathBuf]) -> Result<Option<Gitignore>> {
    let mut full_builder = GitignoreBuilder::new(base);
    for path in gitignore_paths {
        full_builder.add(path);
    }

    if let Ok(matcher) = full_builder.build() {
        return Ok(Some(matcher));
    }

    // Fallback: keep as many valid .gitignore files as possible.
    let mut accepted_paths: Vec<PathBuf> = Vec::new();
    for path in gitignore_paths {
        let mut trial_builder = GitignoreBuilder::new(base);
        for accepted in &accepted_paths {
            trial_builder.add(accepted);
        }
        trial_builder.add(path);

        match trial_builder.build() {
            Ok(_) => accepted_paths.push(path.clone()),
            Err(e) => warn!(
                "Skipping invalid or unreadable .gitignore file {}: {}",
                path.display(),
                e
            ),
        }
    }

    if accepted_paths.is_empty() {
        return Err(anyhow::anyhow!(
            "Failed to build gitignore matcher for {}: no valid .gitignore files could be loaded. Fix or remove malformed/unreadable .gitignore files before running evolve.",
            base.display()
        ));
    }

    let mut final_builder = GitignoreBuilder::new(base);
    for accepted in &accepted_paths {
        final_builder.add(accepted);
    }

    match final_builder.build() {
        Ok(matcher) => Ok(Some(matcher)),
        Err(e) => {
            Err(anyhow::anyhow!(
                "Failed to build final gitignore matcher for {}: {}",
                base.display(),
                e
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_ignored_by_matcher, load_gitignore_matcher};
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn loads_matcher_when_subdir_is_unreadable() {
        let temp = tempdir().expect("create temp dir");
        let base = temp.path();
        fs::write(base.join(".gitignore"), "secret.txt\n").expect("write root .gitignore");

        let blocked = base.join("blocked");
        fs::create_dir_all(&blocked).expect("create blocked dir");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&blocked).expect("metadata").permissions();
            perms.set_mode(0o000);
            fs::set_permissions(&blocked, perms).expect("make blocked dir unreadable");
        }

        let matcher = load_gitignore_matcher(base).expect("load matcher should not fail");
        assert!(matcher.is_some(), "expected matcher from root .gitignore");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&blocked).expect("metadata").permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&blocked, perms).expect("restore permissions for cleanup");
        }
    }

    #[test]
    fn malformed_gitignore_fails_closed() {
        let temp = tempdir().expect("create temp dir");
        let base = temp.path();
        fs::write(base.join(".gitignore"), "[unterminated").expect("write malformed .gitignore");

        let err = load_gitignore_matcher(base).expect_err("malformed .gitignore should fail closed");
        assert!(
            err.to_string().contains("no valid .gitignore files could be loaded"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn preserves_valid_rules_when_some_gitignore_files_unreadable() {
        let temp = tempdir().expect("create temp dir");
        let base = temp.path();
        fs::write(base.join(".gitignore"), "secret.txt\n").expect("write root .gitignore");

        let nested = base.join("nested");
        fs::create_dir_all(&nested).expect("create nested dir");
        let nested_gitignore = nested.join(".gitignore");
        fs::write(&nested_gitignore, "ignored-in-nested.txt\n").expect("write nested .gitignore");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&nested_gitignore)
                .expect("metadata")
                .permissions();
            perms.set_mode(0o000);
            fs::set_permissions(&nested_gitignore, perms)
                .expect("make nested .gitignore unreadable");
        }

        let matcher = load_gitignore_matcher(base).expect("matcher load should not fail");
        assert!(
            matcher.is_some(),
            "expected matcher from readable .gitignore files"
        );

        assert!(
            is_ignored_by_matcher(matcher.as_ref(), Path::new("secret.txt"), false),
            "expected root rule to still apply"
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&nested_gitignore)
                .expect("metadata")
                .permissions();
            perms.set_mode(0o644);
            fs::set_permissions(&nested_gitignore, perms).expect("restore permissions for cleanup");
        }
    }
}
