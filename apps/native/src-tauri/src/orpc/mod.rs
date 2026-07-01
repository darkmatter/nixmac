//! oRPC router served over Tauri IPC via `tauri-plugin-orpc`.
//!
//! Add procedures here and regenerate bindings with:
//! `cd apps/native && bun run gen:orpc`

mod billing;
mod config;
mod darwin;
mod evolve_state;
mod flake;
mod git;
mod github;
mod helpers;
mod history;
mod homebrew;
mod launchd;
mod path;
mod preview_indicator;
mod scanner;
mod summarized_changes;
mod system;

use orpc::*;
use tauri::AppHandle;

#[derive(Clone)]
pub struct OrpcCtx {
    pub app: AppHandle,
}

pub fn build_router() -> Router<OrpcCtx> {
    github::routes()
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
}
