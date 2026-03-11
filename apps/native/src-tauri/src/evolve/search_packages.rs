//! search_packages tool implementation

use super::utils::truncate_error;
use anyhow::Result;
use log::info;
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
    let mut search_type = search_type.to_string();

    info!(
        "Searching for packages matching: '{}' (type: {}, regex: {}, channel: {})",
        query, search_type, use_regex, channel
    );

    // Helper function to execute a single search
    let execute_search = |query_term: &str,
                          st: &str|
     -> Result<Option<serde_json::Map<String, serde_json::Value>>> {
        let search_query = match st {
            "name" => format!("^{}", query_term), // Search in attr path (package name)
            "description" => query_term.to_string(),
            _ => query_term.to_string(), // "both"
        };

        let mut cmd = Command::new("nix");
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
                search_type = fallback_type.to_string();
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
                    search_type = "both".to_string();
                }
            }
        }
    }

    // Format results
    let message = match results {
        Some(obj) => {
            let mut formatted_results = Vec::new();

            for (package_name, info) in obj.iter().take(limit as usize) {
                let description = info["description"].as_str().unwrap_or("No description");
                let version = info["version"].as_str().unwrap_or("unknown");

                formatted_results.push(format!(
                    "• {} ({})\n  {}",
                    package_name, version, description
                ));
            }

            let summary = format!(
                "Found {} package(s) matching '{}' in {} (type: {}, showing {}):\n\n{}",
                obj.len(),
                query,
                channel,
                search_type,
                formatted_results.len(),
                formatted_results.join("\n\n")
            );

            truncate_error(&summary, 8000)
        }
        None => {
            format!("No packages found matching '{}' in {}", query, channel)
        }
    };

    Ok(message)
}
