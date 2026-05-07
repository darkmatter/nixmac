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
use std::sync::{Arc, Mutex};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

fn main() {
    // Initialize tracing subscriber with optional file logging
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    // Keep the WorkerGuard alive for the lifetime of `main()` so drops flush buffered logs
    let log_guard: Arc<Mutex<Option<tracing_appender::non_blocking::WorkerGuard>>> =
        Arc::new(Mutex::new(None));

    if let Ok(log_path) = env::var("NIXMAC_LOGFILE") {
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

            let main_window =
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
                    .transparent(true)
                    .visible(true)
                    .always_on_top(false)
                    .visible_on_all_workspaces(true)
                    .hidden_title(true)
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .build()
                    .map_err(|e| {
                        let msg = format!("Failed to create main window: {}", e);
                        log::error!("{}", msg);
                        sentry::capture_message(&msg, sentry::Level::Error);
                        msg
                    })?;

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
