use crate::{editor, shared_types};
use tauri::AppHandle;

/// Read a file relative to the config directory.
#[tauri::command]
pub async fn editor_read_file(app: AppHandle, rel_path: String) -> Result<String, String> {
    editor::read_file(&app, &rel_path).await
}

/// Write a file relative to the config directory.
#[tauri::command]
pub async fn editor_write_file(
    app: AppHandle,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    editor::write_file(&app, &rel_path, &content).await
}

/// List files in the config directory.
#[tauri::command]
pub async fn editor_list_files(app: AppHandle) -> Result<Vec<shared_types::FileEntry>, String> {
    editor::list_files(&app).await
}

/// Start the nixd LSP server.
#[tauri::command]
pub async fn lsp_start(app: AppHandle) -> Result<(), String> {
    editor::lsp::start(&app).await
}

/// Send a JSON-RPC message to nixd.
#[tauri::command]
pub async fn lsp_send(message: String) -> Result<(), String> {
    editor::lsp::send(&message).await
}

/// Stop the nixd LSP server.
#[tauri::command]
pub async fn lsp_stop() -> Result<(), String> {
    editor::lsp::stop().await
}
