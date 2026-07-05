//! Default configuration bootstrapping for nix-darwin.
//!
//! This module handles creating a new nix-darwin configuration from
//! bundled templates. It copies the template files, processes placeholders,
//! and initializes a git repository with the initial commit.

use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Manager};

use crate::bootstrap::is_nix_file;
use crate::git;
use crate::storage::store;
use crate::system::nix;

const DEFAULT_TEMPLATE_ID: &str = "nix-darwin-determinate";

fn template_dir_for_id(template_id: Option<&str>) -> Result<&'static str, String> {
    let id = template_id
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .unwrap_or(DEFAULT_TEMPLATE_ID);

    match id {
        "nix-darwin-determinate" => Ok("nix-darwin-determinate"),
        "nixos-unified" => Ok("nixos-unified"),
        "flake-parts" => Ok("base"),
        other => Err(format!("Unknown starter template '{}'", other)),
    }
}

fn render_template_file_name(
    file_name: &OsStr,
    hostname: &str,
    platform: &str,
    username: &str,
) -> OsString {
    let Some(file_name) = file_name.to_str() else {
        return file_name.to_os_string();
    };

    OsString::from(
        file_name
            .replace("{{hostname}}", hostname)
            .replace("HOSTNAME_PLACEHOLDER", hostname)
            .replace("PLATFORM_PLACEHOLDER", platform)
            .replace("USERNAME_PLACEHOLDER", username),
    )
}

/// Strips whitespace and the mDNS `.local` suffix so the result is usable as a
/// nix-darwin configuration attribute name.
fn sanitize_hostname(raw: &str) -> String {
    let trimmed = raw.trim();
    trimmed
        .strip_suffix(".local")
        .unwrap_or(trimmed)
        .to_string()
}

