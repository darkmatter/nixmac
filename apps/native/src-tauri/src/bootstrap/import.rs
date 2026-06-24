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
use git2::{Cred, CredentialType, FetchOptions, RemoteCallbacks};
use std::fs::File;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

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
    /// Repository owner parsed from the locator.
    pub owner: String,
    /// Repository name parsed from the locator, without a trailing `.git`.
    pub repo: String,
}

/// Sanitize a clone URL for logging, removing any embedded credentials.
fn sanitize_clone_url_for_logs(clone_url: &str) -> String {
    if let Ok(mut url) = url::Url::parse(clone_url) {
        let _ = url.set_username("");
        let _ = url.set_password(None);
        return url.to_string();
    }

    if let Some((_, rest)) = clone_url.split_once('@') {
        if rest.contains(':') {
            return format!("***@{}", rest);
        }
    }

    clone_url.to_string()
}

fn is_valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Checks if the given clone URL is a GitHub URL, either in HTTPS or SSH form.
fn is_github_clone_url(clone_url: &str) -> bool {
    if clone_url.starts_with("git@github.com:") {
        return true;
    }

    url::Url::parse(clone_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .is_some_and(|host| host.eq_ignore_ascii_case("github.com"))
}

/// Parses one of our repository locator forms into an owner/repo pair, stripping any `.git` suffix and optional `github.com/` prefix.
/// This is used to populate the `owner` and `repo` fields of `RepoRef`, which are actually only necessary for the GitHub App token retrieval logic.
fn owner_and_repo(locator: &str) -> Result<(String, String)> {
    let path = if ["https://", "http://", "ssh://"]
        .iter()
        .any(|scheme| locator.starts_with(scheme))
    {
        let url = url::Url::parse(locator)
            .with_context(|| format!("Invalid repository URL: '{}'", locator))?;
        url.path().trim_matches('/').to_string()
    } else if let Some((_, path)) = locator
        .split_once(':')
        .filter(|_| locator.starts_with("git@"))
    {
        path.trim_matches('/').to_string()
    } else {
        locator
            .strip_prefix("github.com/")
            .or_else(|| locator.strip_prefix("www.github.com/"))
            .unwrap_or(locator)
            .trim_matches('/')
            .to_string()
    };

    let mut parts = path.rsplit('/');
    let repo = parts
        .next()
        .map(|repo| repo.strip_suffix(".git").unwrap_or(repo))
        .unwrap_or_default();
    let owner = parts.next().unwrap_or_default();

    if !is_valid_segment(owner) || !is_valid_segment(repo) {
        bail!("Expected a repository reference like 'owner/repo'");
    }

    Ok((owner.to_string(), repo.to_string()))
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
    let (owner, repo) = owner_and_repo(locator)?;

    // Full URL forms.
    let is_full_url = ["https://", "http://", "ssh://"]
        .iter()
        .any(|scheme| locator.starts_with(scheme));

    if is_full_url {
        return Ok(RepoRef {
            clone_url: locator.to_string(),
            git_ref,
            subdir,
            owner,
            repo,
        });
    }

    // SCP-style SSH form.
    if locator.starts_with("git@") {
        return Ok(RepoRef {
            clone_url: locator.to_string(),
            git_ref,
            subdir,
            owner,
            repo,
        });
    }

    // Strip optional GitHub hostname.
    let path = locator
        .strip_prefix("github.com/")
        .or_else(|| locator.strip_prefix("www.github.com/"))
        .unwrap_or(locator);

    let path = path.trim_matches('/');

    let mut parts = path.split('/');
    let (Some(parsed_owner), Some(parsed_repo), None) = (parts.next(), parts.next(), parts.next())
    else {
        bail!("Expected a GitHub reference like 'owner/repo'");
    };

    let parsed_repo = parsed_repo.strip_suffix(".git").unwrap_or(parsed_repo);

    if !is_valid_segment(parsed_owner) || !is_valid_segment(parsed_repo) {
        bail!("Invalid GitHub reference: '{}'", trimmed);
    }

    Ok(RepoRef {
        clone_url: format!("https://github.com/{owner}/{repo}.git"),
        git_ref,
        subdir,
        owner,
        repo,
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

/// Clones the repository specified by `spec` into `dest`, then copies the specified
/// subdirectory (if any) into `dest`, stripping the wrapper directory that git sparse
/// sparse checkout would normally require. This allows us to support subdirectory imports
/// without forcing users to understand git's sparse checkout semantics. When an app handle
/// is available, GitHub clones first try a short-lived GitHub App token; missing or failed
/// token retrieval falls back to the user's normal git credentials.
pub fn materialize_repo(app: Option<AppHandle>, spec: &RepoRef, dest: &Path) -> Result<()> {
    // We're going to have issues later if `dest` already exists as a non-empty directory, so check that upfront before doing any cloning.
    if dest.exists() {
        if !dest.is_dir() {
            bail!(
                "destination exists and is not a directory: {}",
                dest.display()
            );
        } else if dest.read_dir()?.next().is_some() {
            bail!("destination directory is not empty: {}", dest.display());
        }
    }

    let mut clone_spec = spec.clone();
    let clone_token = app
        .as_ref()
        .filter(|_| is_github_clone_url(&spec.clone_url))
        .and_then(|app| {
            match tauri::async_runtime::block_on(crate::sync::github_clone_token(
                app,
                &spec.owner,
                &spec.repo,
            )) {
                Ok(token) => {
                    clone_spec.clone_url = token.clone_url;
                    Some(token.token)
                }
                Err(error) => {
                    log::warn!(
                        "Could not retrieve a GitHub App clone token for {}/{}; falling back to configured git credentials: {error:#}",
                        spec.owner,
                        spec.repo,
                    );
                    None
                }
            }
        });

    // Easy case. No subdirectory means we can clone directly into the destination.
    if spec.subdir.is_none() {
        return clone_repo(&clone_spec, dest, clone_token.as_deref());
    }

    let temp = tempfile::tempdir().context("failed to create temporary clone directory")?;
    let checkout_dir = temp.path().join("repo");

    // Perform the actual clone into a temp directory, then copy the specified subdirectory into the final destination.
    clone_repo(&clone_spec, &checkout_dir, clone_token.as_deref())?;

    let subdir = spec.subdir.as_ref().unwrap();
    let source = checkout_dir.join(subdir);

    if !source.is_dir() {
        bail!(
            "subdirectory '{}' does not exist in {}",
            subdir,
            sanitize_clone_url_for_logs(&spec.clone_url),
        );
    }

    copy_dir_contents(&source, dest)
        .with_context(|| format!("failed to copy subdirectory '{}' into destination", subdir))?;

    Ok(())
}

/// Clones `spec` into `dest`. `dest` must not already exist as a non-empty
/// directory (libgit2 requires an empty/absent target).
/// It will use a temporary token if provided, otherwise it will try to proceed with default credentials
/// from the ssh agent or the user's git config.
fn clone_repo(spec: &RepoRef, dest: &Path, token: Option<&str>) -> Result<()> {
    log::info!(
        "Cloning {} into {} at {}",
        sanitize_clone_url_for_logs(&spec.clone_url),
        dest.display(),
        spec.git_ref.as_deref().unwrap_or("default branch")
    );
    let mut builder = git2::build::RepoBuilder::new();
    if let Some(branch) = &spec.git_ref {
        builder.branch(branch);
    }

    let git_config = git2::Config::open_default().ok();
    let mut token_attempted = false;
    let mut ssh_agent_attempted = false;
    let mut credential_helper_attempted = false;
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |url, username_from_url, allowed| {
        if allowed.contains(git2::CredentialType::USERNAME) {
            return Cred::username(username_from_url.unwrap_or("git"));
        }

        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) && !token_attempted {
            token_attempted = true;
            if let Some(token) = token {
                return Cred::userpass_plaintext("x-access-token", token);
            }
        }

        if allowed.contains(git2::CredentialType::SSH_KEY) && !ssh_agent_attempted {
            ssh_agent_attempted = true;
            return Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"));
        }

        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT)
            && !credential_helper_attempted
        {
            credential_helper_attempted = true;
            if let Some(config) = &git_config {
                if let Ok(credential) = Cred::credential_helper(config, url, username_from_url) {
                    return Ok(credential);
                }
            }
        }

        if allowed.contains(git2::CredentialType::DEFAULT) {
            return Cred::default();
        }

        Err(git2::Error::from_str(
            "no supported authentication methods succeeded",
        ))
    });

    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);

    builder.fetch_options(fetch_options);

    if let Err(error) = builder.clone(&spec.clone_url, dest) {
        log::error!(
            "libgit2 clone failed: clone_url={}, destination={}, git_ref={:?}, libgit2_code={:?}, libgit2_class={:?}, libgit2_message={}, error={}",
            sanitize_clone_url_for_logs(&spec.clone_url),
            dest.display(),
            spec.git_ref,
            error.code(),
            error.class(),
            error.message(),
            error
        );

        bail!(
            "failed to clone {}, detail = {}",
            sanitize_clone_url_for_logs(&spec.clone_url),
            error
        );
    }
    Ok(())
}

