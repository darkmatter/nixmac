//! Entry point for the nixmac Tauri application.
//!
//! This is a macOS menu bar utility for managing nix-darwin configurations.
//! It provides a widget-style interface for viewing, evolving, and applying
//! Nix flake-based system configurations.

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod darwin;
mod evolve;
mod git;
mod nix;
mod peek;
mod store;
mod summarize;
mod types;
mod watcher;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    window::{Color, Effect, EffectsBuilder},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

fn main() {
    // Initialize logging - set RUST_LOG=debug for verbose output
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            // Darwin/Nix
            commands::darwin_evolve,
            commands::darwin_apply,
            commands::darwin_apply_stream_start,
            commands::darwin_apply_stream_cancel,
            commands::flake_installed_apps,
            commands::flake_list_hosts,
            // Summarization
            commands::summarize_changes,
            commands::suggest_commit_message,
            // UI preferences
            commands::ui_get_prefs,
            commands::ui_set_prefs,
            commands::ui_set_window_shadow,
            // Peek/Widget visibility
            commands::peek_lock_expanded,
            commands::peek_hide,
            commands::peek_get_state,
            commands::peek_get_debug_zone,
            commands::peek_icon_clicked,
            commands::peek_show_main,
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
            // Rebuild overlay
            commands::rebuild_overlay_show,
            commands::rebuild_overlay_hide,
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
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        peek::lock_expanded();
                        if let Err(e) = peek::show_main_window(app) {
                            eprintln!("[tray] Failed to show main window: {}", e);
                        }
                    }
                    // Navigation items emit events to the frontend to switch tabs
                    "overview" | "evolve" | "commit" | "apply" => {
                        peek::lock_expanded();
                        if let Err(e) = peek::show_main_window(app) {
                            eprintln!("[tray] Failed to show main window: {}", e);
                        }
                        if let Some(window) = app.get_webview_window("main") {
                            window.emit("navigate", event.id().as_ref()).ok();
                        }
                    }
                    "quit" => {
                        std::process::exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Create the main widget window (starts hidden)
            // Resizable in both dimensions within these bounds
            let initial_width = 800.0;
            let initial_height = 800.0;
            let min_width = 400.0;
            let max_width = 1200.0;
            let min_height = 400.0;
            let max_height = 900.0;

            let _main_window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("nixmac")
                    .inner_size(initial_width, initial_height)
                    .min_inner_size(min_width, min_height)
                    .max_inner_size(max_width, max_height)
                    .resizable(true)
                    .maximizable(false)
                    .minimizable(true)
                    .closable(false)
                    .decorations(false)
                    .transparent(true)
                    .effects(EffectsBuilder::new().effects(vec![Effect::Acrylic]).build())
                    .visible(false) // Start hidden - icon reveals it
                    .always_on_top(true)
                    .visible_on_all_workspaces(true)
                    .background_color(Color(0, 0, 0, 0))
                    .build()
                    .unwrap();

            // Create the peek icon window
            if let Err(e) = peek::create_icon_window(&handle) {
                eprintln!("[peek] ❌ Failed to create icon window: {}", e);
            }

            // Create the preview indicator window (persistent banner for uncommitted changes)
            if let Err(e) = peek::create_preview_indicator_window(&handle) {
                eprintln!("[peek] ❌ Failed to create preview indicator window: {}", e);
            }

            // Start peek monitoring - watches for Option key + cursor in corner
            peek::start_monitoring(handle.clone());

            // Start config watcher - monitors config directory for file changes
            // This emits config:changed events to the frontend when files are modified
            if let Ok(config_dir) = store::get_config_dir(&handle) {
                watcher::start_watching(handle.clone(), config_dir);
            }

            // Global hotkey to quickly summon the window
            let handle_for_shortcut = handle.clone();
            app.global_shortcut()
                .on_shortcut(
                    "CommandOrControl+Shift+O",
                    move |_app, _shortcut, _event| {
                        peek::lock_expanded();
                        if let Err(e) = peek::show_main_window(&handle_for_shortcut) {
                            eprintln!("[shortcut] Failed to show main window: {}", e);
                        }
                    },
                )
                .ok();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
