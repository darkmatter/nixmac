//! Developer-mode "pin to version" install flow.
//!
//! Lets a developer install an arbitrary past release for bisecting regressions.
//! Reuses the standard tauri-plugin-updater pipeline (signature verification,
//! atomic bundle swap) but feeds it a synthetic manifest that points at a
//! specific historic artifact in R2.
//!
//! Strategy:
//!   1. Fetch the `.sig` file for the requested version directly from R2.
//!   2. Build a synthetic Tauri updater manifest in memory. Claim a fake-newer
//!      version so the plugin's "is this an upgrade?" check accepts the install
//!      (the bundle inside the tarball still has its real version baked in).
//!   3. Serve that JSON from a one-shot localhost HTTP server.
//!   4. Build a custom `Updater` that points at the localhost URL and run
//!      `check().download_and_install()` exactly like the production path.
//!
//! Gated to release builds because the updater plugin isn't registered in dev.
//!
//! NOTE: requires `plugins.updater.dangerousInsecureTransportProtocol: true`
//! in `tauri.conf.json`. Without it, `endpoints(...)` rejects `http://` URLs —
//! including the loopback manifest URL we serve here. The production endpoint
//! is still HTTPS and minisign-verified; this flag only relaxes the *scheme*
//! check at the URL-validation layer.

#[allow(dead_code)]
const RELEASES_BASE: &str = "https://releases.nixmac.com";

/// We claim a sentinel-newer version so the updater plugin doesn't reject the
/// install as a downgrade. Bisecting requires walking backwards through the
/// release history, which the production updater would otherwise refuse.
#[allow(dead_code)]
const FAKE_NEWER_VERSION: &str = "9999.0.0";

/// Build the synthetic Tauri updater manifest that points at a historic release.
/// Pure helper, exercised by unit tests.
#[allow(dead_code)]
fn build_manifest_json(version: &str, signature: &str) -> String {
    let bundle_url = format!("{RELEASES_BASE}/{version}/nixmac.app.tar.gz");
    serde_json::json!({
        "version": FAKE_NEWER_VERSION,
        "notes": format!("Pinned to v{version} (developer install)"),
        "pub_date": "2020-01-01T00:00:00Z",
        "platforms": {
            "darwin-aarch64": {
                "signature": signature,
                "url": bundle_url,
            }
        }
    })
    .to_string()
}

#[cfg(not(debug_assertions))]
async fn install_version_impl(app: tauri::AppHandle, version: String) -> Result<(), String> {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri_plugin_updater::UpdaterExt;

    if version.trim().is_empty() {
        return Err("version cannot be empty".to_string());
    }

    log::info!("[developer] install_version requested: {version}");

    // Fetch the minisign signature for this historic version from R2.
    let sig_url = format!("{RELEASES_BASE}/{version}/nixmac.app.tar.gz.sig");
    let resp = reqwest::get(&sig_url)
        .await
        .map_err(|e| format!("failed to fetch signature: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "signature fetch returned HTTP {} for version {version} (does that release exist?)",
            resp.status()
        ));
    }
    let signature = resp
        .text()
        .await
        .map_err(|e| format!("failed to read signature body: {e}"))?;

    let manifest = build_manifest_json(&version, &signature);

    // Spawn a one-shot localhost HTTP server that returns the manifest.
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("failed to bind manifest server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("failed to read manifest server port: {e}"))?
        .port();
    let manifest_arc = Arc::new(manifest);
    {
        let manifest_arc = manifest_arc.clone();
        thread::spawn(move || {
            // Stay up long enough to serve the updater's manifest fetch, then exit.
            // Each connection responds once with the JSON; we accept up to ~3 connections
            // to absorb retries before giving up.
            //
            // All socket operations below are fire-and-forget: this is a minimal local
            // HTTP server whose only job is to serve one manifest request to the updater.
            // - set_nonblocking failure: loop just blocks on accept() briefly instead.
            // - set_read_timeout / read failure: we skip the request and the updater retries.
            // - write_all / flush failure: updater will retry; we move on to the next conn.
            let _ = listener.set_nonblocking(true);
            let start = Instant::now();
            let mut served = 0u32;
            while start.elapsed() < Duration::from_secs(60) && served < 3 {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                        let mut buf = [0u8; 4096];
                        let _ = stream.read(&mut buf);

                        let body = manifest_arc.as_bytes();
                        let head = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = stream.write_all(head.as_bytes());
                        let _ = stream.write_all(body);
                        let _ = stream.flush();
                        served += 1;
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(50));
                    }
                    Err(e) => {
                        log::warn!("[developer] manifest server accept error: {e}");
                        return;
                    }
                }
            }
        });
    }

    let manifest_url: url::Url = format!("http://127.0.0.1:{port}/manifest.json")
        .parse()
        .map_err(|e: url::ParseError| format!("invalid manifest URL: {e}"))?;

    let updater = app
        .updater_builder()
        .endpoints(vec![manifest_url])
        .map_err(|e| format!("updater endpoints rejected: {e}"))?
        .build()
        .map_err(|e| format!("updater build failed: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("updater check failed: {e}"))?
        .ok_or_else(|| "updater returned no update (unexpected)".to_string())?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("download_and_install failed: {e}"))?;

    // Persist the pinned version so the silent update check at next launch can be suppressed.
    crate::storage::store::set_string_pref(
        &app,
        crate::storage::store::PINNED_VERSION_KEY,
        &version,
    )
    .map_err(|e| format!("failed to persist pinned version: {e}"))?;

    log::info!("[developer] install_version({version}) succeeded");
    Ok(())
}

