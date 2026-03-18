//! SQLite database for persisting evolution history, summaries, and prompts.

pub mod changesets;
pub mod commits;
pub mod operations;
mod schema;
pub mod squashed_commits;
pub mod summaries;

use anyhow::Result;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Get the database file path (in app data directory)
pub fn get_db_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    if let Some(path) = DB_PATH.get() {
        return Ok(path.clone());
    }

    let app_data = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data)?;
    let path = app_data.join("nixmac.db");
    let _ = DB_PATH.set(path.clone());
    Ok(path)
}

/// Initialize the database (create file and run migrations)
pub async fn init<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let path = get_db_path(app)?;
    schema::init_schema(&path).await
}