/// Copies the contents of `source` into `dest`, creating `dest`. Assumes `dest` does not exist or is empty as a precondition.
fn copy_dir_contents(source: &Path, dest: &Path) -> Result<()> {
    std::fs::create_dir_all(dest)
        .with_context(|| format!("failed to create destination {}", dest.display()))?;

    for entry in std::fs::read_dir(source)
        .with_context(|| format!("failed to read source directory {}", source.display()))?
    {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());

        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_file() {
            std::fs::copy(&from, &to).with_context(|| {
                format!("failed to copy {} to {}", from.display(), to.display())
            })?;
        } else if file_type.is_symlink() {
            copy_symlink(&from, &to)?;
        }
    }

    Ok(())
}

fn copy_dir_recursive(source: &Path, dest: &Path) -> Result<()> {
    std::fs::create_dir_all(dest)
        .with_context(|| format!("failed to create directory {}", dest.display()))?;

    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_file() {
            std::fs::copy(&from, &to).with_context(|| {
                format!("failed to copy {} to {}", from.display(), to.display())
            })?;
        } else if file_type.is_symlink() {
            // Yes, git repos can contain symlinks, and we need to preserve them when copying subdirectories out of the temp clone.
            copy_symlink(&from, &to)?;
        }
    }

    Ok(())
}

