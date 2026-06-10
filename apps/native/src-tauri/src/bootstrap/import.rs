//! Importing an existing nix-darwin configuration during onboarding.
//!
//! Two sources are supported:
//!   * a GitHub reference such as `owner/repo` (cloned with libgit2), and
//!   * a local `.zip` archive (extracted in-process).
//!
//! Both land the configuration at the user's chosen directory (default
//! `~/.darwin`) so the rest of onboarding can proceed exactly as if the user
//! had selected an existing flake.

use anyhow::{anyhow, bail, Context, Result};
use std::fs::{self, File};
use std::io::{self, Read};
#[cfg(unix)]
use std::os::unix::{
    ffi::OsStrExt,
    fs::{symlink, PermissionsExt},
};
use std::path::{Component, Path, PathBuf};

/// A parsed GitHub/git reference ready to clone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoRef {
    /// Fully-qualified clone URL.
    pub clone_url: String,
    /// Optional branch/tag to check out.
    pub branch: Option<String>,
}

fn is_valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Parses a user-supplied repository reference into a clone URL + optional branch.
///
/// Accepted forms:
///   * `owner/repo`, optionally suffixed with `#branch`
///   * `github.com/owner/repo`
///   * `https://github.com/owner/repo[.git]`
///   * `git@github.com:owner/repo[.git]`
///   * any `https://`/`http://`/`ssh://` git URL (passed through unchanged,
///     with a `#branch` suffix honored)
pub fn parse_repo_ref(input: &str) -> Result<RepoRef> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        bail!("Repository reference is required");
    }

    // Split an optional `#branch` suffix off the end. We only treat `#` as a
    // branch separator for the shorthand/host forms; full URLs may legitimately
    // contain one, so they are handled in their own branch below.
    let (locator, branch) = match trimmed.split_once('#') {
        Some((loc, br)) if !br.is_empty() => (loc, Some(br.to_string())),
        _ => (trimmed, None),
    };

    // Full URL forms are passed through with minimal normalization. A `#branch`
    // suffix is honored; the rest of the URL keeps its scheme verbatim.
    let is_full_url = ["https://", "http://", "ssh://"]
        .iter()
        .any(|scheme| trimmed.starts_with(scheme));
    if is_full_url {
        return Ok(RepoRef {
            clone_url: locator.to_string(),
            branch,
        });
    }

    // `git@host:owner/repo(.git)` SCP-like form.
    if locator.starts_with("git@") {
        return Ok(RepoRef {
            clone_url: locator.to_string(),
            branch,
        });
    }

    // Strip a leading `github.com/` host if present, then expect `owner/repo`.
    let path = locator
        .strip_prefix("github.com/")
        .or_else(|| locator.strip_prefix("www.github.com/"))
        .unwrap_or(locator);

    let path = path.trim_matches('/');
    let mut parts = path.split('/');
    let (Some(owner), Some(repo), None) = (parts.next(), parts.next(), parts.next()) else {
        bail!("Expected a GitHub reference like 'owner/repo'");
    };

    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    if !is_valid_segment(owner) || !is_valid_segment(repo) {
        bail!("Invalid GitHub reference: '{}'", trimmed);
    }

    Ok(RepoRef {
        clone_url: format!("https://github.com/{owner}/{repo}.git"),
        branch,
    })
}

/// Clones `spec` into `dest`. `dest` must not already exist as a non-empty
/// directory (libgit2 requires an empty/absent target).
pub fn clone_repo(spec: &RepoRef, dest: &Path) -> Result<()> {
    let mut builder = git2::build::RepoBuilder::new();
    if let Some(branch) = &spec.branch {
        builder.branch(branch);
    }
    builder
        .clone(&spec.clone_url, dest)
        .with_context(|| format!("failed to clone {}", spec.clone_url))?;
    Ok(())
}

/// Returns the single shared top-level directory across all archive entries,
/// if one exists. GitHub "Download ZIP" archives wrap everything in a
/// `repo-branch/` folder; stripping it yields the flake at the repo root.
fn common_top_level(names: &[String]) -> Option<String> {
    let mut top: Option<String> = None;
    for name in names {
        let first = name.split('/').next().unwrap_or("");
        if first.is_empty() {
            return None;
        }
        match &top {
            Some(existing) if existing != first => return None,
            None => top = Some(first.to_string()),
            _ => {}
        }
    }
    top
}

/// Resolves a (possibly top-level-stripped) archive entry name to a path inside
/// `dest`, rejecting absolute paths and `..` traversal ("zip slip").
fn safe_join(dest: &Path, name: &str) -> Result<PathBuf> {
    let relative = Path::new(name);
    let mut out = dest.to_path_buf();
    for component in relative.components() {
        match component {
            Component::Normal(part) => out.push(part),
            // Ignore no-op components; reject anything that could escape `dest`.
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                bail!("refusing to extract entry with unsafe path: '{}'", name);
            }
        }
    }
    Ok(out)
}

