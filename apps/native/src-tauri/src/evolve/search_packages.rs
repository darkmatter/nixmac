//! search_packages tool implementation

use super::utils::truncate_error;
use anyhow::Result;
use log::info;
use serde_json::{Map, Value};
use std::process::Command;

/// Execute a search_packages tool call with smart fallback logic
pub fn execute_search_packages(
    config_dir: &str,
    query: &str,
    limit: u64,
    search_type: &str,
    use_regex: bool,
    channel: &str,
) -> Result<String> {
    let search_type = search_type.to_string();

    info!(
        "Searching for packages matching: '{}' (type: {}, regex: {}, channel: {})",
        query, search_type, use_regex, channel
    );

    // Helper function to execute a single search
    let execute_search = |query_term: &str, st: &str| -> Result<Option<Map<String, Value>>> {
        let search_query = match st {
            "name" => format!("^{}", query_term), // Search in attr path (package name)
            "description" => query_term.to_string(),
            _ => query_term.to_string(), // "both"
        };

        let mut cmd = Command::new(crate::nix::nix_executable());
        cmd.args(["search", channel]);

        if use_regex {
            cmd.arg("--regex");
        }

        cmd.arg(&search_query)
            .arg("--json")
            .current_dir(config_dir)
            .env("PATH", crate::nix::get_nix_path())
            .env("NIX_CONFIG", "experimental-features = nix-command flakes");

        let output = cmd.output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let truncated_stderr = truncate_error(&stderr, 8000);
            return Err(anyhow::anyhow!(
                "nix search failed with status {:?}: {}",
                output.status.code(),
                truncated_stderr
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
            if let Some(obj) = json.as_object() {
                if !obj.is_empty() {
                    return Ok(Some(obj.clone()));
                }
            }
        }

        Ok(None) // Empty result
    };

    // Try primary search
    let mut results = execute_search(query, &search_type)?;

    // If no results found, try alternative searches
    if results.is_none() {
        info!("Initial search returned no results, trying fallback searches...");

        // Try progressively broader searches
        let fallback_attempts = match search_type.as_str() {
            "description" => vec![
                ("name", query), // Try searching in names instead
                ("both", query), // Try searching in both fields
            ],
            "name" => vec![
                ("description", query), // Try descriptions if name search failed
                ("both", query),
            ],
            _ => vec![], // "both" has no good fallback
        };

        for (fallback_type, fallback_query) in fallback_attempts {
            info!(
                "Fallback attempt: searching '{}' in type '{}'",
                fallback_query, fallback_type
            );
            if let Ok(Some(found)) = execute_search(fallback_query, fallback_type) {
                results = Some(found);
                break;
            }
        }

        // If still nothing, try first word only
        if results.is_none() {
            if let Some(first_word) = query.split_whitespace().next() {
                info!(
                    "Fallback attempt: searching first word '{}' with type 'both'",
                    first_word
                );
                if let Ok(Some(found)) = execute_search(first_word, "both") {
                    results = Some(found);
                }
            }
        }
    }

    // Return compact structured JSON keyed by package name.
    let message = match results {
        Some(obj) => {
            let mut structured = Map::new();

            for (package_name, info) in obj.iter().take(limit as usize) {
                let attr_path = info
                    .get("attrPath")
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string)
                    .or_else(|| package_name.split('.').next_back().map(ToString::to_string))
                    .unwrap_or_else(|| package_name.to_string());

                let version = info
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");

                let description = info
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("No description");

                let compact = serde_json::json!({
                    "attr_path": attr_path,
                    "version": version,
                    "description": description,
                    "channel": channel,
                });

                let map_key = package_name.split('.').next_back().unwrap_or(package_name);
                structured.insert(map_key.to_string(), compact);
            }

            truncate_error(&serde_json::to_string_pretty(&structured)?, 8000)
        }
        None => "{}".to_string(),
    };

    Ok(message)
}