#[cfg(unix)]
fn copy_symlink(source: &Path, dest: &Path) -> Result<()> {
    let target = std::fs::read_link(source)
        .with_context(|| format!("failed to read symlink {}", source.display()))?;

    std::os::unix::fs::symlink(&target, dest)
        .with_context(|| format!("failed to create symlink {}", dest.display()))?;

    Ok(())
}

#[cfg(not(unix))]
fn copy_symlink(source: &Path, _dest: &Path) -> Result<()> {
    bail!(
        "symlinks are not supported on this platform: {}",
        source.display()
    )
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

    fn create_local_repo(path: &Path) -> git2::Repository {
        let repo = git2::Repository::init(path).unwrap();

        fs::create_dir_all(path.join("config/modules")).unwrap();
        fs::write(path.join("README.md"), "repository root").unwrap();
        fs::write(path.join("config/flake.nix"), "default branch").unwrap();
        fs::write(path.join("config/modules/default.nix"), "{ }").unwrap();

        let mut index = repo.index().unwrap();
        index
            .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("Test User", "test@example.com").unwrap();
        let initial_id = repo
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "initial commit",
                &tree,
                &[],
            )
            .unwrap();
        drop(tree);

        let initial = repo.find_commit(initial_id).unwrap();
        repo.branch("import-me", &initial, false).unwrap();
        drop(initial);

        repo.set_head("refs/heads/import-me").unwrap();
        repo.checkout_head(None).unwrap();
        fs::write(path.join("config/flake.nix"), "import branch").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("config/flake.nix")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let parent = repo.find_commit(initial_id).unwrap();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "branch commit",
            &tree,
            &[&parent],
        )
        .unwrap();
        drop(parent);
        drop(tree);

        repo.set_head("refs/heads/master").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();

        repo
    }

    #[test]
    fn materialize_repo_clones_requested_branch_from_local_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("source");
        let _repo = create_local_repo(&source);
        let dest = tmp.path().join("dest");
        let spec = RepoRef {
            clone_url: source.to_string_lossy().into_owned(),
            git_ref: Some("import-me".to_string()),
            subdir: None,
            owner: "local".to_string(),
            repo: "source".to_string(),
        };

        materialize_repo(None, &spec, &dest).unwrap();

        assert_eq!(
            fs::read_to_string(dest.join("config/flake.nix")).unwrap(),
            "import branch"
        );
        assert!(dest.join(".git").is_dir());
        let cloned_repo = git2::Repository::open(&dest).unwrap();
        let head = cloned_repo.head().unwrap();
        assert_eq!(head.shorthand().unwrap(), "import-me");
    }

    #[test]
    fn materialize_repo_copies_only_requested_subdirectory() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("source");
        let _repo = create_local_repo(&source);
        let dest = tmp.path().join("dest");
        let spec = RepoRef {
            clone_url: source.to_string_lossy().into_owned(),
            git_ref: None,
            subdir: Some("config".to_string()),
            owner: "local".to_string(),
            repo: "source".to_string(),
        };

        materialize_repo(None, &spec, &dest).unwrap();

        assert_eq!(
            fs::read_to_string(dest.join("flake.nix")).unwrap(),
            "default branch"
        );
        assert!(dest.join("modules/default.nix").is_file());
        assert!(!dest.join("config").exists());
        assert!(!dest.join("README.md").exists());
        assert!(!dest.join(".git").exists());
    }

    #[test]
    fn parses_owner_repo_shorthand() {
        let r = parse_repo_ref("czxtm/darwin").unwrap();
        assert_eq!(
            r,
            RepoRef {
                clone_url: "https://github.com/czxtm/darwin.git".to_string(),
                git_ref: None,
                subdir: None,
                owner: "czxtm".to_string(),
                repo: "darwin".to_string(),
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
                owner: "czxtm".to_string(),
                repo: "darwin".to_string(),
            }
        );
    }

    #[test]
    fn parses_full_git_urls_and_consumes_query_params() {
        let r = parse_repo_ref("https://example.com/x/y.git?dir=flakes/mac&ref=dev").unwrap();
        assert_eq!(r.clone_url, "https://example.com/x/y.git");
        assert_eq!(r.git_ref.as_deref(), Some("dev"));
        assert_eq!(r.subdir.as_deref(), Some("flakes/mac"));
        assert_eq!(r.owner, "x");
        assert_eq!(r.repo, "y");

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
        assert_eq!(r.owner, "czxtm");
        assert_eq!(r.repo, "darwin");
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

    #[test]
    fn test_sanitize_clone_url_for_logs() {
        let url = "https://user:password@github.com/repo.git";
        let sanitized = sanitize_clone_url_for_logs(url);
        assert_eq!(sanitized, "https://github.com/repo.git");

        // SSH
        let url = "ssh://user:password@github.com/repo.git";
        let sanitized = sanitize_clone_url_for_logs(url);
        assert_eq!(sanitized, "ssh://github.com/repo.git");

        // SCP-style with git://.
        let url = "git://user:password@github.com/repo.git";
        let sanitized = sanitize_clone_url_for_logs(url);
        assert_eq!(sanitized, "git://github.com/repo.git");
    }

    #[test]
    fn token_credential_uses_plaintext_userpass_when_allowed() {
        let credential =
            token_credential("github-token", None, CredentialType::USER_PASS_PLAINTEXT);

        assert!(credential.is_ok());
    }

    #[test]
    fn token_credential_fails_when_plaintext_userpass_not_allowed() {
        let credential = token_credential("github-token", None, CredentialType::SSH_KEY);

        assert!(credential.is_err());
    }
}

fn token_credential(
    token: &str,
    username_from_url: Option<&str>,
    allowed: CredentialType,
) -> std::result::Result<Cred, git2::Error> {
    if token.is_empty() || !allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
        return Err(git2::Error::from_str(
            "token authentication requires plaintext username/password credentials",
        ));
    }

    Cred::userpass_plaintext(username_from_url.unwrap_or("x-access-token"), token)
}
