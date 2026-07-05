//! Onboarding lifecycle commands.

use super::config::{ImportTarget, cleanup_import_target};
use super::helpers::capture_err;
use crate::shared_types;
use crate::state::{evolve_state, git_state, preferences, rebuild_status, watcher};
use crate::storage::{canonical_config, legacy_kv};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Rewinds onboarding to the config-dir step by clearing every durable fact
/// the step machine derives progress from. When the current config directory
/// was materialized by onboarding itself (import/scaffold) and no build has
/// been applied from it yet, its contents are deleted too, so the next import
/// finds an empty target — that is what makes "Restart setup" idempotent.
///
/// System-state gates (permissions, Nix install) are untouched: they re-derive
/// as satisfied and the flow lands on the first user-driven step.
pub async fn onboarding_reset(app: AppHandle) -> Result<shared_types::OkResult, String> {
    // The build step is exactly where users wait long enough to reach for
    // "Restart setup"; wiping the directory under a running rebuild stream
    // must be impossible.
    if rebuild_status::get(&app).is_running {
        return Err(
            "A build is currently running. Wait for it to finish before restarting setup."
                .to_string(),
        );
    }

    let prefs = preferences::try_read(&app)
        .ok_or_else(|| capture_err("onboarding_reset", "Preferences not loaded"))?;

    // Stop polling before the directory disappears; the watcher would emit a
    // git_state_error on every tick against a deleted path.
    watcher::stop_watching();

    if let Some(root) = provisional_root_to_wipe(
        prefs.onboarding_provisional_config_dir.as_deref(),
        prefs.config_dir.as_deref(),
        prefs.onboarding_last_build_at,
    ) {
        // The canonical /etc/nix-darwin must stay in place (privileged
        // creation); anything else onboarding materialized can go entirely.
        cleanup_import_target(&ImportTarget {
            created: !canonical_config::is_canonical_config_path(&root),
            path: root,
        });
    }

    // No new dir is being selected, so `handle_new_config_dir` will not run —
    // clear the derived cells explicitly.
    git_state::update(
        &app,
        shared_types::GitState {
            git_status: None,
            external_build_detected: false,
        },
    );
    if let Err(e) = evolve_state::clear(&app) {
        log::warn!("Failed to clear evolve state during onboarding reset: {e:#}");
    }

    preferences::write(&app, |prefs| {
        prefs.config_dir = None;
        prefs.repo_root = None;
        prefs.host_attr = None;
        prefs.onboarding_mac_scanned_at = None;
        prefs.onboarding_login_decided = false;
        prefs.onboarding_last_build_at = None;
        prefs.onboarding_provisional_config_dir = None;
    })
    .map_err(|e| capture_err("onboarding_reset", e))?;

    // The migration keeps legacy keys around for reversibility, and
    // `get_config_dir_if_set` falls back to them — without this the old
    // selection would silently resurrect for every backend caller.
    if let Err(e) = legacy_kv::delete_legacy_key(&app, "configDir") {
        log::warn!("Failed to clear legacy configDir during onboarding reset: {e:#}");
    }

    Ok(shared_types::OkResult::yes())
}

/// Decides whether a reset may delete the materialized directory: only when
/// onboarding still owns it (marker set, no successful apply yet) and the
/// active config dir really lives at or under the recorded root — a marker
/// pointing anywhere else is stale and must not delete anything.
pub(super) fn provisional_root_to_wipe(
    provisional_root: Option<&str>,
    config_dir: Option<&str>,
    last_build_at: Option<i64>,
) -> Option<PathBuf> {
    if last_build_at.is_some() {
        return None;
    }
    let root = PathBuf::from(provisional_root?);
    let config_dir = PathBuf::from(config_dir?);
    if !root.is_dir() {
        return None;
    }
    // Canonicalize both sides: /tmp vs /private/tmp aliasing and symlinked
    // selections would otherwise defeat a plain prefix comparison.
    if !canonicalized(&config_dir).starts_with(canonicalized(&root)) {
        return None;
    }
    Some(root)
}

pub(super) fn canonicalized(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("nixmac-onboarding-{name}-{nonce}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn wipes_when_config_dir_is_the_provisional_root() {
        let root = temp_dir("root-eq");
        let root_str = root.to_string_lossy().to_string();

        let decision = provisional_root_to_wipe(Some(&root_str), Some(&root_str), None);
        assert_eq!(decision, Some(root.clone()));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn wipes_when_config_dir_is_nested_in_the_provisional_root() {
        let root = temp_dir("root-nested");
        let subdir = root.join("flakes/darwin");
        std::fs::create_dir_all(&subdir).unwrap();

        let decision = provisional_root_to_wipe(
            Some(&root.to_string_lossy()),
            Some(&subdir.to_string_lossy()),
            None,
        );
        assert_eq!(decision, Some(root.clone()));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn never_wipes_after_a_successful_build() {
        let root = temp_dir("root-built");
        let root_str = root.to_string_lossy().to_string();

        let decision = provisional_root_to_wipe(Some(&root_str), Some(&root_str), Some(1));
        assert_eq!(decision, None);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn never_wipes_when_config_dir_is_outside_the_marker() {
        let root = temp_dir("root-stale");
        let elsewhere = temp_dir("elsewhere");

        let decision = provisional_root_to_wipe(
            Some(&root.to_string_lossy()),
            Some(&elsewhere.to_string_lossy()),
            None,
        );
        assert_eq!(decision, None);

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&elsewhere);
    }

    #[test]
    fn never_wipes_without_marker_or_config_dir() {
        let root = temp_dir("root-none");
        let root_str = root.to_string_lossy().to_string();

        assert_eq!(provisional_root_to_wipe(None, Some(&root_str), None), None);
        assert_eq!(provisional_root_to_wipe(Some(&root_str), None, None), None);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn never_wipes_a_missing_directory() {
        let root = temp_dir("root-gone");
        let root_str = root.to_string_lossy().to_string();
        std::fs::remove_dir_all(&root).unwrap();

        assert_eq!(
            provisional_root_to_wipe(Some(&root_str), Some(&root_str), None),
            None
        );
    }
}
