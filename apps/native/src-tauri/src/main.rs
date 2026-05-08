//! Entry point for the nixmac Tauri application.
//!
//! This is a macOS application for managing nix-darwin configurations.
//! It provides an interface for viewing, evolving, and applying
//! Nix flake-based system configurations.

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Keep top-level declarations scoped to first-level domain modules. Leaf modules
// are declared by their parent `mod.rs` files so rust-analyzer resolves them via Cargo.
mod ai;
mod bootstrap;
mod cli;
mod commands;
mod db;
mod e2e_runtime;
mod editor;
mod evolve;
mod feedback;
mod git;
mod history;
mod managed_edits;
mod panic_handler;
mod peek;
mod rebuild;
mod shared_types;
mod sqlite_types;
mod state;
mod statistics;
mod storage;
mod summarize;
mod system;
mod types;
mod updater_pin;
mod utils;

use state::watcher;
use storage::store;

use std::env;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    webview::PageLoadEvent,
    Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

fn e2e_opaque_window_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_OPAQUE_WINDOW")
}

fn e2e_solid_capture_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_SOLID_CAPTURE")
}

fn e2e_webview_watchdog_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_WEBVIEW_WATCHDOG")
}

#[cfg(all(debug_assertions, target_os = "macos"))]
static E2E_NATIVE_SNAPSHOT_COUNTER: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(debug_assertions)]
fn e2e_request_webview_boot_probe(window: &WebviewWindow, label: &'static str) {
    let label_json =
        serde_json::to_string(label).unwrap_or_else(|_| "\"unknown-native-probe\"".to_string());
    let script = format!(
        r#"
(() => {{
  const label = {label_json};
  const summarizeStorage = () => {{
    const values = {{}};
    for (const key of [
      "nixmac:e2e-boot-stage",
      "nixmac:e2e-dom-snapshot:last",
      "nixmac:e2e-dom-snapshot:text",
      "nixmac:e2e-dom-snapshot:html",
      "nixmac:e2e-dom-snapshot:watchdog-pre-reload:last"
    ]) {{
      try {{
        values[key] = window.localStorage.getItem(key);
      }} catch {{
        values[key] = "[unavailable]";
      }}
    }}
    return values;
  }};
  const detail = JSON.stringify({{
    url: document.URL || "",
    baseURI: document.baseURI || "",
    title: document.title || "",
    readyState: document.readyState || "",
    bootStage: document.documentElement?.dataset?.nixmacBootStage || "",
    capture: document.documentElement?.dataset?.nixmacE2eCapture || "",
    capturePaint: document.documentElement?.dataset?.nixmacE2eCapturePaint || "",
    rootChildren: document.getElementById("root")?.childElementCount ?? null,
    bodyTextLength: document.body?.innerText?.length ?? null,
    htmlLength: document.documentElement?.outerHTML?.length ?? null,
    htmlExcerpt: (document.documentElement?.outerHTML || "").slice(0, 1600),
    scripts: [...document.scripts].map((script) => ({{
      src: script.src || "",
      type: script.type || "",
      crossOrigin: script.crossOrigin || "",
      defer: script.defer,
      async: script.async,
    }})),
    stylesheets: [...document.querySelectorAll("link[rel~='stylesheet']")].map((link) => ({{
      href: link.href || "",
      crossOrigin: link.crossOrigin || "",
      media: link.media || "",
    }})),
    tauriInvokeAvailable: typeof (window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke) === "function",
    storage: summarizeStorage(),
  }});
  const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke === "function") {{
    invoke("e2e_log_breadcrumb", {{
      label: `native webview boot probe ${{label}}`,
      detail,
      clientTimestampUnixMs: Date.now(),
    }}).catch(() => {{}});
  }}
  console.info(`[nixmac native webview boot probe] ${{label}}`, detail);
}})();
"#,
    );
    match window.eval(script) {
        Ok(()) => {
            log::debug!("main webview E2E boot probe requested: {}", label);
        }
        Err(error) => {
            log::warn!(
                "main webview E2E boot probe eval failed for {}: {}",
                label,
                error
            );
        }
    }
}

#[cfg(not(debug_assertions))]
fn e2e_request_webview_boot_probe(_window: &WebviewWindow, _label: &'static str) {}

#[cfg(debug_assertions)]
fn e2e_schedule_webview_boot_probe(window: WebviewWindow, label: &'static str, delay: Duration) {
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let probe_window = window.clone();
        if let Err(error) = window.run_on_main_thread(move || {
            e2e_request_webview_boot_probe(&probe_window, label);
        }) {
            log::warn!(
                "main webview E2E boot probe could not schedule {}: {}",
                label,
                error
            );
        }
    });
}

