use crate::shared_types;
use tauri::AppHandle;

#[cfg(any(not(debug_assertions), test))]
const STABLE_MANIFEST_URL: &str = "https://releases.nixmac.com/latest.json";
#[cfg(any(not(debug_assertions), test))]
const DEVELOP_MANIFEST_URL: &str = "https://releases.nixmac.com/channels/develop/latest.json";

#[cfg(any(not(debug_assertions), test))]
fn update_manifest_url(channel: shared_types::UpdateChannel) -> &'static str {
    match channel {
        shared_types::UpdateChannel::Stable => STABLE_MANIFEST_URL,
        shared_types::UpdateChannel::Develop => DEVELOP_MANIFEST_URL,
    }
}

#[cfg(not(debug_assertions))]
fn update_info(
    channel: shared_types::UpdateChannel,
    update: tauri_plugin_updater::Update,
) -> shared_types::UpdateInfo {
    shared_types::UpdateInfo {
        channel,
        version: update.version,
        notes: update.body,
    }
}

#[cfg(not(debug_assertions))]
fn selected_update_channel(app: &AppHandle) -> Result<shared_types::UpdateChannel, String> {
    crate::storage::store::get_json_pref_or(
        app,
        crate::storage::store::UPDATE_CHANNEL_KEY,
        shared_types::UpdateChannel::default(),
    )
    .map_err(|e| format!("[updater] failed to read update channel preference: {e}"))
}

#[cfg(not(debug_assertions))]
fn channel_updater(
    app: &AppHandle,
    channel: shared_types::UpdateChannel,
) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;

    let manifest_url: url::Url = update_manifest_url(channel)
        .parse()
        .map_err(|e: url::ParseError| format!("[updater] invalid channel manifest URL: {e}"))?;

    app.updater_builder()
        .endpoints(vec![manifest_url])
        .map_err(|e| format!("[updater] endpoints rejected: {e}"))?
        .build()
        .map_err(|e| format!("[updater] build failed: {e}"))
}

/// Check the selected auto-update channel for an available release.
#[tauri::command]
#[cfg(not(debug_assertions))]
pub async fn check_update(app: AppHandle) -> Result<Option<shared_types::UpdateInfo>, String> {
    let channel = selected_update_channel(&app)?;
    let updater = channel_updater(&app, channel)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("[updater] check failed: {e}"))?;

    Ok(update.map(|update| update_info(channel, update)))
}

/// Download and install the latest release from the selected auto-update channel.
#[tauri::command]
#[cfg(not(debug_assertions))]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let channel = selected_update_channel(&app)?;
    let updater = channel_updater(&app, channel)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("[updater] check failed: {e}"))?
        .ok_or_else(|| "[updater] no update available".to_string())?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("[updater] download_and_install failed: {e}"))?;

    Ok(())
}

#[tauri::command]
#[cfg(debug_assertions)]
pub async fn check_update(_app: AppHandle) -> Result<Option<shared_types::UpdateInfo>, String> {
    Ok(None)
}

#[tauri::command]
#[cfg(debug_assertions)]
pub async fn install_update(_app: AppHandle) -> Result<(), String> {
    Err("Auto-update install requires a release build (the updater plugin is not registered in dev mode).".to_string())
}

/// Safely relaunch the app after the Tauri updater has installed a new bundle.
///
/// On macOS, the updater atomically swaps the `.app` bundle on disk by moving
/// the old bundle aside and placing the new one at the original path.  The
/// standard `relaunch()` / `app.request_restart()` path re-execs the binary
/// path that was cached when the process first started, which can resolve to
/// the old (now moved-aside) bundle in certain timing windows and therefore
/// relaunch the stale version.
///
/// This command sidesteps that by calling `open -n <bundle_path>`, which asks
/// macOS LaunchServices to open the bundle at its *current* installed location,
/// always picking up the freshly-written bundle.  We then exit the current
/// (old) process so the single-instance gate does not block the new instance.
#[tauri::command]
pub fn relaunch_after_update(app: AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("[updater] failed to resolve current executable path: {e}"))?;

    // Walk up from <Bundle>.app/Contents/MacOS/<binary> → <Bundle>.app
    let bundle_path = exe
        .parent() // …/Contents/MacOS/
        .and_then(|p| p.parent()) // …/Contents/
        .and_then(|p| p.parent()) // …/<Bundle>.app/
        .ok_or_else(|| {
            format!("[updater] cannot derive .app bundle path from executable path: {exe:?}")
        })?
        .to_path_buf();

    log::info!("[updater] relaunching updated app bundle: {bundle_path:?}");

    // `open -n` forces a fresh launch from the bundle's current location on
    // disk even if the current process is still alive.  Because we call
    // `app.exit(0)` immediately afterward, the old process will have exited
    // before the new instance reaches the single-instance check.
    std::process::Command::new("open")
        .args([
            "-n",
            bundle_path
                .to_str()
                .ok_or("[updater] app bundle path contains non-UTF-8 characters")?,
        ])
        .spawn()
        .map_err(|e| format!("[updater] failed to open updated bundle via 'open -n': {e}"))?;

    // Exit the current (old) process cleanly.
    app.exit(0);

    // `app.exit` schedules an exit through the Tauri event loop and returns
    // (it does not call std::process::exit directly), so we must return Ok here.
    Ok(())
}

#[tauri::command]
pub async fn install_version(app: AppHandle, version: String) -> Result<(), String> {
    crate::updater_pin::install_version(app, version).await
}

#[tauri::command]
pub async fn clear_pinned_version(app: AppHandle) -> Result<(), String> {
    crate::updater_pin::clear_pinned_version(app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_channel_keeps_legacy_manifest_url() {
        assert_eq!(
            update_manifest_url(shared_types::UpdateChannel::Stable),
            "https://releases.nixmac.com/latest.json"
        );
    }

    #[test]
    fn develop_channel_uses_isolated_manifest_url() {
        assert_eq!(
            update_manifest_url(shared_types::UpdateChannel::Develop),
            "https://releases.nixmac.com/channels/develop/latest.json"
        );
    }
}
