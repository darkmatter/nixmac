use tauri::AppHandle;

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
