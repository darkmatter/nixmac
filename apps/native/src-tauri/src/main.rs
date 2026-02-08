//! Entry point for the nixmac Tauri application.
//!
//! This is a macOS application for managing nix-darwin configurations.
//! It provides an interface for viewing, evolving, and applying
//! Nix flake-based system configurations.

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod darwin;
mod default_config;
mod evolve;
mod git;
mod log_summarizer;
mod nix;
mod peek;
mod permissions;
mod providers;
mod store;
mod summarize;
mod template;
mod types;
mod watcher;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

fn main() {
    // Initialize logging - set RUST_LOG=debug for verbose output
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new().build())
        // .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .invoke_handler(tauri::generate_handler![
            // Configuration
            commands::config_get,
            commands::config_set_host_attr,
            commands::config_set_dir,
            commands::config_pick_dir,
            // Git
            commands::git_init_if_needed,
            commands::git_status,
            commands::git_commit,
            commands::git_stash,
            commands::git_stage_all,
            commands::git_unstage_all,
            commands::git_restore_all,
            // Darwin/Nix
            commands::darwin_evolve,
            commands::darwin_evolve_cancel,
            commands::darwin_apply,
            commands::darwin_apply_stream_start,
            commands::darwin_apply_stream_cancel,
            commands::flake_installed_apps,
            commands::flake_list_hosts,
            commands::flake_exists,
            commands::bootstrap_default_config,
            // Summarization
            commands::summarize_changes,
            commands::summary_get_cached,
            commands::suggest_commit_message,
            // UI preferences
            commands::ui_get_prefs,
            commands::ui_set_prefs,
            // Model cache
            commands::get_cached_models,
            commands::set_cached_models,
            commands::clear_cached_models,
            // Window
            commands::show_main_window,
            // Preview indicator
            commands::preview_indicator_show,
            commands::preview_indicator_hide,
            commands::preview_indicator_update,
            commands::preview_indicator_get_state,
            commands::set_has_uncommitted_changes,
            // Config watcher
            commands::watcher_start,
            commands::watcher_stop,
            commands::watcher_is_active,
            // Permissions
            commands::permissions_check_all,
            commands::permissions_request,
            commands::permissions_all_required_granted,
        ])
        .setup(|app| {
            let handle = app.handle();

            // Build the system tray menu with navigation shortcuts
            let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let overview_i = MenuItem::with_id(app, "overview", "Overview", true, None::<&str>)?;
            let evolve_i = MenuItem::with_id(app, "evolve", "Evolve", true, None::<&str>)?;
            let commit_i = MenuItem::with_id(app, "commit", "Commit", true, None::<&str>)?;
            let apply_i = MenuItem::with_id(app, "apply", "Apply", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &open_i,
                    &overview_i,
                    &evolve_i,
                    &commit_i,
                    &apply_i,
                    &quit_i,
                ],
            )?;

            let _tray = TrayIconBuilder::new()
                .icon(
                    Image::from_path("icons/outline@2x.png")
                        .unwrap_or_else(|_| app.default_window_icon().unwrap().clone()),
                )
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_tray_icon_event(|tray_handle, event| {
                    tauri_plugin_positioner::on_tray_event(tray_handle.app_handle(), &event);
                })
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    // Navigation items emit events to the frontend to switch tabs
                    "overview" | "evolve" | "commit" | "apply" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            window.emit("navigate", event.id().as_ref()).ok();
                        }
                    }
                    "quit" => {
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
                    .unwrap();

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
            if let Err(e) = peek::create_preview_indicator_window(handle) {
                eprintln!("[peek] ❌ Failed to create preview indicator window: {}", e);
            }

            // Start config watcher - monitors config directory for file changes
            // This emits config:changed events to the frontend when files are modified
            if let Ok(config_dir) = store::get_config_dir(handle) {
                watcher::start_watching(handle.clone(), config_dir, 2500);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
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
                        let _ = window.hide();
                        // Update peek state
                        peek::unlock_and_hide();
                    }
                }
            }

            // Click Nixmac icon to show
            if let RunEvent::Reopen { .. } = &event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
