//! Default configuration bootstrapping for nix-darwin.
//!
//! This module handles creating a new nix-darwin configuration from
//! bundled templates. It copies the template files, processes placeholders,
//! and initializes a git repository with the initial commit.

use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Manager};

use crate::{git, nix, store};

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
        let file_name = entry.file_name();
        let dest_path = dest.join(&file_name);

        if src_path.is_dir() {
            // Recursively copy subdirectories
            copy_template_dir(&src_path, &dest_path, hostname, platform, username)?;
        } else if src_path.is_file() {
            // Check if it's a .nix file that needs template processing
            let is_nix_file = src_path
                .extension()
                .map(|ext| ext == "nix")
                .unwrap_or(false);

            if is_nix_file {
                // Read and process template placeholders
                let content = fs::read_to_string(&src_path)
                    .map_err(|e| format!("Failed to read {}: {}", src_path.display(), e))?;

                let processed = content
                    .replace("HOSTNAME_PLACEHOLDER", hostname)
                    .replace("PLATFORM_PLACEHOLDER", platform)
                    .replace("USERNAME_PLACEHOLDER", username);

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

/// Checks if a directory is empty or only contains a .git folder.
///
/// This safety check prevents accidentally overwriting existing configurations.
fn is_dir_safe_for_bootstrap(path: &Path) -> Result<bool, String> {
    let entries: Vec<_> = fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|e| e.ok())
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

/// Resolves the path to the bundled template directory.
///
/// Searches in order:
/// 1. Production bundle: `resource_dir/nix-darwin-determinate`
/// 2. Alternative structure: `resource_dir/templates/nix-darwin-determinate`
/// 3. Development fallback: `CARGO_MANIFEST_DIR/../templates/nix-darwin-determinate`
fn resolve_template_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .or_else(|_| {
            // Fallback: resolve from executable path
            // Binary is at App.app/Contents/MacOS/nixmac
            // Resources are at App.app/Contents/Resources/
            std::env::current_exe()
                .map_err(tauri::Error::Io)
                .map(|exe| exe.parent().unwrap().parent().unwrap().join("Resources"))
        })
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    #[allow(unused_mut)]
    let mut candidates = vec![
        resource_dir.join("nix-darwin-determinate"),
        resource_dir.join("templates/nix-darwin-determinate"),
        // Legacy bundling path (Tauri encodes `../` as `_up_/`)
        resource_dir.join("_up_/templates/nix-darwin-determinate"),
    ];

    // Dev fallback: only available in debug builds to avoid masking bundling issues
    #[cfg(debug_assertions)]
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../templates/nix-darwin-determinate")
            .to_path_buf(),
    );

    candidates
        .into_iter()
        .find(|p| p.exists() && p.join("flake.nix").exists())
        .ok_or_else(|| {
            format!(
                "Template directory not found. Searched in: {:?}",
                resource_dir
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
/// - The target directory is not empty
/// - Template directory cannot be found
/// - File operations fail
/// - Git commands fail
pub fn bootstrap(app: &AppHandle, hostname: &str) -> Result<(), String> {
    let dir = store::ensure_config_dir_exists(app)
        .map_err(|e| format!("Failed to ensure config dir: {}", e))?;
    let dest_path = Path::new(&dir);

    // Safety check: only proceed if directory is empty or contains only .git
    if !is_dir_safe_for_bootstrap(dest_path)? {
        return Err(
            "Directory is not empty. Please use an empty directory or remove existing files."
                .to_string(),
        );
    }

    let platform = detect_darwin_platform();
    let username = std::env::var("USER").unwrap_or_else(|_| "unknown".to_string());
    let template_path = resolve_template_path(app)?;

    log::info!("Using template from: {}", template_path.display());

    // Copy and process all template files recursively
    copy_template_dir(&template_path, dest_path, hostname, platform, &username)?;

    // Initialize git repository and commit templates (without flake.lock)
    git::init_repo(&dir).map_err(|e| format!("Failed to init git: {}", e))?;
    let info = git::commit_all(&dir, "chore: initial nix-darwin configuration")
        .map_err(|e| format!("Failed to commit: {}", e))?;
    if let Err(e) = git::tag_commit(&dir, &format!("nixmac-base-{}", &info.hash[..8]), &info.hash, false) {
        log::warn!("Failed to tag initial commit as base: {}", e);
    }

    if nix::is_nix_installed() {
        if let Err(e) = finalize_flake_lock(app) {
            log::info!("Could not finalize flake.lock during bootstrap: {}", e);
        }
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
    let flake_lock_result = Command::new(nix::nix_executable())
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

    // Stage lock file and commit
    let info = git::commit_all(&dir, "chore: add flake.lock")
        .map_err(|e| format!("Failed to commit flake.lock: {}", e))?;
    if let Err(e) = git::tag_commit(&dir, &format!("nixmac-base-{}", &info.hash[..8]), &info.hash, false) {
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
}