#[cfg(not(debug_assertions))]
fn e2e_schedule_webview_boot_probe(_window: WebviewWindow, _label: &'static str, _delay: Duration) {
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn e2e_request_native_webview_capture_probe(window: &WebviewWindow, label: &'static str) {
    use objc::msg_send;
    use objc::runtime::{Object, YES};
    use objc::sel;
    use objc::sel_impl;

    #[repr(C)]
    struct E2eNativePoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    struct E2eNativeSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    struct E2eNativeRect {
        origin: E2eNativePoint,
        size: E2eNativeSize,
    }

    if let Err(error) = window.with_webview(move |webview| unsafe {
        let webview = webview.inner() as *mut Object;
        let is_hidden: bool = msg_send![webview, isHidden];
        let alpha_value: f64 = msg_send![webview, alphaValue];
        let wants_layer: bool = msg_send![webview, wantsLayer];
        let frame: E2eNativeRect = msg_send![webview, frame];
        let bounds: E2eNativeRect = msg_send![webview, bounds];
        let responds_to_draws_background: bool =
            msg_send![webview, respondsToSelector: sel!(drawsBackground)];
        let draws_background = if responds_to_draws_background {
            let value: bool = msg_send![webview, drawsBackground];
            Some(value)
        } else {
            None
        };
        let layer: *mut Object = msg_send![webview, layer];
        let layer_has_contents = if layer.is_null() {
            false
        } else {
            let contents: *mut Object = msg_send![layer, contents];
            !contents.is_null()
        };
        let layer_opacity: f32 = if layer.is_null() {
            -1.0
        } else {
            msg_send![layer, opacity]
        };
        let layer_hidden: bool = if layer.is_null() {
            false
        } else {
            msg_send![layer, isHidden]
        };

        // Best-effort AppKit invalidation for the virtualized MacInCloud capture path.
        // WKWebView content is out-of-process, so this is evidence plus a hint, not a
        // guarantee that WebContent will repaint.
        let _: () = msg_send![webview, setNeedsDisplay: YES];
        let _: () = msg_send![webview, displayIfNeeded];

        log::info!(
            "NIXMAC_E2E_CAPTURE webview diagnostics: label={} drawsBackground={:?} respondsToDrawsBackground={} hidden={} alphaValue={:.3} wantsLayer={} frame={:.0},{:.0},{:.0},{:.0} bounds={:.0},{:.0},{:.0},{:.0} layerPresent={} layerHidden={} layerOpacity={:.3} layerHasContents={} appKitDisplayHint=true",
            label,
            draws_background,
            responds_to_draws_background,
            is_hidden,
            alpha_value,
            wants_layer,
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height,
            bounds.origin.x,
            bounds.origin.y,
            bounds.size.width,
            bounds.size.height,
            !layer.is_null(),
            layer_hidden,
            layer_opacity,
            layer_has_contents
        );
    }) {
        log::warn!(
            "NIXMAC_E2E_CAPTURE webview diagnostics unavailable for {}: {}",
            label,
            error
        );
    }
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
#[allow(dead_code)]
fn e2e_request_native_webview_capture_probe(_window: &WebviewWindow, _label: &'static str) {}

#[cfg(debug_assertions)]
fn e2e_schedule_native_webview_capture_probe(
    window: WebviewWindow,
    label: &'static str,
    delay: Duration,
) {
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let probe_window = window.clone();
        if let Err(error) = window.run_on_main_thread(move || {
            e2e_request_native_webview_capture_probe(&probe_window, label);
        }) {
            log::warn!(
                "NIXMAC_E2E_CAPTURE could not schedule native WebView probe {} on main thread: {}",
                label,
                error
            );
        }
    });
}

#[cfg(not(debug_assertions))]
fn e2e_schedule_native_webview_capture_probe(
    _window: WebviewWindow,
    _label: &'static str,
    _delay: Duration,
) {
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn e2e_clean_snapshot_label(label: &str) -> String {
    let cleaned = label
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(80)
        .collect::<String>();
    if cleaned.is_empty() {
        "snapshot".to_string()
    } else {
        cleaned
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn e2e_native_snapshot_root_dir() -> Option<std::path::PathBuf> {
    crate::e2e_runtime::value("NIXMAC_E2E_DIAGNOSTICS_DIR")
        .map(std::path::PathBuf::from)
        .map(|path| path.join("native-webview-snapshots"))
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn e2e_native_snapshot_paths(label: &str) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    let root = e2e_native_snapshot_root_dir()?;
    let sequence = E2E_NATIVE_SNAPSHOT_COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
    let epoch_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let stem = format!(
        "native-webview-{sequence:04}-{}-{epoch_ms}",
        e2e_clean_snapshot_label(label)
    );
    Some((
        root.join(format!("{stem}.png")),
        root.join(format!("{stem}.json")),
    ))
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn e2e_write_native_snapshot_status(
    status_path: &std::path::Path,
    status: &str,
    label: &str,
    output_path: &std::path::Path,
    message: Option<&str>,
) {
    e2e_write_native_snapshot_status_with_source(
        status_path,
        status,
        label,
        output_path,
        message,
        "WKWebView.takeSnapshotWithConfiguration",
    );
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn e2e_write_native_snapshot_status_with_source(
    status_path: &std::path::Path,
    status: &str,
    label: &str,
    output_path: &std::path::Path,
    message: Option<&str>,
    source: &str,
) {
    if let Some(parent) = status_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let payload = serde_json::json!({
        "status": status,
        "label": label,
        "path": output_path,
        "message": message,
        "capturedAtUnixMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0),
        "source": source
    });
    let tmp_status_path = status_path.with_extension("json.tmp");
    if std::fs::write(
        &tmp_status_path,
        serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string()),
    )
    .and_then(|()| std::fs::rename(&tmp_status_path, status_path))
    .is_err()
    {
        let _ = std::fs::remove_file(&tmp_status_path);
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
unsafe fn e2e_write_bitmap_rep_png(
    bitmap_rep: *mut objc::runtime::Object,
    output_path: &std::path::Path,
) -> Result<(), String> {
    use objc::class;
    use objc::msg_send;
    use objc::runtime::Object;
    use objc::sel;
    use objc::sel_impl;

    if bitmap_rep.is_null() {
        return Err("NSBitmapImageRep was nil".to_string());
    }

    let properties: *mut Object = msg_send![class!(NSDictionary), dictionary];
    const NS_BITMAP_IMAGE_FILE_TYPE_PNG: usize = 4;
    let png_data: *mut Object = msg_send![
        bitmap_rep,
        representationUsingType: NS_BITMAP_IMAGE_FILE_TYPE_PNG
        properties: properties
    ];
    if png_data.is_null() {
        return Err("NSBitmapImageRep PNG representation was nil".to_string());
    }

    let bytes: *const std::ffi::c_void = msg_send![png_data, bytes];
    let len: usize = msg_send![png_data, length];
    if bytes.is_null() || len == 0 {
        return Err("PNG data was empty".to_string());
    }

    let slice = std::slice::from_raw_parts(bytes.cast::<u8>(), len);
    let tmp_output = output_path.with_extension("png.tmp");
    std::fs::write(&tmp_output, slice)
        .and_then(|()| std::fs::rename(&tmp_output, output_path))
        .map_err(|error| {
            let _ = std::fs::remove_file(&tmp_output);
            format!("failed to write PNG atomically: {error}")
        })
}

#[cfg(all(debug_assertions, target_os = "macos"))]
unsafe fn e2e_try_cached_display_snapshot(
    webview: *mut objc::runtime::Object,
    status_path: &std::path::Path,
    label: &str,
    output_path: &std::path::Path,
    prior_error: &str,
) -> bool {
    use objc::msg_send;
    use objc::runtime::Object;
    use objc::sel;
    use objc::sel_impl;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct E2eNativePoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct E2eNativeSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct E2eNativeRect {
        origin: E2eNativePoint,
        size: E2eNativeSize,
    }

    if webview.is_null() {
        return false;
    }
    let bounds: E2eNativeRect = msg_send![webview, bounds];
    if bounds.size.width <= 0.0 || bounds.size.height <= 0.0 {
        e2e_write_native_snapshot_status_with_source(
            status_path,
            "failed",
            label,
            output_path,
            Some(&format!(
                "{prior_error}; AppKit fallback had invalid bounds {:.0}x{:.0}",
                bounds.size.width, bounds.size.height
            )),
            "NSView.cacheDisplayInRect",
        );
        return false;
    }
    let bitmap_rep: *mut Object = msg_send![webview, bitmapImageRepForCachingDisplayInRect: bounds];
    if bitmap_rep.is_null() {
        e2e_write_native_snapshot_status_with_source(
            status_path,
            "failed",
            label,
            output_path,
            Some(&format!(
                "{prior_error}; AppKit fallback returned nil bitmap rep"
            )),
            "NSView.cacheDisplayInRect",
        );
        return false;
    }
    let _: () = msg_send![webview, cacheDisplayInRect: bounds toBitmapImageRep: bitmap_rep];
    match e2e_write_bitmap_rep_png(bitmap_rep, output_path) {
        Ok(()) => {
            e2e_write_native_snapshot_status_with_source(
                status_path,
                "degraded",
                label,
                output_path,
                Some(&format!(
                    "WKWebView snapshot failed first ({prior_error}); AppKit cached-display fallback wrote PNG"
                )),
                "NSView.cacheDisplayInRect",
            );
            true
        }
        Err(error) => {
            e2e_write_native_snapshot_status_with_source(
                status_path,
                "failed",
                label,
                output_path,
                Some(&format!("{prior_error}; AppKit fallback failed: {error}")),
                "NSView.cacheDisplayInRect",
            );
            false
        }
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
unsafe fn e2e_nsstring_to_string(value: *mut objc::runtime::Object) -> Option<String> {
    use objc::{msg_send, sel, sel_impl};

    if value.is_null() {
        return None;
    }
    let utf8: *const std::os::raw::c_char = msg_send![value, UTF8String];
    if utf8.is_null() {
        return None;
    }
    Some(
        std::ffi::CStr::from_ptr(utf8)
            .to_string_lossy()
            .into_owned(),
    )
}

#[cfg(all(debug_assertions, target_os = "macos"))]
unsafe fn e2e_ns_error_summary(error: *mut objc::runtime::Object) -> String {
    use objc::{msg_send, sel, sel_impl};

    if error.is_null() {
        return "WebKit returned an error".to_string();
    }
    let domain: *mut objc::runtime::Object = msg_send![error, domain];
    let description: *mut objc::runtime::Object = msg_send![error, localizedDescription];
    let user_info: *mut objc::runtime::Object = msg_send![error, userInfo];
    let user_info_description: *mut objc::runtime::Object = if user_info.is_null() {
        std::ptr::null_mut()
    } else {
        msg_send![user_info, description]
    };
    let code: i64 = msg_send![error, code];
    format!(
        "WebKit returned an error: domain={} code={} description={} userInfo={}",
        e2e_nsstring_to_string(domain).unwrap_or_else(|| "unknown".to_string()),
        code,
        e2e_nsstring_to_string(description).unwrap_or_else(|| "unknown".to_string()),
        e2e_nsstring_to_string(user_info_description).unwrap_or_else(|| "unknown".to_string())
    )
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn e2e_request_native_webview_snapshot(
    window: &WebviewWindow,
    label: String,
    output_path: std::path::PathBuf,
    status_path: std::path::PathBuf,
) {
    use block::ConcreteBlock;
    use objc::class;
    use objc::msg_send;
    use objc::runtime::Object;
    use objc::sel;
    use objc::sel_impl;

    if let Some(parent) = output_path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            log::warn!(
                "NIXMAC_E2E_NATIVE_SNAPSHOT could not create output dir for {}: {}",
                label,
                error
            );
            e2e_write_native_snapshot_status(
                &status_path,
                "failed",
                &label,
                &output_path,
                Some(&format!("failed to create output directory: {error}")),
            );
            return;
        }
    }
    if let Some(parent) = status_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    e2e_write_native_snapshot_status(&status_path, "pending", &label, &output_path, None);

    let error_label = label.clone();
    let error_output_path = output_path.clone();
    let error_status_path = status_path.clone();
    if let Err(error) = window.with_webview(move |webview| unsafe {
        let label_for_log = label.clone();
        let label_for_status = label.clone();
        let output_for_block = output_path.clone();
        let status_for_block = status_path.clone();
        let webview_for_fallback = webview.inner() as *mut Object;
        let completion = ConcreteBlock::new(move |image: *mut Object, error: *mut Object| {
            if !error.is_null() {
                let error_message = e2e_ns_error_summary(error);
                if e2e_try_cached_display_snapshot(
                    webview_for_fallback,
                    &status_for_block,
                    &label_for_status,
                    &output_for_block,
                    &error_message,
                ) {
                    log::info!(
                        "NIXMAC_E2E_NATIVE_SNAPSHOT used AppKit cached-display fallback for {}",
                        label_for_status
                    );
                    return;
                }
                log::warn!(
                    "NIXMAC_E2E_NATIVE_SNAPSHOT failed for {}: {}",
                    label_for_status,
                    error_message
                );
                e2e_write_native_snapshot_status(
                    &status_for_block,
                    "failed",
                    &label_for_status,
                    &output_for_block,
                    Some(&error_message),
                );
                return;
            }
            if image.is_null() {
                log::warn!(
                    "NIXMAC_E2E_NATIVE_SNAPSHOT failed for {}: WebKit returned no image",
                    label_for_status
                );
                e2e_write_native_snapshot_status(
                    &status_for_block,
                    "failed",
                    &label_for_status,
                    &output_for_block,
                    Some("WebKit returned no image"),
                );
                return;
            }

            let tiff_data: *mut Object = msg_send![image, TIFFRepresentation];
            if tiff_data.is_null() {
                e2e_write_native_snapshot_status(
                    &status_for_block,
                    "failed",
                    &label_for_status,
                    &output_for_block,
                    Some("NSImage TIFFRepresentation was nil"),
                );
                return;
            }
            let bitmap_rep: *mut Object =
                msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff_data];
            if bitmap_rep.is_null() {
                e2e_write_native_snapshot_status(
                    &status_for_block,
                    "failed",
                    &label_for_status,
                    &output_for_block,
                    Some("NSBitmapImageRep could not read snapshot data"),
                );
                return;
            }
            match e2e_write_bitmap_rep_png(bitmap_rep, &output_for_block) {
                Ok(()) => {
                    log::info!(
                        "NIXMAC_E2E_NATIVE_SNAPSHOT wrote {} for {}",
                        output_for_block.display(),
                        label_for_status
                    );
                    e2e_write_native_snapshot_status(
                        &status_for_block,
                        "passed",
                        &label_for_status,
                        &output_for_block,
                        None,
                    );
                }
                Err(error) => {
                    log::warn!(
                        "NIXMAC_E2E_NATIVE_SNAPSHOT failed to write {} for {}: {}",
                        output_for_block.display(),
                        label_for_status,
                        error
                    );
                    e2e_write_native_snapshot_status(
                        &status_for_block,
                        "failed",
                        &label_for_status,
                        &output_for_block,
                        Some(&error),
                    );
                }
            }
        })
        .copy();
        let webview = webview.inner() as *mut Object;
        let configuration: *mut Object = msg_send![class!(WKSnapshotConfiguration), new];
        if !configuration.is_null() {
            #[repr(C)]
            struct E2eNativePoint {
                x: f64,
                y: f64,
            }

            #[repr(C)]
            struct E2eNativeSize {
                width: f64,
                height: f64,
            }

            #[repr(C)]
            struct E2eNativeRect {
                origin: E2eNativePoint,
                size: E2eNativeSize,
            }

            let bounds: E2eNativeRect = msg_send![webview, bounds];
            let _: () = msg_send![configuration, setRect: bounds];
            let _: () = msg_send![configuration, setAfterScreenUpdates: true];
        }
        let _: () = msg_send![
            webview,
            takeSnapshotWithConfiguration: configuration
            completionHandler: &*completion
        ];
        if !configuration.is_null() {
            let _: () = msg_send![configuration, release];
        }
        // The completion is async and owned by WebKit after dispatch. Leaking the
        // copied block is acceptable in debug-only E2E runs and avoids use-after-free
        // while the virtualized host is under load.
        std::mem::forget(completion);
        log::debug!(
            "NIXMAC_E2E_NATIVE_SNAPSHOT requested {} for {}",
            output_path.display(),
            label_for_log
        );
    }) {
        log::warn!(
            "NIXMAC_E2E_NATIVE_SNAPSHOT unavailable for {}: {}",
            error_label,
            error
        );
        e2e_write_native_snapshot_status(
            &error_status_path,
            "failed",
            &error_label,
            &error_output_path,
            Some(&format!("webview unavailable: {error}")),
        );
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn e2e_schedule_native_webview_snapshot(
    window: WebviewWindow,
    label: &'static str,
    delay: Duration,
) {
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if let Some((output_path, status_path)) = e2e_native_snapshot_paths(label) {
            let snapshot_window = window.clone();
            let output_path_for_error = output_path.clone();
            let status_path_for_error = status_path.clone();
            if let Err(error) = window.run_on_main_thread(move || {
                e2e_request_native_webview_snapshot(
                    &snapshot_window,
                    label.to_string(),
                    output_path,
                    status_path,
                );
            }) {
                log::warn!(
                    "NIXMAC_E2E_NATIVE_SNAPSHOT could not schedule {} on main thread: {}",
                    label,
                    error
                );
                e2e_write_native_snapshot_status(
                    &status_path_for_error,
                    "failed",
                    label,
                    &output_path_for_error,
                    Some(&format!("main-thread scheduling failed: {error}")),
                );
            }
        }
    });
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn e2e_start_native_webview_snapshot_request_poller(window: WebviewWindow) {
    let Some(root) = e2e_native_snapshot_root_dir() else {
        return;
    };
    let request_dir = root.join("requests");
    if let Err(error) = std::fs::create_dir_all(&request_dir) {
        log::warn!(
            "NIXMAC_E2E_NATIVE_SNAPSHOT could not create request dir {}: {}",
            request_dir.display(),
            error
        );
        return;
    }
    log::info!(
        "NIXMAC_E2E_NATIVE_SNAPSHOT polling requests in {}",
        request_dir.display()
    );
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let max_runtime = Duration::from_secs(2 * 60 * 60);
        while started.elapsed() < max_runtime {
            let Ok(entries) = std::fs::read_dir(&request_dir) else {
                std::thread::sleep(Duration::from_millis(250));
                continue;
            };
            for entry in entries.flatten() {
                let request_path = entry.path();
                let Some(file_name) = request_path.file_name().and_then(|name| name.to_str())
                else {
                    continue;
                };
                let Some(request_id) = file_name.strip_suffix(".request") else {
                    continue;
                };
                let label = std::fs::read_to_string(&request_path)
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| request_id.to_string());
                let _ = std::fs::remove_file(&request_path);
                let output_path = root.join(format!("{request_id}.png"));
                let status_path = root.join(format!("{request_id}.json"));
                let snapshot_window = window.clone();
                let output_path_for_error = output_path.clone();
                let status_path_for_error = status_path.clone();
                let label_for_error = label.clone();
                if let Err(error) = window.run_on_main_thread(move || {
                    e2e_request_native_webview_snapshot(
                        &snapshot_window,
                        label,
                        output_path,
                        status_path,
                    );
                }) {
                    log::warn!(
                        "NIXMAC_E2E_NATIVE_SNAPSHOT could not schedule request {} on main thread: {}",
                        label_for_error,
                        error
                    );
                    e2e_write_native_snapshot_status(
                        &status_path_for_error,
                        "failed",
                        &label_for_error,
                        &output_path_for_error,
                        Some(&format!("main-thread scheduling failed: {error}")),
                    );
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        log::warn!("NIXMAC_E2E_NATIVE_SNAPSHOT request poller stopped after max runtime");
    });
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
fn e2e_schedule_native_webview_snapshot(
    _window: WebviewWindow,
    _label: &'static str,
    _delay: Duration,
) {
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
fn e2e_start_native_webview_snapshot_request_poller(_window: WebviewWindow) {}

const E2E_CAPTURE_DARK_BACKGROUND_SCRIPT: &str = r#"
(() => {
  const styleId = "nixmac-e2e-capture-background";
  const captureMode = "solid";
  const logCaptureBreadcrumb = (label, detail) => {
    const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") return;
    invoke("e2e_log_breadcrumb", {
      label,
      detail,
      clientTimestampUnixMs: Date.now(),
    }).catch(() => {});
  };
  const getCssValue = (style, property) => {
    if (!style) return null;
    const value = style.getPropertyValue(property);
    return value === "" ? null : value;
  };
  const firstMatchingElement = (selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  };
  const firstTextElement = () => {
    const candidates = document.body?.querySelectorAll("h1,h2,h3,p,span,button,[data-slot='card']") ?? [];
    return [...candidates].find((element) => {
      const style = window.getComputedStyle(element);
      return (
        element.textContent?.trim() &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    }) ?? null;
  };
  const sampleStyle = (element) => {
    if (!element) return null;
    const style = window.getComputedStyle(element);
    return {
      tagName: element.tagName?.toLowerCase() ?? null,
      className: typeof element.className === "string" ? element.className : null,
      text: element.textContent?.trim().slice(0, 80) ?? null,
      backgroundColor: style.backgroundColor,
      borderTopColor: style.borderTopColor,
      color: style.color,
      display: style.display,
      opacity: style.opacity,
      visibility: style.visibility,
    };
  };
  const rectFor = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
    };
  };
  const summarizeElement = (element) => {
    if (!element) return null;
    return {
      tagName: element.tagName?.toLowerCase() ?? null,
      className: typeof element.className === "string" ? element.className : null,
      text: element.textContent?.trim().slice(0, 80) ?? null,
      rect: rectFor(element),
    };
  };
  const elementAtCenter = (element) => {
    const rect = element?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return {
      point: { x: Math.round(x), y: Math.round(y) },
      hit: summarizeElement(hit),
      textContainsHit: Boolean(hit && (element === hit || element.contains(hit))),
      hitContainsText: Boolean(hit && hit.contains(element)),
    };
  };
  const canvasReadbackProbe = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const context = canvas.getContext("2d");
      if (!context) return { ok: false, error: "2d context unavailable" };
      context.fillStyle = "rgb(255, 255, 255)";
      context.fillRect(0, 0, 2, 2);
      context.fillStyle = "rgb(17, 17, 17)";
      context.fillRect(1, 1, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return {
        ok: true,
        firstPixel: [pixel[0], pixel[1], pixel[2], pixel[3]],
        dataUrlPrefix: canvas.toDataURL("image/png").slice(0, 32),
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  };
  const assetUrls = () => {
    const entries = [];
    for (const script of [...document.scripts]) {
      if (script.src) entries.push({ kind: "script", url: script.src, crossOrigin: script.crossOrigin || "" });
    }
    for (const link of [...document.querySelectorAll("link[rel~='stylesheet']")]) {
      if (link.href) entries.push({ kind: "stylesheet", url: link.href, crossOrigin: link.crossOrigin || "" });
    }
    return entries;
  };
  const assetFetchProbe = async (label) => {
    const assets = assetUrls();
    const results = [];
    for (const asset of assets) {
      const startedAt = performance.now();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(asset.url, { cache: "no-store", signal: controller.signal });
        const text = await response.clone().text().catch(() => "");
        results.push({
          ...asset,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          redirected: response.redirected,
          contentType: response.headers.get("content-type") || "",
          byteLength: text.length,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        results.push({
          ...asset,
          ok: false,
          status: null,
          statusText: "",
          redirected: false,
          contentType: "",
          byteLength: 0,
          elapsedMs: Math.round(performance.now() - startedAt),
          errorName: error?.name || "Error",
          errorMessage: String(error?.message || error),
        });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    const payload = {
      label,
      url: document.URL || "",
      baseURI: document.baseURI || "",
      readyState: document.readyState || "",
      rootChildren: document.getElementById("root")?.childElementCount ?? null,
      bodyTextLength: document.body?.innerText?.length ?? null,
      htmlLength: document.documentElement?.outerHTML?.length ?? null,
      assets: results,
    };
    const serialized = JSON.stringify(payload);
    try {
      window.localStorage.setItem(`nixmac:e2e-asset-probe:${label}`, serialized.slice(0, 12000));
    } catch {}
    logCaptureBreadcrumb(`e2e-asset-fetch-${label}`, serialized);
  };
  const captureStyleProbe = (label) => {
    try {
      const root = document.getElementById("root");
      const shell = root?.firstElementChild ?? null;
      const card = firstMatchingElement(["[data-slot='card']", ".bg-card", ".bg-card\\/50", ".bg-card\\/80", ".bg-card\\/95"]);
      const header = firstMatchingElement(["[data-tauri-drag-region='true'].border-b", ".border-b"]);
      const button = document.querySelector("button");
      const svg = document.querySelector("svg");
      const textElement = firstTextElement();
      const assets = assetUrls();
      const htmlStyle = window.getComputedStyle(document.documentElement);
      const bodyStyle = document.body ? window.getComputedStyle(document.body) : null;
      const shellStyle = shell ? window.getComputedStyle(shell) : null;
      logCaptureBreadcrumb(
        `e2e-capture-style-${label}`,
        JSON.stringify({
          captureMode,
          capturePaint: document.documentElement.dataset.nixmacE2eCapturePaint ?? null,
          visibilityState: document.visibilityState,
          devicePixelRatio: window.devicePixelRatio,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          rootChildren: root?.childElementCount ?? null,
          bodyChildren: document.body?.childElementCount ?? null,
          assetCount: assets.length,
          assetUrls: assets,
          shellClassName: typeof shell?.className === "string" ? shell.className : null,
          rootRect: rectFor(root),
          shellRect: rectFor(shell),
          htmlBackgroundColor: htmlStyle.backgroundColor,
          bodyBackgroundColor: bodyStyle?.backgroundColor ?? null,
          shellBackgroundColor: shellStyle?.backgroundColor ?? null,
          shellBackdropFilter: getCssValue(shellStyle, "backdrop-filter"),
          shellWebkitBackdropFilter: getCssValue(shellStyle, "-webkit-backdrop-filter"),
          shellOpacity: shellStyle?.opacity ?? null,
          bodyColor: bodyStyle?.color ?? null,
          captureReady: document.documentElement.dataset.nixmacE2eCaptureReady ?? null,
          cardStyle: sampleStyle(card),
          headerStyle: sampleStyle(header),
          buttonStyle: sampleStyle(button),
          svgStyle: sampleStyle(svg),
          textStyle: sampleStyle(textElement),
          textRect: rectFor(textElement),
          textElementAtCenter: elementAtCenter(textElement),
          canvasReadback: canvasReadbackProbe(),
        }),
      );
    } catch (error) {
      logCaptureBreadcrumb("e2e-capture-style-probe-error", String(error));
    }
  };
  const applyCaptureBackground = () => {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.nixmacE2eCapture = captureMode;
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        html[data-nixmac-e2e-capture="${captureMode}"],
        html[data-nixmac-e2e-capture="${captureMode}"] body,
        html[data-nixmac-e2e-capture="${captureMode}"] #root {
          --nixmac-e2e-capture-background: hsl(var(--background, 0 0% 3.9%));
          --nixmac-e2e-capture-surface: hsl(var(--accent, 0 0% 14.9%));
          --nixmac-e2e-capture-card: hsl(var(--card, 0 0% 3.9%));
          --nixmac-e2e-capture-foreground: hsl(var(--foreground, 0 0% 98%));
          --nixmac-e2e-capture-muted: hsl(var(--muted-foreground, 0 0% 63.9%));
          --nixmac-e2e-capture-border: hsl(var(--border, 0 0% 14.9%));
          --nixmac-e2e-capture-primary: hsl(var(--primary, 0 0% 98%));
          --nixmac-e2e-capture-primary-foreground: hsl(var(--primary-foreground, 0 0% 9%));
          background: var(--nixmac-e2e-capture-background) !important;
          background-color: var(--nixmac-e2e-capture-background) !important;
          color: var(--nixmac-e2e-capture-foreground) !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] #root > * {
          background-color: var(--nixmac-e2e-capture-background) !important;
          color: var(--nixmac-e2e-capture-foreground) !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-background\\/80,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-background\\/90,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-background\\/95 {
          background-color: var(--nixmac-e2e-capture-background) !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-card\\/50,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-card\\/80,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-card\\/95,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-zinc-900\\/95 {
          background-color: var(--nixmac-e2e-capture-surface) !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] [data-slot="card"],
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-card {
          background-color: var(--nixmac-e2e-capture-card) !important;
          border-color: var(--nixmac-e2e-capture-border) !important;
          color: var(--nixmac-e2e-capture-foreground) !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] [class*="text-foreground"],
        html[data-nixmac-e2e-capture="${captureMode}"] [class*="text-card-foreground"] {
          color: var(--nixmac-e2e-capture-foreground) !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] [class*="text-muted-foreground"] {
          color: var(--nixmac-e2e-capture-muted) !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] [class~="text-primary"] {
          color: var(--nixmac-e2e-capture-primary) !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-primary {
          background-color: var(--nixmac-e2e-capture-primary) !important;
          color: var(--nixmac-e2e-capture-primary-foreground) !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] [class*="border"] {
          border-color: var(--nixmac-e2e-capture-border) !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] svg {
          color: currentColor;
          stroke: currentColor;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] *,
        html[data-nixmac-e2e-capture="${captureMode}"] *::before,
        html[data-nixmac-e2e-capture="${captureMode}"] *::after {
          -webkit-backdrop-filter: none !important;
          backdrop-filter: none !important;
        }
      `;
      document.head.appendChild(style);
    }
    requestAnimationFrame(() => {
      document.documentElement.dataset.nixmacE2eCapturePaint = "raf";
      logCaptureBreadcrumb(
        "e2e-capture-paint-raf",
        JSON.stringify({
          captureMode,
          rootChildren: document.getElementById("root")?.childElementCount ?? null,
          bodyChildren: document.body?.childElementCount ?? null,
        }),
      );
      captureStyleProbe("initial-raf");
      assetFetchProbe("initial-raf").catch((error) => {
        logCaptureBreadcrumb("e2e-asset-fetch-error", String(error));
      });
      requestAnimationFrame(() => {
        document.documentElement.dataset.nixmacE2eCaptureReady = "1";
        logCaptureBreadcrumb(
          "e2e-capture-ready-2raf",
          JSON.stringify({
            captureMode,
            rootChildren: document.getElementById("root")?.childElementCount ?? null,
            bodyChildren: document.body?.childElementCount ?? null,
          }),
        );
        captureStyleProbe("capture-ready-2raf");
        assetFetchProbe("capture-ready-2raf").catch((error) => {
          logCaptureBreadcrumb("e2e-asset-fetch-error", String(error));
        });
      });
    });
    window.addEventListener(
      "nixmac:app-mounted",
      () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.documentElement.dataset.nixmacE2eCaptureReady = "app-mounted";
            captureStyleProbe("app-mounted-plus-2raf");
          });
        });
      },
      { once: true },
    );
  };
  if (document.head) {
    applyCaptureBackground();
  } else {
    document.addEventListener("DOMContentLoaded", applyCaptureBackground, { once: true });
  }
  document.addEventListener("DOMContentLoaded", () => {
    assetFetchProbe("dom-content-loaded").catch((error) => {
      logCaptureBreadcrumb("e2e-asset-fetch-error", String(error));
    });
  }, { once: true });
  window.setTimeout(() => {
    assetFetchProbe("post-injection-plus-2s").catch((error) => {
      logCaptureBreadcrumb("e2e-asset-fetch-error", String(error));
    });
  }, 2000);
})();
"#;

fn main() {
    // Initialize tracing subscriber with optional file logging
    let env_filter = crate::e2e_runtime::value("RUST_LOG")
        .map(EnvFilter::new)
        .unwrap_or_else(|| {
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
        });

    // Keep the WorkerGuard alive for the lifetime of `main()` so drops flush buffered logs
    let log_guard: Arc<Mutex<Option<tracing_appender::non_blocking::WorkerGuard>>> =
        Arc::new(Mutex::new(None));

    if let Some(log_path) = crate::e2e_runtime::value("NIXMAC_LOGFILE") {
        // Set up dual logging: console + file
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            Ok(file) => {
                // Create a non-blocking file writer and keep the WorkerGuard in `log_guard`
                let (non_blocking, guard) = tracing_appender::non_blocking(file);

                // Store the guard so it lives until the end of `main()` (or until explicitly dropped)
                {
                    let mut g = log_guard.lock().unwrap();
                    *g = Some(guard);
                }

                tracing_subscriber::registry()
                    .with(env_filter)
                    .with(fmt::layer().with_writer(std::io::stderr)) // Console output
                    .with(fmt::layer().with_writer(non_blocking).with_ansi(false)) // File output (no ANSI)
                    .init();

                let full_path = std::fs::canonicalize(&log_path)
                    .unwrap_or_else(|_| std::path::PathBuf::from(&log_path));
                eprintln!(
                    "[nixmac] Logging to both console and {}",
                    full_path.display()
                );
                log::info!("NIXMAC_LOGFILE active at {}", full_path.display());
            }
            Err(e) => {
                eprintln!("[nixmac] Failed to open NIXMAC_LOGFILE {}: {}", log_path, e);
                // Fall back to console-only logging (write to stderr to match env_logger behavior)
                tracing_subscriber::registry()
                    .with(env_filter)
                    .with(fmt::layer().with_writer(std::io::stderr))
                    .init();
            }
        }
    } else {
        // Console-only logging (write to stderr to match env_logger behavior)
        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt::layer().with_writer(std::io::stderr))
            .init();
    }

    // Bridge log crate to tracing (for compatibility with existing log:: calls).
    // fire-and-forget: LogTracer::init() returns Err if called more than once
    // (double-init is benign). Ignoring is correct.
    let _ = tracing_log::LogTracer::init();

    let context = tauri::generate_context!();
    log::debug!("nixmac process booted");

    // Check if running in CLI mode
    if cli::should_run_cli() {
        let exit_code = run_cli_mode(context);
        // Ensure the WorkerGuard is dropped (flush logs) before exiting.
        drop(log_guard);
        std::process::exit(exit_code);
    }

    run_gui_mode(context, log_guard);
}

fn run_cli_mode(context: tauri::Context<tauri::Wry>) -> i32 {
    let cli = match cli::parse_cli() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to parse CLI arguments: {}", e);
            return 1;
        }
    };

    match cli.command {
        Some(cli::Commands::Evolve {
            prompt,
            config,
            max_iterations,
            evolve_provider,
            evolve_model,
            summary_provider,
            summary_model,
            openai_key,
            openrouter_key,
            ollama_url,
            host,
            out,
        }) => {
            // For CLI mode, we need to create a Tauri app instance to access store functionality
            let runtime = match tokio::runtime::Runtime::new() {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("Failed to create async runtime: {}", e);
                    return 1;
                }
            };

            let result = runtime.block_on(async {
                let app = match tauri::Builder::default()
                    // Ensure store plugin (and its managed state) is initialized so we can load settings
                    .plugin(tauri_plugin_store::Builder::default().build())
                    .plugin(tauri_plugin_keyring::init())
                    .invoke_handler(tauri::generate_handler![])
                    .setup(|_app| Ok(()))
                    .build(context)
                {
                    Ok(app) => app,
                    Err(e) => {
                        eprintln!("Failed to initialize Tauri: {}", e);
                        return Err(String::from("Tauri initialization failed"));
                    }
                };

                let app_handle = app.handle();

                // Initialize DB schema for CLI mode so commands depending on tables succeed
                if let Err(e) = db::init(app_handle).await {
                    eprintln!("Failed to initialize database: {}", e);
                    return Err(format!("DB init failed: {}", e));
                }

                let cfg = cli::EvolveConfig {
                    prompt,
                    config,
                    max_iterations,
                    evolve_provider,
                    evolve_model,
                    summary_provider,
                    summary_model,
                    openai_key,
                    openrouter_key,
                    ollama_url,
                    host,
                    out,
                };

                cli::handle_evolve_command(app_handle, cfg).await
            });

            match result {
                Ok(_) => {
                    log::info!("CLI evolution completed successfully");
                    0
                }
                Err(e) => {
                    eprintln!("Evolution failed: {}", e);
                    log::error!("CLI evolution failed: {}", e);
                    1
                }
            }
        }
        None => {
            eprintln!("No command specified. Use 'nixmac evolve --help' for usage information.");
            1
        }
    }
}

fn run_gui_mode(
    context: tauri::Context<tauri::Wry>,
    log_guard: std::sync::Arc<
        std::sync::Mutex<Option<tracing_appender::non_blocking::WorkerGuard>>,
    >,
) {
    // Prefer compile-time embedded vars (set by build.rs via `cargo:rustc-env`),
    // fall back to runtime environment variables.
    let sentry_dsn = option_env!("SENTRY_DSN")
        .map(|s| s.to_string())
        .or_else(|| env::var("SENTRY_DSN").ok());

    let nixmac_env = option_env!("NIXMAC_ENV")
        .map(|s| s.to_string())
        .or_else(|| env::var("NIXMAC_ENV").ok())
        .unwrap_or_else(|| "prod".to_string());

    let nixmac_version = option_env!("NIXMAC_VERSION")
        .map(|s| s.to_string())
        .or_else(|| env::var("NIXMAC_VERSION").ok())
        .unwrap_or_else(|| "unknown".to_string());

    let mut sentry_guard = None;

    if let Some(dsn) = sentry_dsn.filter(|s| !s.trim().is_empty()) {
        // clone `nixmac_env`/`nixmac_version` so we don't move the original
        // values and can use them again below for logging. Annoying Rust thing.
        let client = sentry::init((
            dsn,
            sentry::ClientOptions {
                environment: Some(nixmac_env.clone().into()),
                release: Some(nixmac_version.clone().into()),
                auto_session_tracking: false,
                send_default_pii: false,
                ..Default::default()
            },
        ));

        sentry_guard = Some(client);
    }

    let mut builder = tauri::Builder::default().plugin(tauri_plugin_http::init());

    if let Some(client) = sentry_guard.as_ref() {
        builder = builder.plugin(tauri_plugin_sentry::init(client));
    }

    // The updater will misbehave in dev mode (always says an update is available, fails signature
    // checks, tries to downgrade your app, etc.), so we only include it in release builds.
    // Also skip it when NIXMAC_DISABLE_UPDATER=1 is set (used in E2E/CI environments where the
    // updater can crash on launch due to missing platforms in latest.json or unsigned builds).
    #[cfg(not(debug_assertions))]
    {
        if std::env::var("NIXMAC_DISABLE_UPDATER").unwrap_or_default() != "1" {
            builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        } else {
            log::info!("Updater plugin disabled via NIXMAC_DISABLE_UPDATER=1");
        }
    }

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_webdriver_automation::init());
    }

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_keyring::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(tauri_plugin_websocket::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .invoke_handler(tauri::generate_handler![
            // Configuration
            commands::config::config_get,
            commands::config::config_set_host_attr,
            commands::config::config_set_dir,
            commands::config::config_prepare_new_dir,
            commands::config::config_pick_dir,
            commands::config::flake_exists_at,
            commands::config::path_exists,
            commands::config::path_normalize,
            // Feedback
            commands::feedback::feedback_gather_metadata,
            commands::feedback::feedback_submit,
            #[cfg(debug_assertions)]
            commands::debug::trigger_test_panic,
            #[cfg(debug_assertions)]
            commands::debug::debug_sentry_event,
            commands::debug::developer_clear_tauri_state,
            #[cfg(debug_assertions)]
            commands::debug::e2e_log_breadcrumb,
            #[cfg(debug_assertions)]
            commands::debug::e2e_mark_boot_stage,
            // Homebrew
            commands::homebrew::homebrew_apply_diff,
            commands::homebrew::homebrew_get_state_diff,
            // Git
            commands::git::git_status,
            commands::git::git_status_and_cache,
            commands::git::git_cached,
            commands::git::git_commit,
            commands::git::git_stash,
            // Darwin/Nix
            commands::evolve::darwin_evolve,
            commands::evolve::darwin_evolve_cancel,
            commands::evolve::darwin_evolve_answer,
            commands::apply::darwin_apply_stream_start,
            commands::apply::darwin_activate_store_path,
            commands::apply::darwin_apply_stream_cancel,
            commands::apply::finalize_apply,
            commands::apply::finalize_rollback,
            commands::rollback::rollback_erase,
            commands::rollback::darwin_build_check,
            commands::rollback::darwin_adopt_manual_changes,
            commands::summarize::prepare_restore,
            commands::summarize::abort_restore,
            commands::summarize::finalize_restore,
            // Routing state
            commands::evolve_state::routing_state_get,
            commands::evolve_state::routing_state_clear,
            commands::apply::nix_check,
            commands::apply::nix_install_start,
            commands::apply::darwin_rebuild_prefetch,
            commands::apply::finalize_flake_lock,
            commands::apply::flake_installed_apps,
            commands::apply::flake_list_hosts,
            commands::config::flake_exists,
            commands::config::bootstrap_default_config,
            // Summarization
            commands::summarize::find_change_map,
            commands::summarize::get_history,
            commands::summarize::generate_history_from,
            commands::summarize::summarize_current,
            commands::summarize::generate_commit_message,
            // UI preferences
            commands::ui_prefs::ui_get_prefs,
            commands::ui_prefs::ui_set_prefs,
            // Model cache
            commands::ui_prefs::get_cached_models,
            commands::ui_prefs::set_cached_models,
            commands::ui_prefs::clear_cached_models,
            // Prompt history
            commands::ui_prefs::get_prompt_history,
            commands::ui_prefs::add_to_prompt_history,
            // Window
            commands::peek::show_main_window,
            // Preview indicator
            commands::peek::preview_indicator_show,
            commands::peek::preview_indicator_hide,
            commands::peek::preview_indicator_update,
            commands::peek::preview_indicator_get_state,
            commands::peek::set_has_uncommitted_changes,
            // Permissions
            commands::permissions::permissions_check_all,
            commands::permissions::permissions_request,
            commands::permissions::permissions_all_required_granted,
            // System defaults scanner
            commands::system_defaults::get_recommended_prompt,
            commands::system_defaults::scan_system_defaults,
            commands::system_defaults::apply_system_defaults,
            // CLI tool detection
            commands::cli_tool::check_cli_tools,
            commands::cli_tool::list_cli_models,
            // Updater
            commands::updater::relaunch_after_update,
            updater_pin::install_version,
            updater_pin::clear_pinned_version,
            // Editor
            commands::editor::editor_read_file,
            commands::editor::editor_write_file,
            commands::editor::editor_list_files,
            // LSP
            commands::editor::lsp_start,
            commands::editor::lsp_send,
            commands::editor::lsp_stop,
        ])
        .setup(move |app| {
            let handle = app.handle();
            log::debug!("Tauri setup started");

            // Set up panic handler to catch crashes and show feedback dialog
            panic_handler::setup_panic_hook(handle.clone());

            // Initialize SQLite database
            let db_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = db::init(&db_handle).await {
                    log::error!("Failed to initialize database: {}", e);
                } else {
                    log::info!("Database initialized successfully");
                }
            });

            // Retry any pending feedback reports from previous failed submissions
            let retry_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                match feedback::retry_pending(&retry_handle).await {
                    Ok(n) if n > 0 => {
                        log::info!("Retried and sent {} pending feedback report(s)", n)
                    }
                    Err(e) => log::warn!("Failed to retry pending feedback: {}", e),
                    _ => {}
                }
            });

            // Eagerly initialise the scanner singleton; the returned &'static ref is not
            // needed right now. fire-and-forget is intentional here.
            let _ = system::secret_scanner::SecretScanner::global(handle);

            // Build the nix-darwin docs index once at startup for fast option-shape lookup.
            // CONSIDER: Moving this to background or do it on first search_docs call
            // if we start to get concerned about startup time.
            evolve::search_docs::initialize_docs_index();

            let send_diagnostics = store::get_send_diagnostics(handle).unwrap_or(false);
            if send_diagnostics {
                log::info!(
                    "Sentry diagnostics enabled by user preference (env: {}, version: {})",
                    nixmac_env,
                    nixmac_version
                );
            } else {
                log::info!("Sentry diagnostics disabled by user preference");
                if sentry_guard.is_some() {
                    sentry::Hub::current().bind_client(None);
                }
            }

            // Build the system tray menu
            let open_i = MenuItem::with_id(app, "open", "Open nixmac", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let feedback_i =
                MenuItem::with_id(app, "send_feedback", "Send Feedback...", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit nixmac", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[&open_i, &sep1, &feedback_i, &settings_i, &sep2, &quit_i],
            )?;

            // Clone a handle to the guard for use in menu callbacks (so we can flush on quit)
            let log_guard_for_menu = log_guard.clone();

            let _tray = TrayIconBuilder::new()
                .icon(
                    Image::from_path("icons/outline@2x.png").unwrap_or_else(|_| {
                        app.default_window_icon()
                            .expect("app must have a default icon bundled")
                            .clone()
                    }),
                )
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_tray_icon_event(|tray_handle, event| {
                    tauri_plugin_positioner::on_tray_event(tray_handle.app_handle(), &event);
                })
                // All window calls below are fire-and-forget: tray menu callbacks run
                // asynchronously and the window may be hidden or in a transitional state.
                // show/set_focus/emit only fail when the window is destroyed, which is
                // acceptable — the app is still running, just with no visible window.
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "send_feedback" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("tray:open-feedback", ());
                        }
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("tray:open-settings", ());
                        }
                    }
                    "quit" => {
                        // Explicitly drop the WorkerGuard (flush logs) before exiting.
                        if let Some(_g) = log_guard_for_menu.lock().unwrap().take() {
                            // `_g` dropped here
                        }
                        std::process::exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Create the main window
            let initial_width = 800.0;
            let initial_height = 800.0;
            let min_width = 400.0;
            let max_width = 1000.0;
            let min_height = 400.0;
            let max_height = 900.0;
            let e2e_opaque_window = e2e_opaque_window_enabled();
            let e2e_solid_capture = e2e_solid_capture_enabled();
            let e2e_css_capture = e2e_solid_capture || e2e_opaque_window;
            let e2e_webview_watchdog = e2e_webview_watchdog_enabled() || e2e_opaque_window;
            if e2e_solid_capture {
                log::info!("NIXMAC_E2E_SOLID_CAPTURE enabled; using CSS-only dark WebView capture while preserving the normal overlay window");
            }
            if e2e_opaque_window {
                log::info!("NIXMAC_E2E_OPAQUE_WINDOW enabled; using an opaque visible-titlebar window with dark WebView backing for host visual capture");
            }
            if e2e_webview_watchdog {
                log::info!("NIXMAC_E2E_WEBVIEW_WATCHDOG enabled; stalled main WebView loads will request one reload");
            }
            let main_webview_loaded = Arc::new(AtomicBool::new(false));
            let main_webview_loaded_for_page_load = Arc::clone(&main_webview_loaded);
            let e2e_page_load_boot_probe = e2e_webview_watchdog;
            let e2e_page_load_native_capture_probe = e2e_css_capture;

            let mut main_window_builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("nixmac")
                    .inner_size(initial_width, initial_height)
                    .min_inner_size(min_width, min_height)
                    .max_inner_size(max_width, max_height)
                    .resizable(true)
                    .maximizable(false)
                    .minimizable(true)
                    .closable(true)
                    .decorations(true)
                    .transparent(!e2e_opaque_window)
                    .visible(true)
                    .always_on_top(false)
                    .visible_on_all_workspaces(true)
                    .hidden_title(!e2e_opaque_window)
                    .title_bar_style(if e2e_opaque_window {
                        tauri::TitleBarStyle::Visible
                    } else {
                        tauri::TitleBarStyle::Overlay
                    })
                    .on_page_load(move |window, payload| {
                        log::debug!(
                            "main webview page load {:?}: {}",
                            payload.event(),
                            payload.url()
                        );
                        if payload.event() == PageLoadEvent::Finished {
                            main_webview_loaded_for_page_load.store(true, Ordering::SeqCst);
                            if e2e_page_load_boot_probe {
                                e2e_schedule_webview_boot_probe(
                                    window.clone(),
                                    "page-load-finished-plus-1s",
                                    Duration::from_secs(1),
                                );
                                e2e_schedule_webview_boot_probe(
                                    window.clone(),
                                    "page-load-finished-plus-5s",
                                    Duration::from_secs(5),
                                );
                            }
                            if e2e_page_load_native_capture_probe {
                                e2e_schedule_native_webview_capture_probe(
                                    window.clone(),
                                    "native-page-load-finished-plus-5s",
                                    Duration::from_secs(5),
                                );
                                e2e_schedule_native_webview_snapshot(
                                    window.clone(),
                                    "page-load-finished-plus-5s",
                                    Duration::from_secs(5),
                                );
                            }
                        }
                    });

            if e2e_opaque_window {
                main_window_builder = main_window_builder
                    .background_color(tauri::utils::config::Color(10, 10, 10, 255));
            }

            if e2e_css_capture {
                main_window_builder =
                    main_window_builder.initialization_script(E2E_CAPTURE_DARK_BACKGROUND_SCRIPT);
            }

            let main_window = main_window_builder.build().map_err(|e| {
                let msg = format!("Failed to create main window: {}", e);
                log::error!("{}", msg);
                sentry::capture_message(&msg, sentry::Level::Error);
                msg
            })?;
            log::debug!("Main nixmac window created");

            #[cfg(all(debug_assertions, target_os = "macos"))]
            if e2e_css_capture {
                use objc::msg_send;
                use objc::runtime::{Object, NO};
                use objc::sel;
                use objc::sel_impl;

                match main_window.ns_window() {
                    Ok(ns_window) => unsafe {
                        let ns_window = ns_window as *mut Object;
                        let sharing_type_before: usize = msg_send![ns_window, sharingType];
                        let can_disable_occlusion: bool = msg_send![
                            ns_window,
                            respondsToSelector: sel!(_setWindowOcclusionDetectionEnabled:)
                        ];
                        if can_disable_occlusion {
                            let _: () =
                                msg_send![ns_window, _setWindowOcclusionDetectionEnabled: NO];
                        }
                        let can_disable_hide_on_deactivate: bool =
                            msg_send![ns_window, respondsToSelector: sel!(setHidesOnDeactivate:)];
                        if can_disable_hide_on_deactivate {
                            let _: () = msg_send![ns_window, setHidesOnDeactivate: NO];
                        }
                        let can_disable_can_hide: bool =
                            msg_send![ns_window, respondsToSelector: sel!(setCanHide:)];
                        if can_disable_can_hide {
                            let _: () = msg_send![ns_window, setCanHide: NO];
                        }
                        if let Err(error) = main_window.set_content_protected(false) {
                            log::warn!(
                                "NIXMAC_E2E_CAPTURE native window could not disable content protection: {}",
                                error
                            );
                        }
                        let sharing_type_after: usize = msg_send![ns_window, sharingType];
                        let is_opaque: bool = msg_send![ns_window, isOpaque];
                        let alpha_value: f64 = msg_send![ns_window, alphaValue];
                        let level: i64 = msg_send![ns_window, level];
                        let has_shadow: bool = msg_send![ns_window, hasShadow];
                        log::info!(
                            "NIXMAC_E2E_CAPTURE native window diagnostics: mode={} sharingTypeBefore={} sharingTypeAfter={} isOpaque={} alphaValue={:.3} level={} hasShadow={} occlusionDetectionDisabled={} hidesOnDeactivateDisabled={} canHideDisabled={}",
                            if e2e_opaque_window {
                                "opaque"
                            } else {
                                "solid"
                            },
                            sharing_type_before,
                            sharing_type_after,
                            is_opaque,
                            alpha_value,
                            level,
                            has_shadow,
                            can_disable_occlusion,
                            can_disable_hide_on_deactivate,
                            can_disable_can_hide
                        );
                    },
                    Err(error) => {
                        log::warn!(
                            "NIXMAC_E2E_CAPTURE native window diagnostics unavailable: {}",
                            error
                        );
                    }
                }
            }

            if e2e_css_capture {
                e2e_start_native_webview_snapshot_request_poller(main_window.clone());
                e2e_schedule_native_webview_capture_probe(
                    main_window.clone(),
                    "native-post-build-plus-2s",
                    Duration::from_secs(2),
                );
                e2e_schedule_native_webview_snapshot(
                    main_window.clone(),
                    "post-build-plus-2s",
                    Duration::from_secs(2),
                );
            }

            if e2e_webview_watchdog {
                e2e_schedule_webview_boot_probe(
                    main_window.clone(),
                    "post-build-plus-2s",
                    Duration::from_secs(2),
                );
                e2e_schedule_webview_boot_probe(
                    main_window.clone(),
                    "post-build-plus-10s",
                    Duration::from_secs(10),
                );
                let watchdog_window = main_window.clone();
                let watchdog_loaded = Arc::clone(&main_webview_loaded);
                let watchdog_secs =
                    crate::e2e_runtime::value("NIXMAC_E2E_WEBVIEW_WATCHDOG_SECS")
                        .and_then(|value| value.parse::<u64>().ok())
                        .filter(|value| (1..=60).contains(value))
                        .unwrap_or(12);
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(watchdog_secs));
                    if watchdog_loaded.load(Ordering::SeqCst) {
                        log::debug!("main webview E2E load watchdog satisfied before reload");
                        return;
                    }

                    log::warn!(
                        "main webview E2E load watchdog did not observe PageLoadEvent::Finished; reloading main webview"
                    );
                    let reload_window = watchdog_window.clone();
                    if let Err(err) = watchdog_window.run_on_main_thread(move || {
                        e2e_request_webview_boot_probe(&reload_window, "watchdog-before-reload");
                        if let Err(reload_err) = reload_window.reload() {
                            log::error!(
                                "main webview E2E load watchdog reload failed: {}",
                                reload_err
                            );
                        } else {
                            log::warn!("main webview E2E load watchdog reload requested");
                        }
                    }) {
                        log::error!(
                            "main webview E2E load watchdog could not schedule reload: {}",
                            err
                        );
                    }
                });
            }

            // set up watcher with interval based on focus
            let handle_for_focus = handle.clone();
            main_window.on_window_event(move |event| {
                if let WindowEvent::Focused(focused) = event {
                    if let Ok(config_dir) = store::get_config_dir(&handle_for_focus) {
                        let interval_ms = if *focused { 2500 } else { 15000 };
                        watcher::start_watching(handle_for_focus.clone(), config_dir, interval_ms);
                    }
                }
            });

            // Keep window shadow for visual polish (shadow doesn't cause click issues, Acrylic did)
            let _ = main_window;

            // Create the preview indicator window (persistent banner for uncommitted changes)
            // if let Err(e) = peek::create_preview_indicator_window(handle) {
            //     log::error!("[peek] ❌ Failed to create preview indicator window: {}", e);
            // }

            // Start config watcher - monitors config directory for file changes
            // This emits config:changed events to the frontend when files are modified
            if let Ok(config_dir) = store::get_config_dir(handle) {
                watcher::start_watching(handle.clone(), config_dir, 2500);
            }

            Ok(())
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Handle window close events - hide window but keep app running
            if let RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } = &event
            {
                if label == "main" {
                    // Prevent the window from being destroyed
                    api.prevent_close();
                    if let Some(window) = app_handle.get_webview_window("main") {
                        // fire-and-forget: hide() can fail if window is already hidden.
                        let _ = window.hide();
                        // Update peek state
                        peek::unlock_and_hide();
                    }
                }
            }

            // Click Nixmac icon to show
            if let RunEvent::Reopen { .. } = &event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    // fire-and-forget: show/set_focus fail only on destroyed window.
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}

#[cfg(test)]
mod test_support {
    use std::env;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    pub(crate) fn e2e_env_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) struct EnvVarRestore {
        saved: Vec<(&'static str, Option<String>)>,
    }

    impl EnvVarRestore {
        pub(crate) fn capture(keys: &[&'static str]) -> Self {
            Self {
                saved: keys.iter().map(|key| (*key, env::var(key).ok())).collect(),
            }
        }
    }

    impl Drop for EnvVarRestore {
        fn drop(&mut self) {
            for (key, value) in &self.saved {
                match value {
                    Some(value) => env::set_var(key, value),
                    None => env::remove_var(key),
                }
            }
        }
    }
}
