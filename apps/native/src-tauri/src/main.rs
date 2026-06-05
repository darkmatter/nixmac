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
mod observable;
mod panic_handler;
mod peek;
mod rebuild;
mod shared_types;
mod sqlite_types;
mod state;
mod statistics;
mod storage;
mod summarize;
mod sync;
mod system;
mod telemetry;
mod types;
mod updater_pin;
mod utils;

use state::watcher;
use storage::store;

use std::env;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use tauri::{
    Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    webview::PageLoadEvent,
};
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

/// Global app handle, set during GUI setup so background threads (such as the
/// drift watcher) can access plugins like notifications without threading an
/// `AppHandle` through every call site.
pub static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

fn e2e_opaque_window_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_OPAQUE_WINDOW")
}

fn e2e_solid_capture_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_SOLID_CAPTURE")
}

fn e2e_webview_watchdog_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_WEBVIEW_WATCHDOG")
}

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
    title: document.title || "",
    readyState: document.readyState || "",
    bootStage: document.documentElement?.dataset?.nixmacBootStage || "",
    capture: document.documentElement?.dataset?.nixmacE2eCapture || "",
    capturePaint: document.documentElement?.dataset?.nixmacE2eCapturePaint || "",
    rootChildren: document.getElementById("root")?.childElementCount ?? null,
    bodyTextLength: document.body?.innerText?.length ?? null,
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

