//! Onboarding lifecycle commands.

use super::config::{ImportTarget, cleanup_import_target};
use super::helpers::capture_err;
use crate::shared_types;
use crate::state::{
    evolve_state, git_state, onboarding as onboarding_state, preferences, rebuild_status, watcher,
};
use crate::storage::{canonical_config, legacy_kv};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Latches the completion timestamp that gates the onboarding takeover.
///
/// Called when the user dismisses the celebration. Validated against the
/// final durable gate — a successful first build — so a stray call can
/// never mark an unfinished onboarding as done. Idempotent: an existing
/// latch keeps its original timestamp.
pub async fn onboarding_complete<R: tauri::Runtime>(
    app: AppHandle<R>,
) -> Result<shared_types::OkResult, String> {
    let state = onboarding_state::try_read(&app)
        .ok_or_else(|| capture_err("onboarding_complete", "Onboarding state not loaded"))?;
    if state.last_build_at.is_none() {
        return Err("Onboarding is not finished: no build has been applied yet.".to_string());
    }

    onboarding_state::write(&app, |state| {
        if state.completed_at.is_none() {
            state.completed_at = Some(crate::utils::unix_now());
        }
    })
    .map_err(|e| capture_err("onboarding_complete", e))?;

    Ok(shared_types::OkResult::yes())
}

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
    rebuild_status::reset(&app);

    let prefs = preferences::try_read(&app)
        .ok_or_else(|| capture_err("onboarding_reset", "Preferences not loaded"))?;
    let onboarding = onboarding_state::try_read(&app)
        .ok_or_else(|| capture_err("onboarding_reset", "Onboarding state not loaded"))?;

    // Stop polling before the directory disappears; the watcher would emit a
    // git_state_error on every tick against a deleted path.
    watcher::stop_watching();

    if let Some(root) = provisional_root_to_wipe(
        onboarding.provisional_config_dir.as_deref(),
        prefs.config_dir.as_deref(),
        onboarding.last_build_at,
    ) {
        // The canonical /etc/nix-darwin must stay in place (privileged
        // creation); anything else onboarding materialized can go entirely.
        cleanup_import_target(&ImportTarget {
            created: !canonical_config::is_canonical_config_path(&root),
            path: root,
        });
    }

    // An import parked on the flake-dir chooser is real on-disk state too.
    super::config::discard_pending_import(&app);

    // No new dir is being selected, so `handle_new_config_dir` will not run —
    // clear the derived cells explicitly.
    git_state::update(
        &app,
        shared_types::GitState {
            git_status: None,
            external_build_detected: false,
            upstream_update_available: false,
            rebuild_needed: false,
        },
    );
    if let Err(e) = evolve_state::clear(&app) {
        log::warn!("Failed to clear evolve state during onboarding reset: {e:#}");
    }

    preferences::write(&app, |prefs| {
        prefs.config_dir = None;
        prefs.repo_root = None;
        prefs.host_attr = None;
    })
    .map_err(|e| capture_err("onboarding_reset", e))?;

    // Clear the journey facts and the completion latch after the preference
    // facts, so when the wizard re-appears the step machine already computes
    // the restart target step.
    onboarding_state::write(&app, |state| {
        *state = shared_types::OnboardingState::default();
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
    use crate::observable::Observable;
    use crate::shared_types::{GlobalPreferences, OnboardingState};
    use tauri::Manager;

    fn mock_app_with_state(last_build_at: Option<i64>) -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app builds");
        app.manage(Observable::new(GlobalPreferences::default()));
        app.manage(Observable::new(OnboardingState {
            last_build_at,
            ..OnboardingState::default()
        }));
        app
    }

    #[test]
    fn complete_refuses_before_the_first_successful_build() {
        let app = mock_app_with_state(None);
        let handle = app.handle();

        let result = tauri::async_runtime::block_on(onboarding_complete(handle.clone()));

        assert!(result.is_err());
        assert_eq!(
            crate::state::onboarding::try_read(handle)
                .unwrap()
                .completed_at,
            None,
        );
    }

    #[test]
    fn complete_latches_once_and_keeps_the_first_timestamp() {
        let app = mock_app_with_state(Some(1));
        let handle = app.handle();

        tauri::async_runtime::block_on(onboarding_complete(handle.clone())).unwrap();
        let first = crate::state::onboarding::try_read(handle)
            .unwrap()
            .completed_at
            .expect("latched");

        tauri::async_runtime::block_on(onboarding_complete(handle.clone())).unwrap();
        assert_eq!(
            crate::state::onboarding::try_read(handle)
                .unwrap()
                .completed_at,
            Some(first),
        );
    }

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
