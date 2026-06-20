//! Importing an existing nix-darwin configuration during onboarding.
//!
//! Two sources are supported:
//!   * a GitHub reference such as `owner/repo` (cloned with libgit2), and
//!   * a local `.zip` archive (extracted in-process).
//!
//! Both land the configuration at the user's chosen directory (default
//! `~/.darwin`) so the rest of onboarding can proceed exactly as if the user
//! had selected an existing flake.

use anyhow::{Context, Result, anyhow, bail};
use std::fs::File;
use std::path::{Component, Path, PathBuf};

use crate::bootstrap::default_config::{detect_hostname, detect_username};
use crate::bootstrap::detect_darwin_platform;
use crate::bootstrap::template::apply_template_placeholders_in_dir;

/// A parsed GitHub/git reference ready to clone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoRef {
    /// Fully-qualified clone URL.
    pub clone_url: String,
    /// Optional git ref (typically branch/tag) to check out.
    pub git_ref: Option<String>,
    /// Optional subdirectory inside the repo to use as the flake root.
    pub subdir: Option<String>,
}

fn is_valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Parses a repository reference into a clone URL plus optional ref and
/// subdirectory.
///
/// Accepted forms:
///   * `owner/repo`
///   * `owner/repo?ref=<ref>`
///   * `owner/repo?dir=<subdir>`
///   * `owner/repo?ref=<ref>&dir=<subdir>`
///   * `github.com/owner/repo[.git]`
///   * `https://github.com/owner/repo[.git]`
///   * `git@github.com:owner/repo[.git]`
///   * any `https://` / `http://` / `ssh://` Git URL
///
/// Supported query parameters:
///   * `ref` — branch or tag to check out
///   * `dir` — subdirectory inside the repository to use as the flake root
///
/// Query parameters are consumed by the parser and are not included in the
/// resulting clone URL.
///
/// This intentionally does NOT support Nix flake references such as:
///   * `github:owner/repo`
///   * `github:owner/repo?dir=subdir`
///   * `nixpkgs#hello`
pub fn parse_repo_ref(input: &str) -> Result<RepoRef> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        bail!("Repository reference is required");
    }

    let (locator, git_ref, subdir) = parse_query_params(trimmed)?;

    // Full URL forms.
    let is_full_url = ["https://", "http://", "ssh://"]
        .iter()
        .any(|scheme| locator.starts_with(scheme));

    if is_full_url {
        return Ok(RepoRef {
            clone_url: locator.to_string(),
            git_ref,

            subdir,
        });
    }

    // SCP-style SSH form.
    if locator.starts_with("git@") {
        return Ok(RepoRef {
            clone_url: locator.to_string(),
            git_ref,
            subdir,
        });
    }

    // Strip optional GitHub hostname.
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
        git_ref,
        subdir,
    })
}

/// Helper to parse query parameters from the git import url input string, returning the base locator
/// and the extracted `ref` and `dir` values.
fn parse_query_params(input: &str) -> Result<(&str, Option<String>, Option<String>)> {
    let Some((locator, query)) = input.split_once('?') else {
        return Ok((input, None, None));
    };

    let mut git_ref = None;
    let mut subdir = None;

    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair
            .split_once('=')
            .ok_or_else(|| anyhow!("Invalid query parameter '{}'", pair))?;

        if value.is_empty() {
            bail!("Query parameter '{}' must not be empty", key);
        }

        match key {
            "ref" => {
                if git_ref.replace(value.to_string()).is_some() {
                    bail!("'ref' specified more than once");
                }
            }
            "dir" => {
                validate_subdir(value)?;

                if subdir.replace(value.to_string()).is_some() {
                    bail!("'dir' specified more than once");
                }
            }
            _ => bail!("Unsupported repository query parameter '{}'", key),
        }
    }

    Ok((locator, git_ref, subdir))
}

/// Validates that a subdirectory used by git import urls is a relative path without empty components or
/// `.`/`..` segments. This is important because git's sparse checkout doesn't support that.
fn validate_subdir(path: &str) -> Result<()> {
    if path.starts_with('/') {
        bail!("Subdirectory must be relative");
    }

    for component in path.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            bail!("Invalid subdirectory '{}'", path);
        }
    }

    Ok(())
}