const E2E_CAPTURE_DARK_BACKGROUND_SCRIPT: &str = r#"
(() => {
  const styleId = "nixmac-e2e-capture-background";
  const captureMode = "solid";
  const captureBackground = "hsl(0 0% 3.9%)";
  const logCaptureBreadcrumb = (label, detail) => {
    const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") return;
    invoke("e2e_log_breadcrumb", {
      label,
      detail,
      clientTimestampUnixMs: Date.now(),
    }).catch(() => {});
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
          background: ${captureBackground} !important;
          background-color: ${captureBackground} !important;
        }
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-background\\/80,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-background\\/90,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-background\\/95,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-card\\/50,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-card\\/80,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-card\\/95,
        html[data-nixmac-e2e-capture="${captureMode}"] .bg-zinc-900\\/95 {
          background-color: ${captureBackground} !important;
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
    });
  };
  if (document.head) {
    applyCaptureBackground();
  } else {
    document.addEventListener("DOMContentLoaded", applyCaptureBackground, { once: true });
  }
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
            max_output_tokens,
            max_token_budget,
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
                    .plugin(tauri_plugin_notification::init())
                    .invoke_handler(tauri::generate_handler![])
                    .setup(|app| {
                        app.manage(state::preferences::load_global_observable(app.handle())?);
                        app.manage(evolve::config::load_observable(app.handle())?);
                        evolve::config::register_slice_config(
                            &app.state::<state::slice::SliceRegistry>(),
                        )?;
                        app.manage(state::evolve_state::load_observable(app.handle())?);
                        Ok(())
                    })
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
                    max_output_tokens,
                    max_token_budget,
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
    let nixmac_env = option_env!("NIXMAC_ENV")
        .map(|s| s.to_string())
        .or_else(|| env::var("NIXMAC_ENV").ok())
        .unwrap_or_else(|| "prod".to_string());

    let nixmac_version = option_env!("NIXMAC_VERSION")
        .map(|s| s.to_string())
        .or_else(|| env::var("NIXMAC_VERSION").ok())
        .unwrap_or_else(|| "unknown".to_string());

    let mut builder = tauri::Builder::default().plugin(tauri_plugin_http::init());

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
        .plugin(tauri_plugin_notification::init())
        // Configurable slices register here during setup so dev settings
        // commands can update typed state without opening store files directly.
        .manage(state::slice::SliceRegistry::default())
        .invoke_handler(tauri::generate_handler![
            // Configuration
            commands::config::config_get,
            commands::config::config_set_host_attr,
            commands::config::config_set_dir,
            commands::config::config_prepare_new_dir,
            commands::config::config_pick_dir,
            commands::config::flake_exists_at,
            commands::config::get_this_hostname,
            commands::config::path_exists,
            commands::config::path_normalize,
            commands::config::config_pick_zip,
            commands::config::config_import_github,
            commands::config::config_import_zip,
            // nixmac account + non-GitHub sync
            commands::account::account_status,
            commands::account::account_sign_in,
            commands::account::account_sign_out,
            commands::account::account_set_server_url,
            commands::account::sync_status,
            commands::account::sync_push,
            commands::account::sync_pull,
            // Feedback
            commands::feedback::feedback_gather_metadata,
            commands::feedback::feedback_submit,
            #[cfg(debug_assertions)]
            commands::debug::trigger_test_panic,
            commands::debug::developer_clear_tauri_state,
            commands::debug::developer_send_test_notification,
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
            commands::git::git_commit,
            commands::git::git_file_diff_contents,
            // Darwin/Nix
            commands::evolve::darwin_evolve,
            commands::evolve::darwin_evolve_cancel,
            commands::evolve::darwin_evolve_answer,
            commands::apply::darwin_apply_stream_start,
            commands::apply::darwin_activate_store_path,
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
            // Settings backup/restore (developer-mode only)
            commands::settings_io::settings_export,
            commands::settings_io::settings_import,
            // Configurable registry (auto-UI for dev settings)
            commands::dev_configs::dev_configs_list,
            commands::dev_configs::dev_config_set,
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
            // Evolve mascot indicator (experimental)
            commands::peek::evolve_mascot_show,
            commands::peek::evolve_mascot_hide,
            // Permissions
            commands::permissions::permissions_check_all,
            commands::permissions::permissions_request,
            // System defaults scanner
            commands::system_defaults::get_recommended_prompt,
            commands::system_defaults::scan_system_defaults,
            commands::system_defaults::apply_system_defaults,
            // CLI tool detection
            commands::cli_tool::check_cli_tools,
            commands::cli_tool::list_cli_models,
            // Updater
            commands::updater::check_update,
            commands::updater::install_update,
            commands::updater::relaunch_after_update,
            commands::updater::install_version,
            commands::updater::clear_pinned_version,
            // Editor
            commands::editor::editor_read_file,
            commands::editor::editor_write_file,
            // LSP
            commands::editor::lsp_start,
            commands::editor::lsp_send,
            commands::editor::lsp_stop,
            telemetry::ipc::otel_forward_span,
        ])
        .setup(move |app| {
            let handle = app.handle();
            // Expose the app handle globally so background threads can use plugins.
            let _ = crate::APP_HANDLE.set(handle.clone());
            log::debug!("Tauri setup started");

            // Set up panic handler to catch crashes and show feedback dialog
            panic_handler::setup_panic_hook(handle.clone());

            app.manage(state::preferences::load_global_observable(handle)?);
            app.manage(evolve::config::load_observable(handle)?);
            evolve::config::register_slice_config(&app.state::<state::slice::SliceRegistry>())?;
            app.manage(state::evolve_state::load_observable(handle)?);

            // Initialize SQLite database before any consumer that reads the
            // managed DbPool from app state.
            tauri::async_runtime::block_on(db::init(handle))?;

            // Background initialize the scanner singleton; the returned &'static ref is not
            // needed right now. fire-and-forget is intentional here.
            let scanner_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let _ = tauri::async_runtime::spawn_blocking({
                    let h = scanner_handle.clone();
                    move || system::secret_scanner::SecretScanner::global(&h)
                }).await;

                // Retry any pending feedback reports from previous failed submissions
                // Note that this depends on the secret scanner having been initialized first,
                // hence the blocking spawn and await above.
                match feedback::retry_pending(&scanner_handle).await {
                    Ok(n) if n > 0 => {
                        log::info!("Retried and sent {} pending feedback report(s)", n)
                    }
                    Err(e) => log::warn!("Failed to retry pending feedback: {}", e),
                    _ => {}
                }
            });

            // Background initialize the nix-darwin docs index once at startup for fast option-shape lookup.
             tauri::async_runtime::spawn_blocking(|| {
                 evolve::search_docs::initialize_docs_index();
             });

            let send_diagnostics = store::get_send_diagnostics(handle).unwrap_or(false);
            if send_diagnostics {
                log::info!(
                    "Diagnostics enabled by user preference (env: {}, version: {})",
                    nixmac_env,
                    nixmac_version
                );
            } else {
                log::info!("Diagnostics disabled by user preference");
            }

            // Initialize the OTEL telemetry pipeline. Rust owns the OTEL
            // providers; the WebView forwards spans via IPC. The guard is moved
            // into Tauri-managed state so it lives for the app's lifetime: a
            // local `let` binding here would drop at the end of `setup`, which
            // would shut down the globally-registered provider prematurely.
            app.manage(telemetry::init::init_telemetry(send_diagnostics));

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
            let max_width = 2000.0;
            let min_height = 400.0;
            let max_height = 1800.0;
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
                        }
                    });

            #[cfg(target_os = "macos")]
            {
                main_window_builder =
                    main_window_builder
                        .hidden_title(!e2e_opaque_window)
                        .title_bar_style(if e2e_opaque_window {
                            tauri::TitleBarStyle::Visible
                        } else {
                            tauri::TitleBarStyle::Overlay
                        });
            }

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
                tracing::error!(message = %msg, "window build failed");
                msg
            })?;
            log::debug!("Main nixmac window created");

            #[cfg(target_os = "macos")]
            if e2e_opaque_window {
                use objc::msg_send;
                use objc::runtime::Object;
                use objc::sel;
                use objc::sel_impl;

                match main_window.ns_window() {
                    Ok(ns_window) => unsafe {
                        let ns_window = ns_window as *mut Object;
                        let is_opaque: bool = msg_send![ns_window, isOpaque];
                        let alpha_value: f64 = msg_send![ns_window, alphaValue];
                        let level: i64 = msg_send![ns_window, level];
                        let has_shadow: bool = msg_send![ns_window, hasShadow];
                        log::info!(
                            "NIXMAC_E2E_OPAQUE_WINDOW native window diagnostics: isOpaque={} alphaValue={:.3} level={} hasShadow={}",
                            is_opaque,
                            alpha_value,
                            level,
                            has_shadow
                        );
                    },
                    Err(error) => {
                        log::warn!(
                            "NIXMAC_E2E_OPAQUE_WINDOW native window diagnostics unavailable: {}",
                            error
                        );
                    }
                }
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

            // Experimental: create the spinning-mascot indicator window when the
            // flag is enabled at launch. Gated here so users who never enable it
            // pay no startup cost; enabling the flag applies on the next launch.
            if store::get_bool_pref(handle, store::EXPERIMENTAL_SPINNING_MASCOT_KEY, false)
                .unwrap_or(false)
            {
                if let Err(e) = peek::create_evolve_mascot_window(handle) {
                    log::error!("[peek] failed to create evolve mascot window: {}", e);
                }
            }

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

            #[cfg(target_os = "macos")]
            {
                // Click Nixmac icon to show
                if let RunEvent::Reopen { .. } = &event {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        // fire-and-forget: show/set_focus fail only on destroyed window.
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
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