/// Gets the hostname that we're running on.
pub fn detect_hostname() -> Result<String, String> {
    // Prefer `scutil --get LocalHostName`: unlike `hostname`, it never carries
    // the `.local` suffix, which would otherwise end up in the generated
    // darwinConfigurations."<hostname>" flake attribute.
    if let Ok(output) = std::process::Command::new("scutil")
        .args(["--get", "LocalHostName"])
        .output()
    {
        if output.status.success() {
            let name = sanitize_hostname(&String::from_utf8_lossy(&output.stdout));
            if !name.is_empty() {
                return Ok(name);
            }
        }
    }

    let output = std::process::Command::new("hostname")
        .output()
        .map_err(|e| format!("Failed to execute hostname command: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to get hostname: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let hostname = sanitize_hostname(&String::from_utf8_lossy(&output.stdout));
    if hostname.is_empty() {
        return Err("Hostname is empty".to_string());
    }
    Ok(hostname)
}

/// Detects the current macOS username from the environment, defaulting to "unknown" if not found.
pub fn detect_username() -> String {
    let username = whoami::username().unwrap();

    // If we didn't get a user name from this, try the USER environment variable as a fallback before giving up entirely.
    if !username.is_empty() {
        return username;
    }

    std::env::var("USER").unwrap_or_else(|_| "unknown".to_string())
}

/// Detects the Darwin platform architecture.
pub fn detect_darwin_platform() -> &'static str {
    #[cfg(target_arch = "aarch64")]
    {
        "aarch64-darwin"
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        "x86_64-darwin"
    }
}

/// Recursively copies a directory, processing .nix files as templates.
///
/// Template placeholders replaced:
/// - `HOSTNAME_PLACEHOLDER` -> the provided hostname
/// - `PLATFORM_PLACEHOLDER` -> the detected platform (aarch64-darwin or x86_64-darwin)
/// - `USERNAME_PLACEHOLDER` -> the current macOS username
///
/// Template sources are not always trusted (remote template repos arrive as
/// git clones), so VCS state and Finder metadata are never copied, and
/// symlinks are skipped rather than followed — following them would let a
/// hostile template recurse forever (`ln -s . self`) or pull out-of-tree file
/// contents into a config the user may later publish.
fn copy_template_dir(
    src: &Path,
    dest: &Path,
    hostname: &str,
    platform: &str,
    username: &str,
) -> Result<(), String> {
    fs::create_dir_all(dest)
        .map_err(|e| format!("Failed to create directory {}: {}", dest.display(), e))?;

    for entry in fs::read_dir(src)
        .map_err(|e| format!("Failed to read directory {}: {}", src.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let src_path = entry.path();
        if entry.file_name() == ".git" || entry.file_name() == ".DS_Store" {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to inspect {}: {}", src_path.display(), e))?;
        if file_type.is_symlink() {
            log::warn!("Skipping symlink in template: {}", src_path.display());
            continue;
        }
        let file_name = render_template_file_name(&entry.file_name(), hostname, platform, username);
        let dest_path = dest.join(&file_name);

        if file_type.is_dir() {
            // Recursively copy subdirectories
            copy_template_dir(&src_path, &dest_path, hostname, platform, username)?;
        } else if file_type.is_file() {
            // Check if it's a .nix file that needs template processing
            if is_nix_file(&src_path) {
                // Read and process template placeholders using apply_template_placeholders.
                let processed = crate::bootstrap::template::apply_template_placeholders(
                    &src_path, hostname, platform, username,
                )
                .map_err(|e| format!("Failed to process template {}: {}", src_path.display(), e))?;

                fs::write(&dest_path, processed)
                    .map_err(|e| format!("Failed to write {}: {}", dest_path.display(), e))?;
            } else {
                // Copy non-nix files directly
                fs::copy(&src_path, &dest_path)
                    .map_err(|e| format!("Failed to copy {}: {}", src_path.display(), e))?;
            }
        }
    }

    Ok(())
}

/// Validates a hostname destined for template placeholder substitution.
/// The value is spliced into file *names* that pass through `Path::join`, so
/// anything beyond a conservative charset (or a lone `.`/`..`) is rejected to
/// keep every rendered path inside the destination.
pub(crate) fn validate_template_hostname(hostname: &str) -> Result<(), String> {
    let valid_chars = hostname
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if hostname.is_empty() || !valid_chars || hostname == "." || hostname == ".." {
        return Err(format!(
            "Invalid hostname '{}': use letters, digits, '.', '_' and '-'",
            hostname
        ));
    }
    Ok(())
}

/// Checks if a directory is empty or only contains a .git folder.
///
/// This safety check prevents accidentally overwriting existing configurations.
fn is_dir_safe_for_bootstrap(path: &Path) -> Result<bool, String> {
    let entries: Vec<_> = fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|entry| entry.file_name().to_str() != Some(".DS_Store"))
        .collect();

    // Empty directory is safe
    if entries.is_empty() {
        return Ok(true);
    }

    // Only .git directory is safe
    if entries.len() == 1 {
        if let Some(name) = entries[0].file_name().to_str() {
            if name == ".git" {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

/// Resolves the path to the selected bundled template directory.
///
/// Searches in order:
/// 1. Production bundle: `resource_dir/<template_dir>`
/// 2. Alternative structure: `resource_dir/templates/<template_dir>`
/// 3. Legacy Tauri resource path: `resource_dir/_up_/templates/<template_dir>`
/// 4. Development fallback: `CARGO_MANIFEST_DIR/../templates/<template_dir>`
fn resolve_template_path(
    app: &AppHandle,
    template_dir: &str,
) -> Result<std::path::PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .or_else(|_| {
            // Fallback: resolve from executable path
            // Binary is at App.app/Contents/MacOS/nixmac
            // Resources are at App.app/Contents/Resources/
            std::env::current_exe()
                .map_err(tauri::Error::Io)
                .map(|exe| {
                    exe.parent()
                        .expect("binary has a parent directory (Contents/MacOS)")
                        .parent()
                        .expect("binary grandparent directory (Contents)")
                        .join("Resources")
                })
        })
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    #[allow(unused_mut)]
    let mut candidates = vec![
        resource_dir.join(template_dir),
        resource_dir.join(format!("templates/{template_dir}")),
        // Legacy bundling path (Tauri encodes `../` as `_up_/`)
        resource_dir.join(format!("_up_/templates/{template_dir}")),
    ];

    // Dev fallback: only available in debug builds to avoid masking bundling issues
    #[cfg(debug_assertions)]
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../templates/{template_dir}"))
            .to_path_buf(),
    );

    candidates
        .into_iter()
        .find(|p| p.exists() && p.join("flake.nix").exists())
        .ok_or_else(|| {
            format!(
                "Template directory '{}' not found. Searched in: {:?}",
                template_dir, resource_dir
            )
        })
}

/// Creates a new nix-darwin configuration from the bundled template.
///
/// This function:
/// 1. Validates the target directory is empty (safety check)
/// 2. Copies template files, processing .nix files to replace placeholders
/// 3. Initializes a git repository
/// 4. Creates an initial commit (without flake.lock)
///
/// Note: `finalize_flake_lock()` should be called after Nix is confirmed
/// installed to generate flake.lock and create a follow-up commit.
///
/// # Arguments
/// * `app` - Tauri app handle for accessing resources and storage
/// * `hostname` - The hostname for the darwinConfiguration (e.g., "macbook")
///
/// # Errors
/// Returns an error if:
/// - Template directory cannot be found
/// - File operations fail
/// - Git commands fail
pub fn bootstrap_with_template(
    app: &AppHandle,
    hostname: &str,
    template_id: Option<&str>,
) -> Result<(), String> {
    let dir = store::ensure_config_dir_exists(app)
        .map_err(|e| format!("Failed to ensure config dir: {}", e))?;
    let dest_path = Path::new(&dir);

    // If a flake.nix already exists, just make the initial git commit without
    // copying any template files (the user brought their own config).
    if dest_path.join("flake.nix").exists() {
        git::init::init_repo(&dir).map_err(|e| format!("Failed to init git: {}", e))?;
        let info = git::commit_all(&dir, "chore: initial nix-darwin configuration")
            .map_err(|e| format!("Failed to commit: {}", e))?;
        if let Err(e) = git::tag_commit(
            &dir,
            &format!("nixmac-base-{}", &info.hash[..8]),
            &info.hash,
            false,
        ) {
            log::warn!("Failed to tag initial commit as base: {}", e);
        }
        return Ok(());
    }

    let template_dir = template_dir_for_id(template_id)?;
    let template_path = resolve_template_path(app, template_dir)?;

    log::info!("Using template from: {}", template_path.display());

    scaffold_template(
        &template_path,
        &dir,
        hostname,
        detect_darwin_platform(),
        &detect_username(),
    )?;

    if nix::is_nix_installed() {
        if let Err(e) = finalize_flake_lock(app) {
            log::info!("Could not finalize flake.lock during bootstrap: {}", e);
        }
    }

    Ok(())
}

/// Scaffolds a configuration into `dest_dir` from a template directory: the
/// destination-safety check, template copy with placeholder substitution,
/// git init, and the tagged initial commit. Template-agnostic — the source
/// can be a bundled template or a checked-out remote one.
pub fn scaffold_template(
    template_path: &Path,
    dest_dir: &str,
    hostname: &str,
    platform: &str,
    username: &str,
) -> Result<(), String> {
    validate_template_hostname(hostname)?;

    // Safety check: only proceed if directory is empty or git-only. It lives
    // here, next to the code that writes, so every scaffold path gets it.
    let dest_path = Path::new(dest_dir);
    if !is_dir_safe_for_bootstrap(dest_path)
        .map_err(|e| format!("Failed to check bootstrap safety: {}", e))?
    {
        return Err(format!(
            "Target directory '{}' is not empty. Remove existing files before bootstrapping.",
            dest_path.display()
        ));
    }

    // Copy and process all template files recursively
    copy_template_dir(template_path, dest_path, hostname, platform, username)?;

    // Initialize git repository and commit templates
    git::init::init_repo(dest_dir).map_err(|e| format!("Failed to init git: {}", e))?;
    let info = git::commit_all(dest_dir, "chore: initial nix-darwin configuration")
        .map_err(|e| format!("Failed to commit: {}", e))?;
    if let Err(e) = git::tag_commit(
        dest_dir,
        &format!("nixmac-base-{}", &info.hash[..8]),
        &info.hash,
        false,
    ) {
        log::warn!("Failed to tag initial commit as base: {}", e);
    }

    Ok(())
}

/// Generates flake.lock and commits it as a follow-up to bootstrap.
///
/// This should be called after Nix is confirmed installed. It runs
/// `nix flake lock` in the config directory, then stages and commits
/// the generated flake.lock file.
pub fn finalize_flake_lock(app: &AppHandle) -> Result<(), String> {
    let dir = store::ensure_config_dir_exists(app)
        .map_err(|e| format!("Failed to ensure config dir: {}", e))?;

    // Generate flake.lock
    let flake_lock_result = Command::new("nix")
        .args(["flake", "lock"])
        .current_dir(&dir)
        .env("PATH", nix::get_nix_path())
        .output()
        .map_err(|e| format!("Failed to run nix flake lock: {}", e))?;

    if !flake_lock_result.status.success() {
        return Err(format!(
            "Failed to generate flake.lock: {}",
            String::from_utf8_lossy(&flake_lock_result.stderr)
        ));
    }

    // Stage lock file and commit. A template may ship a complete flake.lock
    // that `nix flake lock` leaves untouched — already committed, nothing to
    // do.
    let info = match git::commit_all(&dir, "chore: add flake.lock") {
        Ok(info) => info,
        Err(e) if e.to_string().contains("nothing to commit") => return Ok(()),
        Err(e) => return Err(format!("Failed to commit flake.lock: {}", e)),
    };
    if let Err(e) = git::tag_commit(
        &dir,
        &format!("nixmac-base-{}", &info.hash[..8]),
        &info.hash,
        false,
    ) {
        log::warn!("Failed to tag flake.lock commit as base: {}", e);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_darwin_platform() {
        let platform = detect_darwin_platform();
        assert!(platform == "aarch64-darwin" || platform == "x86_64-darwin");
    }

    #[test]
    fn bootstrap_safety_ignores_finder_metadata() {
        let temp = tempfile::tempdir().expect("create temp dir");
        fs::write(temp.path().join(".DS_Store"), "").expect("create finder metadata");

        assert!(is_dir_safe_for_bootstrap(temp.path()).expect("check directory"));
    }

    #[test]
    fn bootstrap_safety_allows_git_with_finder_metadata() {
        let temp = tempfile::tempdir().expect("create temp dir");
        fs::create_dir_all(temp.path().join(".git")).expect("create git dir");
        fs::write(temp.path().join(".DS_Store"), "").expect("create finder metadata");

        assert!(is_dir_safe_for_bootstrap(temp.path()).expect("check directory"));
    }

    #[test]
    fn copy_template_dir_skips_vcs_metadata_and_symlinks() {
        let src = tempfile::tempdir().expect("create source dir");
        fs::create_dir_all(src.path().join(".git/objects")).expect("create git dir");
        fs::write(src.path().join(".git/HEAD"), "ref").expect("create git file");
        fs::write(src.path().join(".DS_Store"), "").expect("create finder metadata");
        fs::write(src.path().join("flake.nix"), "{ }").expect("create flake");

        let outside = tempfile::tempdir().expect("create outside dir");
        fs::write(outside.path().join("secret"), "leak").expect("create outside file");
        std::os::unix::fs::symlink(outside.path().join("secret"), src.path().join("linked.nix"))
            .expect("create symlink");
        // A self-referential symlink must not cause unbounded recursion.
        std::os::unix::fs::symlink(src.path(), src.path().join("loop")).expect("create loop");

        let dest = tempfile::tempdir().expect("create dest dir");
        copy_template_dir(src.path(), dest.path(), "host", "aarch64-darwin", "user")
            .expect("copy template");

        assert!(dest.path().join("flake.nix").is_file());
        assert!(!dest.path().join(".git").exists());
        assert!(!dest.path().join(".DS_Store").exists());
        assert!(!dest.path().join("linked.nix").exists());
        assert!(!dest.path().join("loop").exists());
    }

    #[test]
    fn validate_template_hostname_rejects_path_escapes() {
        assert!(validate_template_hostname("Coopers-MacBook-Pro").is_ok());
        assert!(validate_template_hostname("host.1_x").is_ok());

        for bad in ["", ".", "..", "a/b", "../evil", "host name", "host\n"] {
            assert!(validate_template_hostname(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn scaffold_template_creates_tagged_initial_commit() {
        let src = tempfile::tempdir().expect("create source dir");
        fs::write(
            src.path().join("flake.nix"),
            "darwinConfigurations.HOSTNAME_PLACEHOLDER = { };",
        )
        .expect("create flake");

        let dest = tempfile::tempdir().expect("create dest dir");
        let dest_dir = dest.path().to_string_lossy().to_string();
        scaffold_template(src.path(), &dest_dir, "my-mac", "aarch64-darwin", "user")
            .expect("scaffold");

        let flake = fs::read_to_string(dest.path().join("flake.nix")).expect("read flake");
        assert!(flake.contains("darwinConfigurations.my-mac"));

        let repo = git2::Repository::open(dest.path()).expect("open repo");
        let head = repo.head().expect("head").peel_to_commit().expect("commit");
        assert_eq!(head.parent_count(), 0);
        assert!(repo.remotes().expect("remotes").is_empty());
        let tags = repo.tag_names(Some("nixmac-base-*")).expect("tags");
        assert_eq!(tags.len(), 1);
    }

    #[test]
    fn scaffold_template_rejects_non_empty_destination() {
        let src = tempfile::tempdir().expect("create source dir");
        fs::write(src.path().join("flake.nix"), "{ }").expect("create flake");

        let dest = tempfile::tempdir().expect("create dest dir");
        fs::write(dest.path().join("existing"), "keep").expect("create existing file");
        let dest_dir = dest.path().to_string_lossy().to_string();

        let err = scaffold_template(src.path(), &dest_dir, "my-mac", "aarch64-darwin", "user")
            .expect_err("must reject");
        assert!(err.contains("not empty"));
    }

    #[test]
    fn sanitize_hostname_strips_local_suffix_and_whitespace() {
        assert_eq!(
            sanitize_hostname("Coopers-MacBook-Pro.local\n"),
            "Coopers-MacBook-Pro"
        );
        assert_eq!(
            sanitize_hostname("Coopers-MacBook-Pro"),
            "Coopers-MacBook-Pro"
        );
        assert_eq!(sanitize_hostname("  \n"), "");
    }

    #[test]
    fn template_dir_for_id_defaults_to_embedded_template() {
        assert_eq!(
            template_dir_for_id(None).expect("default template"),
            "nix-darwin-determinate"
        );
    }

    #[test]
    fn template_dir_for_id_maps_supported_starter_templates() {
        assert_eq!(
            template_dir_for_id(Some("nixos-unified")).expect("nixos-unified template"),
            "nixos-unified"
        );
        assert_eq!(
            template_dir_for_id(Some("flake-parts")).expect("flake-parts template"),
            "base"
        );
    }

    #[test]
    fn template_dir_for_id_rejects_unknown_template_ids() {
        let err = template_dir_for_id(Some("dotfiles")).expect_err("unknown template id");

        assert!(err.contains("Unknown starter template"));
    }

    #[test]
    fn render_template_file_name_replaces_supported_placeholders() {
        let rendered = render_template_file_name(
            std::ffi::OsStr::new("{{hostname}}-HOSTNAME_PLACEHOLDER-USERNAME_PLACEHOLDER.nix"),
            "macbook",
            "aarch64-darwin",
            "cooper",
        );

        assert_eq!(
            rendered,
            std::ffi::OsString::from("macbook-macbook-cooper.nix")
        );
    }

    #[test]
    fn copy_template_dir_renders_real_starter_template_host_paths() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../templates/base");
        let dest = temp.path().join("base");

        copy_template_dir(&source, &dest, "macbook", "aarch64-darwin", "cooper")
            .expect("copy base starter");

        let darwin_module =
            fs::read_to_string(dest.join("flake-modules/darwin.nix")).expect("read darwin module");
        assert!(dest.join("hosts/macbook/default.nix").exists());
        assert!(darwin_module.contains("darwinConfigurations = {"));
        assert!(darwin_module.contains("\"macbook\" = inputs.darwin.lib.darwinSystem"));
        assert!(!darwin_module.contains("HOSTNAME_PLACEHOLDER"));
    }

    #[test]
    fn copy_template_dir_renders_real_nixos_unified_host_paths() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../templates/nixos-unified");
        let dest = temp.path().join("nixos-unified");

        copy_template_dir(&source, &dest, "macbook", "aarch64-darwin", "cooper")
            .expect("copy nixos-unified starter");

        let darwin_config = fs::read_to_string(dest.join("configurations/darwin/macbook.nix"))
            .expect("read rendered darwin config");
        assert!(darwin_config.contains("networking.hostName = \"macbook\";"));
        assert!(darwin_config.contains("system.primaryUser = \"cooper\";"));
        assert!(!darwin_config.contains("HOSTNAME_PLACEHOLDER"));
    }
}
