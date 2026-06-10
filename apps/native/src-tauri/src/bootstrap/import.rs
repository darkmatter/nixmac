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
use std::fs::File;
use std::path::{Component, Path, PathBuf};

use crate::git;

pub const INITIAL_CONFIG_COMMIT_MESSAGE: &str = "chore: initial nix-darwin configuration";

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

    std::fs::create_dir_all(dest)
        .with_context(|| format!("failed to create {}", dest.display()))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).context("failed to read zip entry")?;
        let raw_name = entry.name().to_string();

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
            std::fs::create_dir_all(&out_path)
                .with_context(|| format!("failed to create {}", out_path.display()))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        let mut out = File::create(&out_path)
            .with_context(|| format!("failed to write {}", out_path.display()))?;
        std::io::copy(&mut entry, &mut out)
            .with_context(|| format!("failed to extract {}", out_path.display()))?;
    }

    Ok(())
}

pub fn create_base_commit(dir: &Path, message: &str) -> Result<git::CommitInfo> {
    let dir_str = dir.to_string_lossy();
    let info = git::commit_all(&dir_str, message)
        .with_context(|| format!("failed to create base commit in {}", dir.display()))?;
    if let Err(e) = git::tag_commit(
        &dir_str,
        &format!("nixmac-base-{}", &info.hash[..8]),
        &info.hash,
        false,
    ) {
        log::warn!("Failed to tag base commit: {}", e);
    }
    Ok(info)
}

/// Ensures `dir` is an exact Git repository root and creates the adoption commit.
///
/// This intentionally does not discover parent repositories: `~/.darwin` must
/// become its own repository even when `~` is already tracked by a dotfiles repo.
pub fn ensure_initial_commit(dir: &Path) -> Result<git::CommitInfo> {
    git::init::init_repo_root(dir)
        .with_context(|| format!("failed to initialize {}", dir.display()))?;
    create_base_commit(dir, INITIAL_CONFIG_COMMIT_MESSAGE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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

    fn head_id(repo_path: &Path) -> git2::Oid {
        git2::Repository::open(repo_path)
            .unwrap()
            .head()
            .unwrap()
            .target()
            .unwrap()
    }

    #[test]
    fn ensure_initial_commit_uses_exact_root_inside_parent_repo() {
        let tmp = tempfile::TempDir::new().unwrap();
        let home = tmp.path().join("home");
        let config_dir = home.join(".darwin");
        let home_str = home.to_string_lossy();

        git::init::init_repo(&home_str).unwrap();
        std::fs::write(home.join("dotfiles.nix"), "{ parent = true; }\n").unwrap();
        let parent_initial = git::commit_all(&home_str, "parent initial").unwrap();
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::write(
            config_dir.join("flake.nix"),
            "{ description = \"test\"; }\n",
        )
        .unwrap();

        let info = ensure_initial_commit(&config_dir).unwrap();

        assert!(git::init::is_repo_root(&config_dir));
        assert_eq!(head_id(&home).to_string(), parent_initial.hash);
        assert!(git::read_tags(&home_str, &parent_initial.hash).is_empty());

        let config_repo = git2::Repository::open(&config_dir).unwrap();
        let commit = config_repo
            .find_commit(git2::Oid::from_str(&info.hash).unwrap())
            .unwrap();
        assert_eq!(commit.message().unwrap(), INITIAL_CONFIG_COMMIT_MESSAGE);
        assert!(git::read_tags(&config_dir.to_string_lossy(), &info.hash)
            .contains(&format!("nixmac-base-{}", &info.hash[..8])));
        assert!(
            config_repo.revparse_single("HEAD:flake.nix").is_ok(),
            "config flake should be committed in the nested repository"
        );
    }
}
