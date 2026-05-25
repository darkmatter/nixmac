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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn export_result_serializes_with_frontend_field_names() {
        let result = ExportResult {
            path: "/tmp/nixmac-settings.json".to_string(),
            keys_written: 2,
            keys_skipped: vec!["openaiApiKey".to_string()],
        };

        assert_eq!(
            serde_json::to_value(result).expect("serialize export result"),
            json!({
                "path": "/tmp/nixmac-settings.json",
                "keysWritten": 2,
                "keysSkipped": ["openaiApiKey"],
            })
        );
    }

    #[test]
    fn import_result_serializes_with_frontend_field_names() {
        let result = ImportResult {
            path: "/tmp/nixmac-settings.json".to_string(),
            keys_imported: 3,
        };

        assert_eq!(
            serde_json::to_value(result).expect("serialize import result"),
            json!({
                "path": "/tmp/nixmac-settings.json",
                "keysImported": 3,
            })
        );
    }
}