#[cfg(debug_assertions)]
async fn install_version_impl(_app: tauri::AppHandle, _version: String) -> Result<(), String> {
    Err("Developer install requires a release build (the updater plugin is not registered in dev mode).".to_string())
}

/// Install a specific past release of nixmac for bisecting.
///
/// The frontend should call `relaunch_after_update` after this returns successfully.
#[tauri::command]
pub async fn install_version(app: tauri::AppHandle, version: String) -> Result<(), String> {
    install_version_impl(app, version).await
}

/// Clear the pinned-version preference so the silent update check resumes.
#[tauri::command]
pub async fn clear_pinned_version(app: tauri::AppHandle) -> Result<(), String> {
    crate::storage::store::delete_pref(&app, crate::storage::store::PINNED_VERSION_KEY)
        .map_err(|e| format!("failed to clear pinned version: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn manifest_uses_fake_newer_version_to_bypass_downgrade_block() {
        // The updater plugin refuses installs that aren't strict semver upgrades.
        // The synthesized manifest must claim a sentinel-newer version so the
        // bisect path actually runs; the bundle inside the tarball still has the
        // real version baked in.
        let manifest: Value =
            serde_json::from_str(&build_manifest_json("0.21.0", "fake-sig")).unwrap();
        assert_eq!(manifest["version"], FAKE_NEWER_VERSION);
    }

    #[test]
    fn manifest_includes_signature_and_versioned_bundle_url() {
        let manifest: Value = serde_json::from_str(&build_manifest_json(
            "0.21.0",
            "untrusted-comment\nsig-bytes",
        ))
        .unwrap();
        let platform = &manifest["platforms"]["darwin-aarch64"];
        assert_eq!(platform["signature"], "untrusted-comment\nsig-bytes");
        assert_eq!(
            platform["url"],
            "https://releases.nixmac.com/0.21.0/nixmac.app.tar.gz"
        );
    }

    #[test]
    fn manifest_only_publishes_apple_silicon_target() {
        // Mirrors how production latest.json is published — Intel is intentionally
        // not supported. If this fails, the build pipeline likely changed and the
        // synthesized manifest needs to follow.
        let manifest: Value = serde_json::from_str(&build_manifest_json("0.21.0", "sig")).unwrap();
        let platforms = manifest["platforms"].as_object().unwrap();
        assert!(platforms.contains_key("darwin-aarch64"));
        assert_eq!(platforms.len(), 1);
    }

    #[test]
    fn manifest_is_valid_json_for_multiline_minisign_signatures() {
        // Minisign signatures contain `\n` and untrusted-comment headers. The
        // manifest must round-trip through serde_json without breaking the
        // updater plugin's parser.
        let multiline_sig = "untrusted comment: signature from minisign secret key\nRWTLUaCT...\ntrusted comment: timestamp\nABC123==\n";
        let json_str = build_manifest_json("0.21.0", multiline_sig);
        let parsed: Value = serde_json::from_str(&json_str).expect("manifest must round-trip");
        assert_eq!(
            parsed["platforms"]["darwin-aarch64"]["signature"],
            multiline_sig
        );
    }

    #[test]
    fn manifest_notes_reference_the_real_target_version() {
        // The user-visible "notes" field should reference the version they
        // actually requested, not the sentinel-newer marker.
        let manifest: Value = serde_json::from_str(&build_manifest_json("0.21.0", "sig")).unwrap();
        let notes = manifest["notes"].as_str().unwrap();
        assert!(
            notes.contains("0.21.0"),
            "notes should reference target version: {notes}"
        );
        assert!(
            !notes.contains(FAKE_NEWER_VERSION),
            "notes should not leak the sentinel"
        );
    }
}
