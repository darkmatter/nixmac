//! oRPC router served over Tauri IPC via `tauri-plugin-orpc`.
//!
//! Add procedures here and regenerate bindings with:
//! `cd apps/native && bun run gen:orpc`

mod darwin;
mod evolve_state;
mod git;
mod github;
mod helpers;
mod history;
mod preview_indicator;
mod summarized_changes;

use orpc::*;
use tauri::AppHandle;

#[derive(Clone)]
pub struct OrpcCtx {
    pub app: AppHandle,
}

pub fn build_router() -> Router<OrpcCtx> {
    github::routes()
        .nest("evolveState", evolve_state::routes())
        .nest("darwin", darwin::routes())
        .nest("summarizedChanges", summarized_changes::routes())
        .nest("history", history::routes())
        .nest("git", git::routes())
        .nest("previewIndicator", preview_indicator::routes())
}
