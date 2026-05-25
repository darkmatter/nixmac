use serde::{Deserialize, Serialize};
use specta::Type;

/// Result of a successful settings export. Returned to the frontend so it can
/// show the file path and the count of skipped sensitive keys.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub keys_written: usize,
    pub keys_skipped: Vec<String>,
}

/// Result of a successful settings import.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub path: String,
    pub keys_imported: usize,
}
