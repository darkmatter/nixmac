//! search_packages tool implementation

use super::utils::truncate_error;
use anyhow::Result;
use log::info;
use serde_json::{Map, Value};
use std::process::Command;

/// Search a single channel and return raw package objects keyed by package path.
fn search_single_channel(
    config_dir: &str,
    query_term: &str,
    search_type: &str,
    use_regex: bool,
    channel: &str,
) -> Result<Map<String, Value>> {
    let search_query = match search_type {
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
    let parsed = serde_json::from_str::<serde_json::Value>(&stdout).ok();

    Ok(parsed
        .and_then(|json| json.as_object().cloned())
        .unwrap_or_default())
}

/// Search channels in order for a given query/type and append unique results up to `limit`.
fn collect_from_channels(
    config_dir: &str,
    channels: &[String],
    query_term: &str,
    search_type: &str,
    use_regex: bool,
    limit: u64,
    structured: &mut Map<String, Value>,
) -> Result<bool> {
    for channel in channels {
        if structured.len() >= limit as usize {
            return Ok(true);
        }

        let channel_results =
            search_single_channel(config_dir, query_term, search_type, use_regex, channel)?;

        for (package_name, info) in channel_results {
            if structured.len() >= limit as usize {
                return Ok(true);
            }

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

            let map_key = package_name.split('.').next_back().unwrap_or(&package_name);
            if !structured.contains_key(map_key) {
                structured.insert(map_key.to_string(), compact);
            }
        }
    }

    Ok(structured.len() >= limit as usize)
}

/// Execute a search_packages tool call with smart fallback logic
pub fn execute_search_packages(
    config_dir: &str,
    query: &str,
    limit: u64,
    search_type: &str,
    use_regex: bool,
    channels: &Vec<String>,
) -> Result<String> {
    let search_type = search_type.to_string();

    info!(
        "Searching for packages matching: '{}' (type: {}, regex: {}, channels: {:?})",
        query, search_type, use_regex, channels
    );

    let mut structured = Map::new();

    // Try primary search across channels, collecting up to limit.
    let mut complete = collect_from_channels(
        config_dir,
        channels,
        query,
        &search_type,
        use_regex,
        limit,
        &mut structured,
    )?;

    // If no results found, try alternative searches
    if !complete && structured.is_empty() {
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
            complete = collect_from_channels(
                config_dir,
                channels,
                fallback_query,
                fallback_type,
                use_regex,
                limit,
                &mut structured,
            )?;
            if complete || !structured.is_empty() {
                break;
            }
        }

        // If still nothing, try first word only
        if !complete && structured.is_empty() {
            if let Some(first_word) = query.split_whitespace().next() {
                info!(
                    "Fallback attempt: searching first word '{}' with type 'both'",
                    first_word
                );
                collect_from_channels(
                    config_dir,
                    channels,
                    first_word,
                    "both",
                    use_regex,
                    limit,
                    &mut structured,
                )?;
            }
        }
    }

    // Return compact structured JSON keyed by package name.
    let message = if structured.is_empty() {
        "{}".to_string()
    } else {
        truncate_error(&serde_json::to_string_pretty(&structured)?, 8000)
    };

    Ok(message)
}