/// Clones `spec` into `dest`. `dest` must not already exist as a non-empty
/// directory (libgit2 requires an empty/absent target).
pub fn clone_repo(spec: &RepoRef, dest: &Path) -> Result<()> {
    let mut builder = git2::build::RepoBuilder::new();
    if let Some(branch) = &spec.git_ref {
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
    let mut has_child = false;
    for name in names {
        let name = normalize_zip_entry_name(name);
        if should_skip_zip_entry(name) {
            continue;
        }
        let first = name.split('/').next().unwrap_or("");
        if first.is_empty() {
            return None;
        }
        if name
            .strip_prefix(first)
            .and_then(|rest| rest.strip_prefix('/'))
            .is_some_and(|rest| !rest.is_empty())
        {
            has_child = true;
        }
        match &top {
            Some(existing) if existing != first => return None,
            None => top = Some(first.to_string()),
            _ => {}
        }
    }
    has_child.then_some(top).flatten()
}

/// Normalizes a zip entry name by stripping redundant `./` prefixes. This is
/// needed to robustly detect common wrapper directories like `repo-branch/` in GitHub
/// archives, which may be prefixed with `./` or not depending on how the zip was created.
fn normalize_zip_entry_name(mut name: &str) -> &str {
    while let Some(rest) = name.strip_prefix("./") {
        name = rest;
    }
    name
}

/// Returns true if the entry should be skipped when extracting a zip archive. This
/// is used to ignore common macOS zip metadata entry cruft like `__MACOSX/` and `.DS_Store`.
fn should_skip_zip_entry(name: &str) -> bool {
    let name = name.trim_end_matches('/');
    name.is_empty()
        || name == "__MACOSX"
        || name.starts_with("__MACOSX/")
        || name
            .split('/')
            .any(|component| component == ".DS_Store" || component == "Icon\r")
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
        let name = normalize_zip_entry_name(&raw_name);
        if should_skip_zip_entry(name) {
            continue;
        }

        // Apply the wrapper-dir strip, skipping the wrapper directory itself.
        let relative = match &strip {
            Some(prefix) => match name.strip_prefix(prefix).and_then(|r| r.strip_prefix('/')) {
                Some(rest) if !rest.is_empty() => rest,
                _ => continue,
            },
            None => name,
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

    let platform: &str = detect_darwin_platform();
    let username = detect_username();
    let hostname = detect_hostname().unwrap_or_else(|_| "localhost".to_string());
    apply_template_placeholders_in_dir(dest, &hostname, platform, &username)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};

    #[test]
    fn parses_owner_repo_shorthand() {
        let r = parse_repo_ref("czxtm/darwin").unwrap();
        assert_eq!(
            r,
            RepoRef {
                clone_url: "https://github.com/czxtm/darwin.git".to_string(),
                git_ref: None,
                subdir: None,
            }
        );
    }

    #[test]
    fn parses_owner_repo_with_ref_and_subdir() {
        let r = parse_repo_ref("czxtm/darwin?ref=main&dir=hosts/work").unwrap();
        assert_eq!(
            r,
            RepoRef {
                clone_url: "https://github.com/czxtm/darwin.git".to_string(),
                git_ref: Some("main".to_string()),
                subdir: Some("hosts/work".to_string()),
            }
        );
    }

    #[test]
    fn parses_full_git_urls_and_consumes_query_params() {
        let r = parse_repo_ref("https://example.com/x/y.git?dir=flakes/mac&ref=dev").unwrap();
        assert_eq!(r.clone_url, "https://example.com/x/y.git");
        assert_eq!(r.git_ref.as_deref(), Some("dev"));
        assert_eq!(r.subdir.as_deref(), Some("flakes/mac"));

        let r = parse_repo_ref("http://example.com/x/y.git?ref=v1").unwrap();
        assert_eq!(r.clone_url, "http://example.com/x/y.git");
        assert_eq!(r.git_ref.as_deref(), Some("v1"));

        let r = parse_repo_ref("ssh://git@example.com/x/y.git?dir=system").unwrap();
        assert_eq!(r.clone_url, "ssh://git@example.com/x/y.git");
        assert_eq!(r.subdir.as_deref(), Some("system"));
    }

    #[test]
    fn trims_input() {
        let r = parse_repo_ref("  https://github.com/czxtm/darwin  ").unwrap();
        assert_eq!(r.clone_url, "https://github.com/czxtm/darwin");
        assert_eq!(r.git_ref, None);
        assert_eq!(r.subdir, None);
    }

    #[test]
    fn strips_dot_git_and_github_host_prefixes() {
        let r = parse_repo_ref("github.com/czxtm/darwin.git").unwrap();
        assert_eq!(r.clone_url, "https://github.com/czxtm/darwin.git");

        let r = parse_repo_ref("/www.github.com/czxtm/darwin/").unwrap_err();
        assert!(r.to_string().contains("Expected a GitHub reference"));

        let r = parse_repo_ref("www.github.com/czxtm/darwin").unwrap();
        assert_eq!(r.clone_url, "https://github.com/czxtm/darwin.git");
    }

    #[test]
    fn parses_scp_like_url() {
        let r = parse_repo_ref("git@github.com:czxtm/darwin.git?ref=main&dir=mac").unwrap();
        assert_eq!(r.clone_url, "git@github.com:czxtm/darwin.git");
        assert_eq!(r.git_ref.as_deref(), Some("main"));
        assert_eq!(r.subdir.as_deref(), Some("mac"));
    }

    #[test]
    fn rejects_empty_and_malformed_refs() {
        assert!(parse_repo_ref("").is_err());
        assert!(parse_repo_ref("   ").is_err());
        assert!(parse_repo_ref("just-a-name").is_err());
        assert!(parse_repo_ref("a/b/c").is_err());
        assert!(parse_repo_ref("bad owner/repo").is_err());
        assert!(parse_repo_ref("owner/bad!repo").is_err());
        assert!(parse_repo_ref("github:owner/repo").is_err());
        assert!(parse_repo_ref("czxtm/darwin#main").is_err());
    }

    #[test]
    fn accepts_valid_github_segment_characters_and_outer_slashes() {
        let r = parse_repo_ref("/some_owner/repo.name-1/").unwrap();
        assert_eq!(r.clone_url, "https://github.com/some_owner/repo.name-1.git");
    }

    #[test]
    fn rejects_invalid_query_parameters() {
        for input in [
            "owner/repo?ref",
            "owner/repo?ref=",
            "owner/repo?dir=",
            "owner/repo?other=value",
            "owner/repo?ref=main&ref=dev",
            "owner/repo?dir=one&dir=two",
        ] {
            assert!(parse_repo_ref(input).is_err(), "accepted {input}");
        }
    }

    #[test]
    fn validates_subdirectories() {
        for subdir in ["/absolute", ".", "..", "a//b", "a/./b", "a/../b", "a/"] {
            let input = format!("owner/repo?dir={subdir}");
            assert!(parse_repo_ref(&input).is_err(), "accepted {subdir}");
        }

        let r = parse_repo_ref("owner/repo?&&dir=a/b&&").unwrap();
        assert_eq!(r.subdir.as_deref(), Some("a/b"));
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
    fn common_top_level_ignores_macos_zip_metadata() {
        let names = vec![
            "nix-darwin-determinate/".to_string(),
            "nix-darwin-determinate/flake.nix".to_string(),
            "nix-darwin-determinate/.DS_Store".to_string(),
            "__MACOSX/".to_string(),
            "__MACOSX/nix-darwin-determinate/._flake.nix".to_string(),
        ];
        assert_eq!(
            common_top_level(&names).as_deref(),
            Some("nix-darwin-determinate")
        );
    }

    #[test]
    fn common_top_level_ignores_current_dir_prefixes() {
        let names = vec![
            "./nix-darwin-determinate/".to_string(),
            "./nix-darwin-determinate/flake.nix".to_string(),
            "./nix-darwin-determinate/modules/default.nix".to_string(),
        ];
        assert_eq!(
            common_top_level(&names).as_deref(),
            Some("nix-darwin-determinate")
        );
    }

    #[test]
    fn common_top_level_none_for_single_empty_directory() {
        let names = vec!["nix-darwin-determinate/".to_string()];
        assert_eq!(common_top_level(&names), None);
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
    fn extract_zip_strips_wrapper_with_macos_metadata() {
        let tmp = tempfile::TempDir::new().unwrap();
        let zip_path = tmp.path().join("repo.zip");
        write_zip(
            &zip_path,
            &[
                ("nix-darwin-determinate/", ""),
                ("nix-darwin-determinate/flake.nix", "{ }"),
                ("nix-darwin-determinate/modules/default.nix", "{ }"),
                ("__MACOSX/", ""),
                ("__MACOSX/nix-darwin-determinate/._flake.nix", ""),
                ("nix-darwin-determinate/.DS_Store", ""),
            ],
        );

        let dest = tmp.path().join("out");
        extract_zip(&zip_path, &dest).unwrap();

        assert!(dest.join("flake.nix").exists());
        assert!(dest.join("modules/default.nix").exists());
        assert!(!dest.join("nix-darwin-determinate").exists());
        assert!(!dest.join("__MACOSX").exists());
        assert!(!dest.join(".DS_Store").exists());
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

    #[test]
    fn extract_zip_processes_nested_nix_templates() {
        let tmp = tempfile::TempDir::new().unwrap();
        let zip_path = tmp.path().join("repo.zip");
        write_zip(
            &zip_path,
            &[
                ("repo-main/", ""),
                (
                    "repo-main/modules/darwin/default.nix",
                    "host = \"HOSTNAME_PLACEHOLDER\"; system = \"PLATFORM_PLACEHOLDER\"; user = \"USERNAME_PLACEHOLDER\";",
                ),
                (
                    "repo-main/modules/darwin/readme.txt",
                    "HOSTNAME_PLACEHOLDER PLATFORM_PLACEHOLDER USERNAME_PLACEHOLDER",
                ),
            ],
        );

        let dest = tmp.path().join("out");
        extract_zip(&zip_path, &dest).unwrap();

        let nix = fs::read_to_string(dest.join("modules/darwin/default.nix")).unwrap();
        assert!(!nix.contains("HOSTNAME_PLACEHOLDER"));
        assert!(!nix.contains("PLATFORM_PLACEHOLDER"));
        assert!(!nix.contains("USERNAME_PLACEHOLDER"));

        let txt = fs::read_to_string(dest.join("modules/darwin/readme.txt")).unwrap();
        assert!(txt.contains("HOSTNAME_PLACEHOLDER"));
        assert!(txt.contains("PLATFORM_PLACEHOLDER"));
        assert!(txt.contains("USERNAME_PLACEHOLDER"));
    }
}
