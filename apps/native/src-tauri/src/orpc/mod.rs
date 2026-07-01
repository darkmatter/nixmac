//! oRPC router served over Tauri IPC via `tauri-plugin-orpc`.
//!
//! Add procedures here and regenerate bindings with:
//! `cd apps/native && bun run gen:orpc`

mod account;
mod billing;
mod cli;
mod config;
mod darwin;
mod dev_configs;
mod editor;
mod evolve_mascot;
mod evolve_state;
mod feedback;
mod flake;
mod git;
mod github;
mod helpers;
mod history;
mod homebrew;
mod launchd;
mod lsp;
mod models;
mod nix;
mod path;
mod permissions;
mod preferences;
mod preview_indicator;
mod prompt_history;
mod scanner;
mod settings;
mod summarized_changes;
mod sync;
mod system;
mod updater;

use orpc::*;
use tauri::AppHandle;

#[derive(Clone)]
pub struct OrpcCtx {
    pub app: AppHandle,
}

pub fn build_router() -> Router<OrpcCtx> {
    github::routes()
        .nest("account", account::routes())
        .nest("config", config::routes())
        .nest("flake", flake::routes())
        .nest("path", path::routes())
        .nest("evolveState", evolve_state::routes())
        .nest("darwin", darwin::routes())
        .nest("summarizedChanges", summarized_changes::routes())
        .nest("history", history::routes())
        .nest("git", git::routes())
        .nest("previewIndicator", preview_indicator::routes())
        .nest("homebrew", homebrew::routes())
        .nest("launchd", launchd::routes())
        .nest("scanner", scanner::routes())
        .nest("billing", billing::routes())
        .nest("system", system::routes())
        .nest("sync", sync::routes())
        .nest("feedback", feedback::routes())
        .nest("settings", settings::routes())
        .nest("devConfigs", dev_configs::routes())
        .nest("cli", cli::routes())
        .nest("models", models::routes())
        .nest("promptHistory", prompt_history::routes())
        .nest("evolveMascot", evolve_mascot::routes())
        .nest("permissions", permissions::routes())
        .nest("editor", editor::routes())
        .nest("lsp", lsp::routes())
        .nest("updater", updater::routes())
        .nest("nix", nix::routes())
        .nest("preferences", preferences::routes())
}