#[cfg(unix)]
fn apply_unix_permissions(path: &Path, mode: Option<u32>) -> Result<()> {
    let Some(mode) = mode else {
        return Ok(());
    };
    let permissions = mode & 0o777;
    if permissions == 0 {
        return Ok(());
    }
    fs::set_permissions(path, fs::Permissions::from_mode(permissions))
        .with_context(|| format!("failed to set permissions on {}", path.display()))
}

#[cfg(not(unix))]
fn apply_unix_permissions(_path: &Path, _mode: Option<u32>) -> Result<()> {
    Ok(())
}

/// Extracts a `.zip` archive into `dest`, stripping a single wrapping
/// top-level directory when present.
pub fn extract_zip(zip_path: &Path, dest: &Path) -> Result<()> {
    let file = File::open(zip_path)
        .with_context(|| format!("failed to open zip {}", zip_path.display()))?;
    let mut archive = zip::ZipArchive::new(file).context("failed to read zip archive")?;

    let names: Vec<String> = (0..archive.len())
        .map(|i| {
            archive
                .by_index(i)
                .map(|f| f.name().to_string())
                .map_err(|e| anyhow!("failed to read zip entry: {e}"))
        })
        .collect::<Result<_>>()?;

    // Only strip a wrapper directory when the archive has more than just that
    // single folder, otherwise an archive that *is* one directory would extract
    // to nothing.
    let strip = if names.len() > 1 {
        common_top_level(&names)
    } else {
        None
    };

    fs::create_dir_all(dest).with_context(|| format!("failed to create {}", dest.display()))?;

    let mut symlinks = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).context("failed to read zip entry")?;
        let raw_name = entry.name().to_string();
        let unix_mode = entry.unix_mode();

        // Apply the wrapper-dir strip, skipping the wrapper directory itself.
        let relative = match &strip {
            Some(prefix) => match raw_name
                .strip_prefix(prefix)
                .and_then(|r| r.strip_prefix('/'))
            {
                Some(rest) if !rest.is_empty() => rest,
                _ => continue,
            },
            None => raw_name.as_str(),
        };

        let out_path = safe_join(dest, relative)?;
        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .with_context(|| format!("failed to create {}", out_path.display()))?;
            apply_unix_permissions(&out_path, unix_mode)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        if entry.is_symlink() {
            let mut target = Vec::new();
            entry
                .read_to_end(&mut target)
                .with_context(|| format!("failed to read symlink target for '{relative}'"))?;
            // Create symlinks after regular entries so later archive paths cannot
            // traverse a symlink created earlier in the same extraction.
            symlinks.push((out_path, target, relative.to_string()));
            continue;
        }
        let mut out = File::create(&out_path)
            .with_context(|| format!("failed to write {}", out_path.display()))?;
        io::copy(&mut entry, &mut out)
            .with_context(|| format!("failed to extract {}", out_path.display()))?;
        apply_unix_permissions(&out_path, unix_mode)?;
    }

    for (out_path, target, relative) in symlinks {
        #[cfg(unix)]
        let _ = &relative;

        #[cfg(unix)]
        {
            let target_preview = String::from_utf8_lossy(&target);
            symlink(std::ffi::OsStr::from_bytes(&target), &out_path).with_context(|| {
                format!(
                    "failed to create symlink {} -> {}",
                    out_path.display(),
                    target_preview
                )
            })?;
        }
        #[cfg(not(unix))]
        {
            let _ = (out_path, target);
            bail!(
                "zip entry '{}' is a symlink, but symlink extraction is unsupported on this platform",
                relative
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn parses_owner_repo_shorthand() {
        let r = parse_repo_ref("czxtm/darwin").unwrap();
        assert_eq!(r.clone_url, "https://github.com/czxtm/darwin.git");
        assert_eq!(r.branch, None);
    }

    #[test]
    fn parses_owner_repo_with_branch() {
        let r = parse_repo_ref("czxtm/darwin#main").unwrap();
        assert_eq!(r.clone_url, "https://github.com/czxtm/darwin.git");
        assert_eq!(r.branch.as_deref(), Some("main"));
    }

    #[test]
    fn parses_full_https_url() {
        let r = parse_repo_ref("https://github.com/czxtm/darwin").unwrap();
        assert_eq!(r.clone_url, "https://github.com/czxtm/darwin");
        assert_eq!(r.branch, None);
    }

    #[test]
    fn parses_https_url_with_branch_suffix() {
        let r = parse_repo_ref("https://example.com/x/y.git#dev").unwrap();
        assert_eq!(r.clone_url, "https://example.com/x/y.git");
        assert_eq!(r.branch.as_deref(), Some("dev"));
    }

    #[test]
    fn strips_dot_git_and_host_prefix() {
        let r = parse_repo_ref("github.com/czxtm/darwin.git").unwrap();
        assert_eq!(r.clone_url, "https://github.com/czxtm/darwin.git");
    }

    #[test]
    fn parses_scp_like_url() {
        let r = parse_repo_ref("git@github.com:czxtm/darwin.git").unwrap();
        assert_eq!(r.clone_url, "git@github.com:czxtm/darwin.git");
    }

    #[test]
    fn rejects_empty_and_malformed_refs() {
        assert!(parse_repo_ref("").is_err());
        assert!(parse_repo_ref("just-a-name").is_err());
        assert!(parse_repo_ref("a/b/c").is_err());
        assert!(parse_repo_ref("bad owner/repo").is_err());
    }

    #[test]
    fn common_top_level_detects_single_wrapper() {
        let names = vec![
            "darwin-main/".to_string(),
            "darwin-main/flake.nix".to_string(),
            "darwin-main/hosts/default.nix".to_string(),
        ];
        assert_eq!(common_top_level(&names).as_deref(), Some("darwin-main"));
    }

    #[test]
    fn common_top_level_none_for_mixed_roots() {
        let names = vec!["flake.nix".to_string(), "hosts/default.nix".to_string()];
        assert_eq!(common_top_level(&names), None);
    }

    #[test]
    fn safe_join_rejects_traversal() {
        let dest = Path::new("/tmp/dest");
        assert!(safe_join(dest, "../escape").is_err());
        assert!(safe_join(dest, "/etc/passwd").is_err());
        assert_eq!(
            safe_join(dest, "a/b.nix").unwrap(),
            PathBuf::from("/tmp/dest/a/b.nix")
        );
    }

    fn write_zip(path: &Path, entries: &[(&str, &str)]) {
        let file = File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        for (name, contents) in entries {
            if name.ends_with('/') {
                zip.add_directory(*name, opts).unwrap();
            } else {
                zip.start_file(*name, opts).unwrap();
                zip.write_all(contents.as_bytes()).unwrap();
            }
        }
        zip.finish().unwrap();
    }

    fn write_zip_file(zip: &mut zip::ZipWriter<File>, name: &str, contents: &str, mode: u32) {
        let opts = zip::write::SimpleFileOptions::default().unix_permissions(mode);
        zip.start_file(name, opts).unwrap();
        zip.write_all(contents.as_bytes()).unwrap();
    }

    #[cfg(unix)]
    fn write_zip_symlink(zip: &mut zip::ZipWriter<File>, name: &str, target: &str) {
        zip.add_symlink(name, target, zip::write::SimpleFileOptions::default())
            .unwrap();
    }

    #[test]
    fn extract_zip_strips_github_wrapper_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let zip_path = tmp.path().join("repo.zip");
        write_zip(
            &zip_path,
            &[
                ("darwin-main/", ""),
                ("darwin-main/flake.nix", "{ }"),
                ("darwin-main/hosts/default.nix", "{ }"),
            ],
        );

        let dest = tmp.path().join("out");
        extract_zip(&zip_path, &dest).unwrap();

        assert!(dest.join("flake.nix").exists());
        assert!(dest.join("hosts/default.nix").exists());
        assert!(!dest.join("darwin-main").exists());
    }

    #[test]
    fn extract_zip_without_wrapper_keeps_layout() {
        let tmp = tempfile::TempDir::new().unwrap();
        let zip_path = tmp.path().join("repo.zip");
        write_zip(
            &zip_path,
            &[("flake.nix", "{ }"), ("modules/base.nix", "{ }")],
        );

        let dest = tmp.path().join("out");
        extract_zip(&zip_path, &dest).unwrap();

        assert!(dest.join("flake.nix").exists());
        assert!(dest.join("modules/base.nix").exists());
    }

    #[cfg(unix)]
    #[test]
    fn extract_zip_preserves_github_symlink_entries() {
        let tmp = tempfile::TempDir::new().unwrap();
        let zip_path = tmp.path().join("repo.zip");
        let file = File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.add_directory(
            "darwin-main/",
            zip::write::SimpleFileOptions::default().unix_permissions(0o40755),
        )
        .unwrap();
        write_zip_file(&mut zip, "darwin-main/flake.nix", "{ }", 0o100644);
        write_zip_symlink(&mut zip, "darwin-main/link-to-flake", "flake.nix");
        zip.finish().unwrap();

        let dest = tmp.path().join("out");
        extract_zip(&zip_path, &dest).unwrap();

        let link = dest.join("link-to-flake");
        let metadata = std::fs::symlink_metadata(&link).unwrap();
        assert!(metadata.file_type().is_symlink());
        assert_eq!(
            std::fs::read_link(&link).unwrap(),
            PathBuf::from("flake.nix")
        );
    }

    #[cfg(unix)]
    #[test]
    fn extract_zip_preserves_executable_unix_mode() {
        let tmp = tempfile::TempDir::new().unwrap();
        let zip_path = tmp.path().join("repo.zip");
        let file = File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.add_directory(
            "darwin-main/",
            zip::write::SimpleFileOptions::default().unix_permissions(0o40755),
        )
        .unwrap();
        write_zip_file(
            &mut zip,
            "darwin-main/scripts/bootstrap.sh",
            "#!/bin/sh\n",
            0o100755,
        );
        zip.finish().unwrap();

        let dest = tmp.path().join("out");
        extract_zip(&zip_path, &dest).unwrap();

        let mode = std::fs::metadata(dest.join("scripts/bootstrap.sh"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o755);
    }
}
